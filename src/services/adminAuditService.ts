import { logger } from "../utils/logger";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export interface AuditActor { userId: string; name?: string | null }

export interface AuditFilter { action?: string; actor_id?: string; target_type?: string; target_id?: string; from?: string; to?: string }

/** Thoát ký tự đại diện của ilike để tiền tố khớp đúng nghĩa đen. */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

export const adminAuditService = {
  /** Ghi nhật ký thao tác Admin. Không bao giờ làm hỏng thao tác chính: lỗi ghi chỉ được cảnh báo. */
  async log(actor: AuditActor | null, action: string, targetType: string | null, targetId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
    try {
      const { error } = await supabaseAdmin.from("admin_audit_log").insert({
        actor_id: actor?.userId ?? null,
        actor_name: actor?.name ?? null,
        action,
        target_type: targetType,
        target_id: targetId,
        detail
      });
      if (error) logger.warn("Không ghi được nhật ký Admin", { action, error });
    } catch (error) {
      logger.warn("Không ghi được nhật ký Admin", { action, error });
    }
  },

  async list(limit = 100, filter: AuditFilter = {}): Promise<Array<Record<string, unknown>>> {
    let query = supabaseAdmin
      .from("admin_audit_log")
      .select("id,actor_id,actor_name,action,target_type,target_id,detail,created_at");
    if (filter.action) query = query.ilike("action", `${escapeLike(filter.action)}%`);
    if (filter.actor_id) query = query.eq("actor_id", filter.actor_id);
    if (filter.target_type) query = query.eq("target_type", filter.target_type);
    if (filter.target_id) query = query.eq("target_id", filter.target_id);
    if (filter.from) query = query.gte("created_at", filter.from);
    if (filter.to) query = query.lte("created_at", filter.to);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 300));
    if (error) handleSupabaseError(error, "Failed to load audit log");
    return (data ?? []) as Array<Record<string, unknown>>;
  }
};
