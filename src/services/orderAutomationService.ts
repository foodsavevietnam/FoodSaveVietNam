/**
 * Tác vụ định kỳ của đơn hàng (Netlify Scheduled Function mỗi 5 phút, hoặc nút chạy tay ở Admin).
 * Mỗi bước bọc try/catch riêng: một bước lỗi không làm hỏng các bước còn lại.
 */
import { COMPLETE_GRACE_MINUTES, LABEL_POLICY, policyMs } from "../constants/orderPolicy";
import { env } from "../config/env";
import type { Order, ProductLabel } from "../types/domain";
import { logger } from "../utils/logger";
import { orderChatService } from "./orderChatService";
import { createNotification } from "./notificationService";
import { complaintService } from "./complaintService";
import { automationRunService, type AutomationTrigger } from "./automationRunService";
import { backgroundJobService } from "./backgroundJobService";
import { policyConfigService } from "./policyConfigService";
import { volunteerReminderService } from "./volunteerReminderService";
import { ledgerService } from "./ledgerService";
import { markOrderNoShow, cancelOrderForPaymentTimeout } from "./orderService";
import { supabaseAdmin } from "./supabaseService";
import { locationService } from "./locationService";

const BATCH = 200;
export const DEFAULT_ORDER_AUTOMATION_TIME_BUDGET_MS = 20_000;

export interface OrderAutomationOptions {
  timeBudgetMs?: number;
}

export interface OrderAutomationResult {
  checked_at: string;
  payment_timeouts: number;
  no_shows: number;
  reminders_mid: number;
  reminders_final: number;
  chat_purged: number;
  ledger_synced: number;
  complaints_escalated: number;
  complaints_completed: number;
  volunteer_reminders: number;
  locations_pruned: number;
  runs_purged: number;
  outbox_processed: number;
  budget_reached: boolean;
  errors: string[];
}

const formatVnTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" });

const cancelUnpaid = async (nowIso: string, checkBudget: () => boolean): Promise<number> => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("status", "awaiting_payment")
    .not("pay_deadline", "is", null)
    .lt("pay_deadline", nowIso)
    .limit(BATCH);
  if (error) throw error;
  let done = 0;
  for (const order of (data ?? []) as Order[]) {
    if (!checkBudget()) break;
    if (await cancelOrderForPaymentTimeout(order)) done += 1;
  }
  return done;
};

// Vắng mặt chỉ được xác định SAU hạn lấy + thời gian châm chước (cùng mốc cửa hàng còn được xác nhận hoàn tất)
const markNoShows = async (now: number, checkBudget: () => boolean): Promise<number> => {
  const cutoffIso = new Date(now - policyMs(COMPLETE_GRACE_MINUTES)).toISOString();
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .in("status", ["pending", "confirmed", "ready"])
    .eq("payment_status", "paid")
    .not("pickup_deadline", "is", null)
    .lt("pickup_deadline", cutoffIso)
    .limit(BATCH);
  if (error) throw error;
  let done = 0;
  for (const order of (data ?? []) as Order[]) {
    if (!checkBudget()) break;
    if (await markOrderNoShow(order)) done += 1;
  }
  return done;
};

/** Nhắc giữa chừng (qua nửa thời gian lấy hàng) và nhắc cuối (còn <= 15 phút, nhãn đỏ <= 10 phút). Có cờ chống gửi trùng. */
const sendReminders = async (now: number, checkBudget: () => boolean): Promise<{ mid: number; final: number }> => {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .in("status", ["pending", "confirmed", "ready"])
    .eq("payment_status", "paid")
    .not("pickup_deadline", "is", null)
    .not("paid_at", "is", null)
    .gt("pickup_deadline", new Date(now).toISOString())
    .or("reminder_mid_sent_at.is.null,reminder_final_sent_at.is.null")
    .limit(BATCH);
  if (error) throw error;

  let mid = 0;
  let final = 0;
  for (const order of (data ?? []) as Order[]) {
    if (!checkBudget()) break;
    const paidAt = new Date(order.paid_at as string).getTime();
    const deadline = new Date(order.pickup_deadline as string).getTime();
    const label: ProductLabel = order.policy_label ?? "green";
    const finalWindow = policyMs(LABEL_POLICY[label].finalReminderMinutes);
    const remaining = deadline - now;
    const pastHalf = now >= paidAt + (deadline - paidAt) / 2;
    const dueFinal = remaining <= finalWindow && !order.reminder_final_sent_at;
    const dueMid = pastHalf && !order.reminder_mid_sent_at;
    if (!dueFinal && !dueMid) continue;

    // Claim bằng cờ trước khi gửi: hai lần chạy song song không gửi trùng
    const patch: Record<string, string> = {};
    if (dueMid) patch.reminder_mid_sent_at = new Date(now).toISOString();
    if (dueFinal) patch.reminder_final_sent_at = new Date(now).toISOString();
    let claim = supabaseAdmin.from("orders").update(patch).eq("id", order.id);
    if (dueMid) claim = claim.is("reminder_mid_sent_at", null);
    if (dueFinal) claim = claim.is("reminder_final_sent_at", null);
    const { data: claimed } = await claim.select("id");
    if (!claimed || claimed.length === 0) continue;

    if (dueFinal) {
      final += 1;
      await createNotification({
        recipientId: order.customer_id,
        roleTarget: "customer",
        type: "order-reminder-final",
        title: `Sắp hết hạn lấy hàng · đơn ${order.order_number}`,
        body: `Còn khoảng ${Math.max(1, Math.round(remaining / 60_000))} phút để đến lấy hàng (hạn ${formatVnTime(order.pickup_deadline as string)}). Quá hạn sẽ không được hoàn tiền.`,
        relatedType: "order",
        relatedId: order.id
      });
    } else {
      mid += 1;
      await createNotification({
        recipientId: order.customer_id,
        roleTarget: "customer",
        type: "order-reminder-mid",
        title: `Nhắc lấy hàng · đơn ${order.order_number}`,
        body: `Bạn đã qua nửa thời gian lấy hàng. Hãy đến cửa hàng trước ${formatVnTime(order.pickup_deadline as string)}.`,
        relatedType: "order",
        relatedId: order.id
      });
    }
  }
  return { mid, final };
};

export const orderAutomationService = {
  async run(trigger: AutomationTrigger = "schedule", options: OrderAutomationOptions = {}): Promise<OrderAutomationResult> {
    const startedAtMs = Date.now();
    const timeBudgetMs = options.timeBudgetMs ?? DEFAULT_ORDER_AUTOMATION_TIME_BUDGET_MS;
    const now = startedAtMs;
    const nowIso = new Date(now).toISOString();
    const result: OrderAutomationResult = {
      checked_at: nowIso,
      payment_timeouts: 0,
      no_shows: 0,
      reminders_mid: 0,
      reminders_final: 0,
      chat_purged: 0,
      ledger_synced: 0,
      complaints_escalated: 0,
      complaints_completed: 0,
      volunteer_reminders: 0,
      locations_pruned: 0,
      runs_purged: 0,
      outbox_processed: 0,
      budget_reached: false,
      errors: []
    };
    const checkBudget = (): boolean => {
      if (Date.now() - startedAtMs >= timeBudgetMs) {
        result.budget_reached = true;
        return false;
      }
      return true;
    };
    await policyConfigService.ensureFresh();
    const step = async (name: string, work: () => Promise<void>): Promise<void> => {
      if (!checkBudget()) return;
      try {
        await work();
      } catch (error) {
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        result.errors.push(`${name}: ${message}`);
        logger.error(`Order automation step failed: ${name}`, error);
      }
    };

    // Thứ tự: hủy đơn chưa trả -> no-show -> nhắc nhở (đơn vừa no-show không bị nhắc) -> dọn chat
    await step("payment_timeouts", async () => { result.payment_timeouts = await cancelUnpaid(nowIso, checkBudget); });
    await step("no_shows", async () => { result.no_shows = await markNoShows(now, checkBudget); });
    await step("reminders", async () => {
      const reminders = await sendReminders(now, checkBudget);
      result.reminders_mid = reminders.mid;
      result.reminders_final = reminders.final;
    });
    // Bù bút toán cho đơn chưa có trong sổ cái (ví dụ đơn tạo trước khi bật sổ cái, hoặc lần ghi sổ trước đó bị lỗi)
    await step("ledger_sync", async () => { result.ledger_synced = await ledgerService.syncPendingOrders(); });
    // Khiếu nại: quá 12 giờ cửa hàng chưa phản hồi thì tự chuyển Admin; hoàn tất các quyết định hoàn tiền còn dang dở
    // Mỗi bước phụ có dòng nhật ký riêng để màn "Tự động hóa" của Admin hiện đúng lần chạy gần nhất của từng tác vụ
    const sub = async (job: "complaint-escalation" | "push-reminders", work: () => Promise<Record<string, number>>): Promise<void> => {
      if (!checkBudget()) return;
      const startedAt = new Date();
      const before = result.errors.length;
      let summary: Record<string, number> = {};
      await step(job, async () => { summary = await work(); Object.assign(result, summary); });
      const failure = result.errors.length > before ? result.errors.slice(before).join("; ").slice(0, 500) : null;
      await automationRunService.record(job, trigger, startedAt, summary, failure);
    };
    // Khiếu nại: quá 12 giờ cửa hàng chưa phản hồi thì tự chuyển Admin; hoàn tất các quyết định hoàn tiền còn dang dở
    await sub("complaint-escalation", async () => ({ complaints_escalated: await complaintService.escalateOverdue(), complaints_completed: await complaintService.completePendingOutcomes() }));
    // Nhắc tình nguyện viên khi nhiệm vụ lấy hàng sắp hết hạn (push)
    await sub("push-reminders", async () => ({ volunteer_reminders: await volunteerReminderService.run() }));
    await step("chat_purge", async () => { result.chat_purged = await orderChatService.purgeOldMessages(); });
    // Xóa vị trí cũ hơn 2 giờ và vị trí của nhiệm vụ không còn hoạt động
    await step("location_prune", async () => { result.locations_pruned = await locationService.pruneInactive(); });
    // Dọn nhật ký chạy tác vụ tự động cũ hơn 30 ngày
    await step("automation_runs_purge", async () => { result.runs_purged = await automationRunService.purgeOldRuns(30); });
    // Xử lý hàng đợi Outbox khi bật cờ OUTBOX_ENABLED và còn đủ ngân sách thời gian (> 3 giây)
    if (env.OUTBOX_ENABLED) {
      const remainingMs = timeBudgetMs - (Date.now() - startedAtMs);
      if (remainingMs > 3000) {
        await step("outbox_process", async () => {
          const outbox = await backgroundJobService.processPendingJobs({
            limit: 10,
            timeBudgetMs: Math.min(5000, remainingMs)
          });
          result.outbox_processed = outbox.done;
        });
      }
    }

    if (result.budget_reached) {
      logger.warn("Order automation stopped early due to time budget", { timeBudgetMs, result });
    } else {
      logger.info("Order automation finished", result);
    }
    return result;
  }
};
