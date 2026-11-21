import type { NextFunction, Request, RequestHandler, Response } from "express";
import { authMiddleware, requireRoles } from "./authMiddleware";
import { verifyVolunteerToken } from "../utils/volunteerToken";
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";

/**
 * Xác thực cho /push/subscribe và /push/unsubscribe: nhận token tình nguyện viên (HMAC) HOẶC phiên Supabase của người mua.
 * Người mua: res.locals.pushOwner = { kind: "user", id }. Tình nguyện viên: { kind: "volunteer", id }.
 * Các vai trò khác (cửa hàng, tổ chức, admin) không được đăng ký push.
 */
export const pushActor: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  const volunteer = scheme === "Bearer" && token ? verifyVolunteerToken(token) : null;
  if (volunteer) {
    if (env.NODE_ENV === "production" || !env.DEMO_MODE) {
      next(new AppError(
        "Phiên tình nguyện viên cần xác minh OTP để đăng ký thông báo.",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.AUTH_VERIFICATION_REQUIRED,
      ));
      return;
    }
    res.locals.pushOwner = { kind: "volunteer", id: volunteer.vid };
    next();
    return;
  }
  void authMiddleware(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    requireRoles("customer")(req, res, (roleError?: unknown) => {
      if (roleError) {
        next(roleError);
        return;
      }
      res.locals.pushOwner = { kind: "user", id: req.user?.id };
      next();
    });
  });
};
