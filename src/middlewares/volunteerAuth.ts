import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { verifyVolunteerToken } from "../utils/volunteerToken";
import { isVolunteerTokenUsable } from "../utils/volunteerTokenPolicy";
import { supabaseAdmin } from "../services/supabaseService";

/**
 * Kiểm tra lại trạng thái TNV mỗi request (dùng chung cho volunteerAuth, pushActor, locationActor)
 * để tổ chức khóa TNV có hiệu lực ngay: không tồn tại hoặc inactive → 403 AUTH_FORBIDDEN.
 */
export const assertVolunteerActive = async (volunteerId: string): Promise<void> => {
  const { data, error } = await supabaseAdmin.from("volunteers").select("id,status").eq("id", volunteerId).maybeSingle();
  if (error) throw new AppError("Không kiểm tra được tài khoản tình nguyện viên", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  const row = data as { id: string; status: string | null } | null;
  if (!row || row.status === "inactive") {
    throw new AppError("Tài khoản tình nguyện viên không còn hoạt động", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
};

export const volunteerAuth: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  const payload = scheme === "Bearer" && token ? verifyVolunteerToken(token) : null;

  if (!payload) {
    next(new AppError("Phiên tình nguyện viên đã hết hạn. Vui lòng đăng nhập lại.", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN));
    return;
  }
  // Token demo (chỉ số điện thoại) chỉ dùng được khi DEMO_MODE ngoài production; token OTP dùng được mọi nơi
  if (!isVolunteerTokenUsable(payload)) {
    next(new AppError(
      "Phiên đăng nhập thử không được sử dụng ở môi trường này. Tình nguyện viên cần xác minh OTP để tiếp tục.",
      HTTP_STATUS.FORBIDDEN,
      ERROR_CODES.AUTH_VERIFICATION_REQUIRED,
    ));
    return;
  }

  assertVolunteerActive(payload.vid).then(() => {
    res.locals.volunteerId = payload.vid;
    next();
  }, (error: unknown) => next(error));
};
