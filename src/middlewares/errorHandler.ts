import crypto from "node:crypto";
import type { ErrorRequestHandler, Request } from "express";
import { ZodError } from "zod";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { env } from "../config/env";
import { AppError } from "../utils/appError";
import { logger, redactString } from "../utils/logger";
import { getRequestId } from "../utils/requestIdStore";

const SENTRY_TIMEOUT_MS = 1500;
const SAFE_HEADER_ALLOWLIST = new Set([
  "user-agent",
  "content-type",
  "x-request-id",
  "x-platform",
  "x-app-version"
]);

export interface SafeSerializedError {
  name: string;
  message: string;
  code?: string | undefined;
  statusCode?: number | undefined;
  stack?: string | undefined;
}

export interface ParsedSentryDsn {
  storeUrl: string;
  publicKey: string;
}

export const serializeError = (error: unknown): SafeSerializedError => {
  if (error instanceof Error) {
    const errWithMeta = error as Error & { code?: unknown; statusCode?: unknown };
    const serialized: SafeSerializedError = {
      name: redactString(error.name || "Error"),
      message: redactString(error.message || "Unexpected error")
    };
    if (typeof errWithMeta.code === "string" || typeof errWithMeta.code === "number") {
      serialized.code = redactString(String(errWithMeta.code));
    }
    if (typeof errWithMeta.statusCode === "number" && Number.isFinite(errWithMeta.statusCode)) {
      serialized.statusCode = errWithMeta.statusCode;
    }
    if (typeof error.stack === "string") {
      serialized.stack = redactString(error.stack);
    }
    return serialized;
  }

  return {
    name: "UnknownError",
    message: typeof error === "string" ? redactString(error) : "Non-Error thrown"
  };
};

export const parseSentryDsn = (dsn: string | undefined): ParsedSentryDsn | null => {
  if (!dsn || !dsn.trim()) return null;
  try {
    const parsed = new URL(dsn.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const publicKey = parsed.username;
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const projectId = pathSegments.pop();
    if (!publicKey || !projectId) return null;
    const prefix = pathSegments.length > 0 ? `/${pathSegments.join("/")}` : "";
    return {
      storeUrl: `${parsed.protocol}//${parsed.host}${prefix}/api/${projectId}/store/`,
      publicKey
    };
  } catch {
    return null;
  }
};

const pickSafeHeaders = (req: Pick<Request, "headers"> | undefined): Record<string, string> => {
  const safe: Record<string, string> = {};
  if (!req?.headers) return safe;
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (!SAFE_HEADER_ALLOWLIST.has(lower)) continue;
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw === "string" && raw.trim()) {
      safe[lower] = redactString(raw.trim().slice(0, 256));
    }
  }
  return safe;
};

const extractSafePath = (req: Pick<Request, "originalUrl" | "url" | "path"> | undefined): string => {
  const raw = req?.originalUrl || req?.url || req?.path || "/";
  const queryIndex = raw.indexOf("?");
  return (queryIndex >= 0 ? raw.slice(0, queryIndex) : raw) || "/";
};

export const reportErrorToSentry = async (
  safeError: SafeSerializedError,
  req: Pick<Request, "method" | "originalUrl" | "url" | "path" | "headers"> | undefined,
  statusCode: number
): Promise<void> => {
  const parsed = parseSentryDsn(env.SENTRY_DSN);
  if (!parsed || typeof fetch !== "function") return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SENTRY_TIMEOUT_MS);
  timer.unref?.();

  const requestId = getRequestId();
  const payload = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: Date.now() / 1000,
    platform: "node",
    level: "error",
    environment: env.NODE_ENV,
    server_name: "foodsave-backend",
    tags: {
      status_code: String(statusCode),
      ...(requestId ? { request_id: requestId } : {})
    },
    exception: {
      values: [
        {
          type: safeError.name,
          value: safeError.message
        }
      ]
    },
    request: {
      method: req?.method ?? "UNKNOWN",
      url: extractSafePath(req),
      headers: pickSafeHeaders(req)
    },
    extra: {
      ...(safeError.code ? { code: safeError.code } : {}),
      ...(safeError.stack ? { stack: safeError.stack } : {})
    }
  };

  try {
    await fetch(parsed.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}, sentry_client=mio-backend/1.0`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch {
    // Best-effort, fail-silent: không bao giờ chặn phản hồi hoặc gây lỗi vòng lặp
  } finally {
    clearTimeout(timer);
  }
};

const formatZodIssues = (error: ZodError): Array<{ path: string; message: string }> => {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message
  }));
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  // Body-parser errors can carry the original request body. Return a safe
  // client error before the generic logger can record passwords or documents.
  if (error?.type === "entity.parse.failed" || error?.type === "entity.too.large") {
    const tooLarge = error.type === "entity.too.large";
    res.status(tooLarge ? HTTP_STATUS.PAYLOAD_TOO_LARGE : HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: tooLarge ? "Request body exceeds the allowed size" : "Request body must contain valid JSON",
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      const safeError = serializeError(error);
      logger.error(safeError.message, {
        error: safeError,
        ...(error.details !== undefined ? { details: error.details } : {})
      });
      void reportErrorToSentry(safeError, req, error.statusCode);
    }

    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && env.NODE_ENV !== "production" ? { details: error.details } : {})
      }
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Request validation failed",
        details: formatZodIssues(error)
      }
    });
    return;
  }

  const safeError = serializeError(error);
  logger.error("Unhandled server error", { error: safeError });
  void reportErrorToSentry(safeError, req, HTTP_STATUS.INTERNAL_SERVER_ERROR);

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    error: {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      message: env.NODE_ENV === "production" ? "Internal server error" : error instanceof Error ? error.message : "Internal server error"
    }
  });
};
