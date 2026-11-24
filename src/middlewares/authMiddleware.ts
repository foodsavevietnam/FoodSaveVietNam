import crypto from "crypto";
import type { User } from "@supabase/supabase-js";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { env } from "../config/env";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { Profile, UserRole } from "../types/domain";
import { AppError } from "../utils/appError";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LocalVerifiedSupabaseUser {
  id: string;
  email: string | undefined;
  role: string | undefined;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const invalidTokenError = (): AppError =>
  new AppError("Invalid or expired authentication token", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);

const decodeBase64UrlJson = (segment: string): Record<string, unknown> | null => {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * Xác thực nhanh JWT HS256 của Supabase ngay trong tiến trình bằng HMAC-SHA256 + timingSafeEqual.
 * - Chỉ xử lý thuật toán HS256; nếu header.alg là thuật toán bất đối xứng (RS256/ES256...) sẽ trả `null`
 *   để middleware tự rơi về `supabaseAuth.auth.getUser(token)`.
 * - Ném AppError(401, AUTH_INVALID_TOKEN) nếu chữ ký HS256 / exp / nbf / sub / aud không hợp lệ.
 */
export const verifySupabaseJwtLocally = (
  token: string,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): LocalVerifiedSupabaseUser | null => {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw invalidTokenError();
  }

  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeBase64UrlJson(headerPart);
  if (!header) {
    throw invalidTokenError();
  }

  const alg = header.alg;
  if (typeof alg !== "string" || alg.trim() === "" || alg.toLowerCase() === "none") {
    throw invalidTokenError();
  }
  if (alg !== "HS256") {
    return null;
  }

  if (!signaturePart || !/^[A-Za-z0-9_-]+$/.test(signaturePart)) {
    throw invalidTokenError();
  }

  const expectedSignature = crypto.createHmac("sha256", secret).update(`${headerPart}.${payloadPart}`).digest();
  const actualSignature = Buffer.from(signaturePart, "base64url");
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) {
    throw invalidTokenError();
  }

  const payload = decodeBase64UrlJson(payloadPart);
  if (!payload) {
    throw invalidTokenError();
  }

  if (typeof payload.sub !== "string" || !UUID_REGEX.test(payload.sub)) {
    throw invalidTokenError();
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp) || payload.exp <= nowSec) {
    throw invalidTokenError();
  }

  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== "number" || !Number.isFinite(payload.nbf) || payload.nbf > nowSec) {
      throw invalidTokenError();
    }
  }

  if (payload.aud !== "authenticated") {
    throw invalidTokenError();
  }

  return {
    id: payload.sub,
    email: typeof payload.email === "string" ? payload.email : undefined,
    role: typeof payload.role === "string" ? payload.role : undefined,
    app_metadata: isRecord(payload.app_metadata) ? payload.app_metadata : {},
    user_metadata: isRecord(payload.user_metadata) ? payload.user_metadata : {}
  };
};

const extractBearerToken = (authorizationHeader: string | undefined): string => {
  if (!authorizationHeader) {
    throw new AppError("Authorization bearer token is required", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_MISSING_TOKEN);
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AppError("Authorization header must use Bearer token format", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
  }

  return token;
};

const resolveAuthenticatedUser = async (token: string): Promise<User> => {
  if (env.AUTH_LOCAL_JWT_VERIFY && env.SUPABASE_JWT_SECRET) {
    const verified = verifySupabaseJwtLocally(token, env.SUPABASE_JWT_SECRET);
    if (verified) {
      return verified as unknown as User;
    }
  }

  const { data, error } = await supabaseAuth.auth.getUser(token);
  if (error || !data.user) {
    throw invalidTokenError();
  }

  return data.user;
};

export const authMiddleware: RequestHandler = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const user = await resolveAuthenticatedUser(token);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      throw new AppError("Authenticated user profile was not found", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
    }

    if ((profile as Profile).status === "suspended") {
      throw new AppError("This account has been suspended", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    req.user = user;
    req.profile = profile as Profile;
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuthMiddleware: RequestHandler = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  const authorizationHeader = req.headers.authorization;
  if (!authorizationHeader) {
    next();
    return;
  }

  try {
    const token = extractBearerToken(authorizationHeader);
    const user = await resolveAuthenticatedUser(token);

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (!profileError && profile && (profile as Profile).status !== "suspended") {
      req.user = user;
      req.profile = profile as Profile;
    }
  } catch {
    // Tuyến hỗ trợ công khai: token không hợp lệ không chặn gửi yêu cầu ẩn danh.
  }

  next();
};

export const requireRoles = (...allowedRoles: UserRole[]): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.profile) {
      next(new AppError("Authentication is required", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_MISSING_TOKEN));
      return;
    }

    if (!allowedRoles.includes(req.profile.role)) {
      next(new AppError("You do not have permission to perform this action", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN));
      return;
    }

    next();
  };
};
