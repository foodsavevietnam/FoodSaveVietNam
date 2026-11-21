import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { verifyVolunteerToken } from "../utils/volunteerToken";
import { env } from "../config/env";

export const volunteerAuth: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  if (env.NODE_ENV === "production" || !env.DEMO_MODE) {
    next(new AppError(
      "Phiên đăng nhập thử không được sử dụng ở môi trường này. Tình nguyện viên cần xác minh OTP để tiếp tục.",
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODES.AUTH_VERIFICATION_REQUIRED,
    ));
    return;
  }
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  const payload = scheme === "Bearer" && token ? verifyVolunteerToken(token) : null;

  if (!payload) {
    next(new AppError("Phiên tình nguyện viên đã hết hạn. Vui lòng đăng nhập lại.", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN));
    return;
  }

  res.locals.volunteerId = payload.vid;
  next();
};
