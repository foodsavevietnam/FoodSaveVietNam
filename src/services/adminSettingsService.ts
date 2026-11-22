import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { adminAuditService, type AuditActor } from "./adminAuditService";
import { supabaseAdmin } from "./supabaseService";

// Cài đặt chung của hệ thống (bảng app_settings trong SQL 026). Chưa có bảng thì dùng giá trị mặc định.
export const adminSettingsService = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const { data, error } = await supabaseAdmin.from("app_settings").select("value").eq("key", key).maybeSingle();
    if (error || !data) return fallback;
    return ((data as { value: T }).value ?? fallback) as T;
  },

  /** Có `actor` thì ghi nhật ký `settings.update` (giá trị trước/sau) sau khi lưu thành công. */
  async set(key: string, value: unknown, actor?: AuditActor): Promise<void> {
    const before = actor ? await adminSettingsService.get<unknown>(key, null) : null;
    const { error } = await supabaseAdmin.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) throw new AppError("Không lưu được cài đặt. Hãy chạy file SQL 026 trên Supabase.", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    if (actor) await adminAuditService.log(actor, "settings.update", "app_setting", key, { key, before, after: value });
  }
};
