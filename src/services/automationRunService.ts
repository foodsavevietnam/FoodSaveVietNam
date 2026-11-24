/**
 * Nhật ký chạy tác vụ tự động (bảng automation_runs, SQL 036). Ghi lỗi nhật ký KHÔNG làm hỏng tác vụ.
 * Các tác vụ: label-automation, order-automation, complaint-escalation, push-reminders.
 */
import { logger } from "../utils/logger";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const AUTOMATION_JOBS = ["label-automation", "order-automation", "complaint-escalation", "push-reminders"] as const;
export type AutomationJob = (typeof AUTOMATION_JOBS)[number];
export type AutomationTrigger = "schedule" | "manual";

const JOB_LABEL: Record<AutomationJob, { name: string; every: string }> = {
  "label-automation": { name: "Đổi nhãn / giá / chia hàng đỏ", every: "mỗi 5 phút" },
  "order-automation": { name: "Đơn hàng: quá hạn thanh toán, vắng mặt, nhắc lấy hàng", every: "mỗi 5 phút" },
  "complaint-escalation": { name: "Khiếu nại: tự chuyển Admin sau 12 giờ, hoàn tất hoàn tiền dang dở", every: "chạy cùng tác vụ đơn hàng (5 phút)" },
  "push-reminders": { name: "Thông báo đẩy: nhắc nhiệm vụ tình nguyện viên", every: "chạy cùng tác vụ đơn hàng (5 phút)" }
};

export const automationRunService = {
  async record(job: AutomationJob, trigger: AutomationTrigger, startedAt: Date, summary: Record<string, unknown>, error: string | null): Promise<void> {
    try {
      const { error: dbError } = await supabaseAdmin.from("automation_runs").insert({
        job,
        trigger,
        started_at: startedAt.toISOString(),
        finished_at: new Date().toISOString(),
        ok: error === null,
        summary,
        error
      });
      if (dbError) logger.warn("Không ghi được nhật ký tác vụ tự động", { job, error: dbError });
    } catch (dbError) {
      logger.warn("Không ghi được nhật ký tác vụ tự động", { job, error: dbError });
    }
  },

  /** Chạy một việc, ghi kết quả (thành công hoặc lỗi) rồi trả lại / ném lại kết quả gốc */
  async track<T extends object>(job: AutomationJob, trigger: AutomationTrigger, work: () => Promise<T>): Promise<T> {
    const startedAt = new Date();
    try {
      const result = await work();
      const errors = (result as { errors?: unknown }).errors;
      const firstErrors = Array.isArray(errors) && errors.length > 0 ? errors.map(String).join("; ").slice(0, 500) : null;
      await this.record(job, trigger, startedAt, result as Record<string, unknown>, firstErrors);
      return result;
    } catch (error) {
      await this.record(job, trigger, startedAt, {}, (error instanceof Error ? error.message : String(error)).slice(0, 500));
      throw error;
    }
  },

  /** Xóa an toàn nhật ký chạy cũ hơn retentionDays ngày theo lô để giữ dung lượng bảng automation_runs */
  async purgeOldRuns(retentionDays = 30, batchLimit = 1000): Promise<number> {
    const days = Math.max(1, Math.floor(retentionDays));
    const limit = Math.max(1, Math.min(5000, Math.floor(batchLimit)));
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    try {
      const { data: oldRows, error: selectError } = await supabaseAdmin
        .from("automation_runs")
        .select("id")
        .lt("started_at", cutoff)
        .order("started_at", { ascending: true })
        .limit(limit);
      if (selectError) {
        logger.warn("Không đọc được nhật ký tự động hóa cũ để dọn", { error: selectError });
        return 0;
      }
      const ids = ((oldRows ?? []) as Array<{ id: string }>).map((row) => row.id).filter(Boolean);
      if (ids.length === 0) return 0;

      let deletedTotal = 0;
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const { data: deleted, error: deleteError } = await supabaseAdmin
          .from("automation_runs")
          .delete()
          .in("id", chunk)
          .select("id");
        if (deleteError) {
          logger.warn("Không xóa được lô nhật ký tự động hóa cũ", { error: deleteError, chunkSize: chunk.length });
          break;
        }
        deletedTotal += (deleted ?? []).length;
      }
      return deletedTotal;
    } catch (error) {
      logger.warn("Lỗi khi dọn nhật ký tự động hóa cũ", { error });
      return 0;
    }
  },

  /** Mỗi tác vụ: lần chạy gần nhất + lần lỗi gần nhất + 5 lần chạy cuối + thống kê đầy đủ 7 ngày */
  async overview(): Promise<Array<Record<string, unknown>>> {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    type RunRow = {
      id: string;
      job: string;
      trigger: string;
      started_at: string;
      finished_at: string | null;
      ok: boolean;
      summary: unknown;
      error: string | null;
    };

    return Promise.all(
      AUTOMATION_JOBS.map(async (job) => {
        const [recentRes, lastFailRes, totalRes, failRes] = await Promise.all([
          supabaseAdmin
            .from("automation_runs")
            .select("id,job,trigger,started_at,finished_at,ok,summary,error")
            .eq("job", job)
            .gte("started_at", since)
            .order("started_at", { ascending: false })
            .limit(5),
          supabaseAdmin
            .from("automation_runs")
            .select("started_at,error")
            .eq("job", job)
            .eq("ok", false)
            .gte("started_at", since)
            .order("started_at", { ascending: false })
            .limit(1),
          supabaseAdmin
            .from("automation_runs")
            .select("id", { count: "exact", head: true })
            .eq("job", job)
            .gte("started_at", since),
          supabaseAdmin
            .from("automation_runs")
            .select("id", { count: "exact", head: true })
            .eq("job", job)
            .eq("ok", false)
            .gte("started_at", since)
        ]);

        const firstError = recentRes.error ?? lastFailRes.error ?? totalRes.error ?? failRes.error;
        if (firstError) handleSupabaseError(firstError, "Failed to load automation runs");

        const recent = (recentRes.data ?? []) as RunRow[];
        const last = recent[0] ?? null;
        const lastFailRow = ((lastFailRes.data ?? []) as Array<{ started_at: string; error: string | null }>)[0] ?? null;

        return {
          job,
          name: JOB_LABEL[job].name,
          schedule: JOB_LABEL[job].every,
          last_run: last,
          last_failure: lastFailRow ? { started_at: lastFailRow.started_at, error: lastFailRow.error } : null,
          runs_7d: totalRes.count ?? recent.length,
          failures_7d: failRes.count ?? recent.filter((row) => !row.ok).length,
          recent
        };
      })
    );
  }
};
