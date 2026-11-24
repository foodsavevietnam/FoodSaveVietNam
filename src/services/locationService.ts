/**
 * Chia sẻ vị trí khi làm nhiệm vụ (đặc tả live-location 5.1-5.2).
 * - Mỗi người đúng MỘT dòng live_locations (khóa chính actor_kind + actor_id).
 * - Chỉ ghi khi đã đồng ý VÀ đang có nhiệm vụ hoạt động thuộc đúng người gửi; ngược lại xóa dòng cũ.
 * - Giờ thiết bị không đáng tin: recorded_at ở tương lai hoặc cũ hơn 10 phút bị kẹp về giờ server.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { env } from "../config/env";
import { AppError } from "../utils/appError";
import { googleMapsDirectionsUrl, haversineKm, roadKm, travelMinutes } from "../core/routing";
import { logger } from "../utils/logger";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

const MIGRATION_PENDING_CODES = new Set(["42883", "42P01", "PGRST202", "PGRST205"]);
const warnedMissingRpcs = new Set<string>();

const isMigrationPendingError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && MIGRATION_PENDING_CODES.has(code);
};

const warnMissingRpcOnce = (rpcName: string, error: unknown): void => {
  if (warnedMissingRpcs.has(rpcName)) return;
  warnedMissingRpcs.add(rpcName);
  logger.warn(`RPC ${rpcName} chưa sẵn sàng (chưa áp dụng SQL 042); tự động chuyển về luồng JS dự phòng`, {
    rpc: rpcName,
    code: (error as { code?: string } | null)?.code,
    message: (error as { message?: string } | null)?.message
  });
};

export type LocationActor = { kind: "volunteer" | "customer"; id: string };
export type LocationContext = { kind: "donation" | "order"; id: string };
export interface LocationReportInput {
  lat: number;
  lng: number;
  accuracy_m?: number | undefined;
  heading?: number | undefined;
  speed_mps?: number | undefined;
  recorded_at?: string | undefined;
  context: LocationContext;
}

export type LiveLocationView = {
  actor_kind: "volunteer" | "customer";
  actor_id: string;
  name: string;
  context_kind: "donation" | "order";
  context_id: string;
  context_code: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  updated_at: string;
  destination: { lat: number; lng: number; label: string } | null;
  directions_url: string | null;
};

export const THROTTLE_MS = 55 * 1000;
export const VISIBLE_WINDOW_MS = 30 * 60 * 1000;
export const STALE_AFTER_MS = 2 * 60 * 60 * 1000;
const LIST_LIMIT = 500;
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;
const DONATION_ACTIVE_STATUSES = ["accepted", "in_route", "completed"];
const DONATION_LEGACY_STATUSES = ["accepted", "in_route"];
const ORDER_ACTIVE_STATUSES = ["pending", "confirmed", "ready"];

// Hàng đợi theo từng người trong tiến trình: hai tab gửi song song được xử lý lần lượt,
// nên kiểm tra throttle + ghi không xen kẽ. Khóa chính trong DB vẫn bảo đảm 1 dòng giữa nhiều tiến trình.
const queues = new Map<string, Promise<unknown>>();
const serialize = <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const run = (queues.get(key) ?? Promise.resolve()).then(work, work);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
};

const actorKey = (actor: LocationActor): string => `${actor.kind}:${actor.id}`;

const clampRecordedAt = (recordedAt: string | undefined, nowMs: number): string => {
  const parsed = recordedAt ? new Date(recordedAt).getTime() : Number.NaN;
  if (!Number.isFinite(parsed) || parsed > nowMs || parsed < nowMs - MAX_CLOCK_SKEW_MS) return new Date(nowMs).toISOString();
  return new Date(parsed).toISOString();
};

type LiveRow = {
  actor_kind: "volunteer" | "customer";
  actor_id: string;
  context_kind: "donation" | "order";
  context_id: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  updated_at: string;
};
type Point = { lat: number; lng: number; label: string };
type PlaceRow = { id: string; name: string | null; latitude: number | null; longitude: number | null };

const pointOf = (row: PlaceRow | null | undefined, fallback: string): Point | null => {
  if (!row || typeof row.latitude !== "number" || typeof row.longitude !== "number") return null;
  return { lat: row.latitude, lng: row.longitude, label: row.name || fallback };
};

const byId = async <T extends { id: string }>(table: string, columns: string, ids: string[]): Promise<Map<string, T>> => {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from(table).select(columns).in("id", unique);
  if (error) handleSupabaseError(error, "Không đọc được dữ liệu liên quan đến vị trí");
  return new Map(((data ?? []) as unknown as T[]).map((row) => [row.id, row]));
};

type OrderFacts = { customer_id?: string; payment_status?: string; status?: string; order_number?: string; store_id?: string };
type DonationFacts = { status?: string; assigned_volunteer_id?: string | null; distribution_done_at?: string | null; donation_code?: string; store_id?: string; charity_id?: string | null };

// Hàm thuần quyết định "nhiệm vụ còn hoạt động" từ dữ liệu đã nạp; dùng chung cho isActiveTask và dọn theo lô
const isOrderActive = (order: OrderFacts | null | undefined, customerId: string): boolean =>
  Boolean(order && order.customer_id === customerId && order.payment_status === "paid" && ORDER_ACTIVE_STATUSES.includes(order.status ?? ""));

const isDonationActive = (donation: DonationFacts | null | undefined, openAssignments: Array<{ stage: string }>, volunteerId: string): boolean => {
  if (!donation) return false;
  const viaAssignment = openAssignments.some((item) =>
    DONATION_ACTIVE_STATUSES.includes(donation.status ?? "") && (item.stage !== "distribute" || !donation.distribution_done_at));
  if (viaAssignment) return true;
  return donation.assigned_volunteer_id === volunteerId && DONATION_LEGACY_STATUSES.includes(donation.status ?? "");
};

type ActivityRow = Pick<LiveRow, "actor_kind" | "actor_id" | "context_kind" | "context_id">;

// Nạp theo lô (đơn, lô, phân công mở) để quyết định dòng nào còn nhiệm vụ hoạt động; dùng chung cho dọn và đọc
const loadActivity = async (live: ActivityRow[]) => {
  const orderIds = Array.from(new Set(live.filter((r) => r.context_kind === "order").map((r) => r.context_id)));
  const donationIds = Array.from(new Set(live.filter((r) => r.context_kind === "donation").map((r) => r.context_id)));
  const orders = new Map<string, OrderFacts & { id: string }>();
  const donations = new Map<string, DonationFacts & { id: string }>();
  const assignments = new Map<string, Array<{ stage: string }>>();
  if (orderIds.length > 0) {
    const { data: rows, error: e } = await supabaseAdmin.from("orders").select("id,customer_id,payment_status,status,order_number,store_id").in("id", orderIds);
    if (e) handleSupabaseError(e, "Không kiểm tra được đơn hàng");
    for (const row of (rows ?? []) as Array<OrderFacts & { id: string }>) orders.set(row.id, row);
  }
  if (donationIds.length > 0) {
    const { data: rows, error: e } = await supabaseAdmin.from("donations")
      .select("id,status,assigned_volunteer_id,distribution_done_at,donation_code,store_id,charity_id").in("id", donationIds);
    if (e) handleSupabaseError(e, "Không kiểm tra được lô quyên góp");
    for (const row of (rows ?? []) as Array<DonationFacts & { id: string }>) donations.set(row.id, row);
    const { data: asg, error: ae } = await supabaseAdmin.from("donation_assignments").select("donation_id,volunteer_id,stage").in("donation_id", donationIds).is("done_at", null);
    if (ae) handleSupabaseError(ae, "Không kiểm tra được phân công");
    for (const row of (asg ?? []) as Array<{ donation_id: string; volunteer_id: string; stage: string }>) {
      const key = row.donation_id + ":" + row.volunteer_id;
      assignments.set(key, [...(assignments.get(key) ?? []), { stage: row.stage }]);
    }
  }
  const isActive = (row: ActivityRow): boolean => row.context_kind === "order"
    ? row.actor_kind === "customer" && isOrderActive(orders.get(row.context_id), row.actor_id)
    : row.actor_kind === "volunteer" && isDonationActive(donations.get(row.context_id), assignments.get(row.context_id + ":" + row.actor_id) ?? [], row.actor_id);
  return { orders, donations, isActive };
};

// Ghép tên, mã nhiệm vụ, điểm đến cho các dòng vị trí. Chỉ gọi từ hàm đã kiểm tra vai trò.
// Dòng có nhiệm vụ đã hết bị bỏ qua (kiểm tra theo lô); đọc không xóa gì, cron pruneInactive dọn mỗi 5 phút.
const toViews = async (allRows: LiveRow[]): Promise<LiveLocationView[]> => {
  if (allRows.length === 0) return [];
  const activity = await loadActivity(allRows);
  const rows = allRows.filter((row) => activity.isActive(row));
  if (rows.length === 0) return [];
  const { orders, donations } = activity;
  const volunteers = await byId<{ id: string; full_name: string | null }>("volunteers", "id,full_name", rows.filter((r) => r.actor_kind === "volunteer").map((r) => r.actor_id));
  const customers = await byId<{ id: string; full_name: string | null }>("profiles", "id,full_name", rows.filter((r) => r.actor_kind === "customer").map((r) => r.actor_id));
  const storeIds = [...Array.from(orders.values()).map((o) => o.store_id), ...Array.from(donations.values()).map((d) => d.store_id)]
    .filter((id): id is string => Boolean(id));
  const stores = await byId<PlaceRow>("stores", "id,name,latitude,longitude", storeIds);
  const charities = await byId<PlaceRow>("charity_profiles", "id,name,latitude,longitude",
    Array.from(donations.values()).map((d) => d.charity_id).filter((id): id is string => Boolean(id)));

  return rows.map((row) => {
    let code = "";
    let destination: Point | null = null;
    if (row.context_kind === "order") {
      const order = orders.get(row.context_id);
      code = order?.order_number ?? "";
      destination = pointOf(order?.store_id ? stores.get(order.store_id) : null, "Cửa hàng");
    } else {
      const donation = donations.get(row.context_id);
      code = donation?.donation_code ?? "";
      // Chưa lấy xong hàng (accepted/in_route) thì đi tới cửa hàng; sau đó tới điểm nhận của tổ chức
      const toStore = !donation || ["accepted", "in_route"].includes(donation.status ?? "");
      destination = toStore
        ? pointOf(donation?.store_id ? stores.get(donation.store_id) : null, "Cửa hàng")
        : pointOf(donation?.charity_id ? charities.get(donation.charity_id) : null, "Tổ chức");
    }
    const name = (row.actor_kind === "volunteer" ? volunteers.get(row.actor_id)?.full_name : customers.get(row.actor_id)?.full_name)
      || (row.actor_kind === "volunteer" ? "Tình nguyện viên" : "Người mua");
    return {
      actor_kind: row.actor_kind,
      actor_id: row.actor_id,
      name,
      context_kind: row.context_kind,
      context_id: row.context_id,
      context_code: code,
      lat: row.lat,
      lng: row.lng,
      accuracy_m: row.accuracy_m ?? null,
      updated_at: row.updated_at,
      destination,
      directions_url: destination ? googleMapsDirectionsUrl(destination, { origin: { lat: row.lat, lng: row.lng } }) : null
    };
  });
};

const clearNow = async (actor: LocationActor): Promise<void> => {
  const { error } = await supabaseAdmin.from("live_locations").delete().eq("actor_kind", actor.kind).eq("actor_id", actor.id);
  if (error) handleSupabaseError(error, "Không xóa được vị trí");
};

export const locationService = {
  async setConsent(actor: LocationActor, granted: boolean, policyVersion: string, userAgent?: string): Promise<{ granted: boolean }> {
    // Cùng hàng đợi với report để một report đang chạy không ghi đè lên việc rút đồng ý
    return serialize(actorKey(actor), async () => {
    const { error } = await supabaseAdmin.from("location_consents").upsert({
      actor_kind: actor.kind,
      actor_id: actor.id,
      granted,
      policy_version: policyVersion,
      decided_at: new Date().toISOString(),
      user_agent: userAgent ? userAgent.slice(0, 300) : null
    }, { onConflict: "actor_kind,actor_id" });
    if (error) handleSupabaseError(error, "Không lưu được lựa chọn chia sẻ vị trí");
    if (!granted) await clearNow(actor);
    return { granted };
    });
  },

  async hasConsent(actor: LocationActor): Promise<boolean> {
    return (await locationService.consentStatus(actor)) === "granted";
  },

  // "none": chưa từng chọn · "revoked": đã chọn tắt (có thể từ máy khác) · "granted": đang cho phép
  async consentStatus(actor: LocationActor): Promise<"granted" | "revoked" | "none"> {
    const { data, error } = await supabaseAdmin
      .from("location_consents")
      .select("granted")
      .eq("actor_kind", actor.kind)
      .eq("actor_id", actor.id)
      .maybeSingle();
    if (error) handleSupabaseError(error, "Không đọc được lựa chọn chia sẻ vị trí");
    if (!data) return "none";
    return (data as { granted?: boolean }).granted === true ? "granted" : "revoked";
  },

  async isActiveTask(actor: LocationActor, context: LocationContext): Promise<boolean> {
    if (actor.kind === "customer") {
      if (context.kind !== "order") return false;
      const { data, error } = await supabaseAdmin
        .from("orders")
        .select("id,customer_id,payment_status,status")
        .eq("id", context.id)
        .eq("customer_id", actor.id)
        .maybeSingle();
      if (error) handleSupabaseError(error, "Không kiểm tra được đơn hàng");
      return isOrderActive(data as OrderFacts | null, actor.id);
    }
    if (context.kind !== "donation") return false;
    const { data: donationData, error: donationError } = await supabaseAdmin
      .from("donations")
      .select("id,status,assigned_volunteer_id,distribution_done_at")
      .eq("id", context.id)
      .maybeSingle();
    if (donationError) handleSupabaseError(donationError, "Không kiểm tra được lô quyên góp");
    if (!donationData) return false;
    const { data: assignmentData, error: assignmentError } = await supabaseAdmin
      .from("donation_assignments")
      .select("stage,done_at")
      .eq("donation_id", context.id)
      .eq("volunteer_id", actor.id)
      .is("done_at", null);
    if (assignmentError) handleSupabaseError(assignmentError, "Không kiểm tra được phân công");
    return isDonationActive(donationData as DonationFacts, (assignmentData ?? []) as Array<{ stage: string }>, actor.id);
  },

  async report(actor: LocationActor, input: LocationReportInput): Promise<{ stored: boolean; throttled: boolean }> {
    return serialize(actorKey(actor), async () => {
      if (env.LOCATION_RPC_ENABLED) {
        const active = await locationService.isActiveTask(actor, input.context);
        if (!active) {
          const consent = await locationService.consentStatus(actor);
          await clearNow(actor);
          if (consent === "revoked") {
            throw new AppError("Bạn đã tắt chia sẻ vị trí.", HTTP_STATUS.FORBIDDEN, ERROR_CODES.LOCATION_CONSENT_REVOKED);
          }
          if (consent !== "granted") {
            throw new AppError("Bạn chưa đồng ý chia sẻ vị trí.", HTTP_STATUS.FORBIDDEN, ERROR_CODES.LOCATION_CONSENT_REQUIRED);
          }
          throw new AppError("Hiện không có nhiệm vụ đang hoạt động để chia sẻ vị trí.", HTTP_STATUS.CONFLICT, ERROR_CODES.NO_ACTIVE_TASK);
        }

        const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("fs_report_live_location", {
          p_actor_kind: actor.kind,
          p_actor_id: actor.id,
          p_latitude: input.lat,
          p_longitude: input.lng,
          p_accuracy_m: input.accuracy_m ?? null,
          p_heading: input.heading ?? null,
          p_speed_mps: input.speed_mps ?? null,
          p_min_interval_sec: Math.round(THROTTLE_MS / 1000),
          p_context_kind: input.context.kind,
          p_context_id: input.context.id,
          p_recorded_at: input.recorded_at ?? null
        });

        if (!rpcError) {
          const outcome = (rpcData ?? {}) as { stored?: boolean; throttled?: boolean; reason?: string };
          if (outcome.reason === "consent_revoked") {
            throw new AppError("Bạn đã tắt chia sẻ vị trí.", HTTP_STATUS.FORBIDDEN, ERROR_CODES.LOCATION_CONSENT_REVOKED);
          }
          if (outcome.reason === "consent_required") {
            throw new AppError("Bạn chưa đồng ý chia sẻ vị trí.", HTTP_STATUS.FORBIDDEN, ERROR_CODES.LOCATION_CONSENT_REQUIRED);
          }
          return { stored: Boolean(outcome.stored), throttled: Boolean(outcome.throttled) };
        }

        if (isMigrationPendingError(rpcError)) {
          warnMissingRpcOnce("fs_report_live_location", rpcError);
        } else {
          handleSupabaseError(rpcError, "Không lưu được vị trí qua RPC");
        }
      }

      const consent = await locationService.consentStatus(actor);
      if (consent !== "granted") {
        await clearNow(actor);
        // Phân biệt "đã tắt" với "chưa chọn": máy khác không được tự bật lại khi người dùng đã tắt
        if (consent === "revoked") {
          throw new AppError("Bạn đã tắt chia sẻ vị trí.", HTTP_STATUS.FORBIDDEN, ERROR_CODES.LOCATION_CONSENT_REVOKED);
        }
        throw new AppError("Bạn chưa đồng ý chia sẻ vị trí.", HTTP_STATUS.FORBIDDEN, ERROR_CODES.LOCATION_CONSENT_REQUIRED);
      }
      if (!(await locationService.isActiveTask(actor, input.context))) {
        await clearNow(actor);
        throw new AppError("Hiện không có nhiệm vụ đang hoạt động để chia sẻ vị trí.", HTTP_STATUS.CONFLICT, ERROR_CODES.NO_ACTIVE_TASK);
      }
      const nowMs = Date.now();
      const { data: existingData, error: readError } = await supabaseAdmin
        .from("live_locations")
        .select("context_kind,context_id,updated_at")
        .eq("actor_kind", actor.kind)
        .eq("actor_id", actor.id)
        .maybeSingle();
      if (readError) handleSupabaseError(readError, "Không đọc được vị trí trước đó");
      const existing = existingData as { context_kind: string; context_id: string; updated_at: string } | null;
      const sameContext = existing && existing.context_kind === input.context.kind && String(existing.context_id) === input.context.id;
      if (existing && sameContext && nowMs - new Date(existing.updated_at).getTime() < THROTTLE_MS) {
        return { stored: false, throttled: true };
      }
      const { error } = await supabaseAdmin.from("live_locations").upsert({
        actor_kind: actor.kind,
        actor_id: actor.id,
        context_kind: input.context.kind,
        context_id: input.context.id,
        lat: input.lat,
        lng: input.lng,
        accuracy_m: input.accuracy_m ?? null,
        recorded_at: clampRecordedAt(input.recorded_at, nowMs),
        updated_at: new Date(nowMs).toISOString()
      }, { onConflict: "actor_kind,actor_id" });
      if (error) handleSupabaseError(error, "Không lưu được vị trí");
      return { stored: true, throttled: false };
    });
  },

  async clear(actor: LocationActor): Promise<void> {
    return serialize(actorKey(actor), () => clearNow(actor));
  },

  // Xóa mọi dòng gắn với một đơn/lô (đơn hoàn tất, lô bàn giao xong)
  async clearForContext(context: LocationContext): Promise<void> {
    const { error } = await supabaseAdmin.from("live_locations").delete().eq("context_kind", context.kind).eq("context_id", context.id);
    if (error) handleSupabaseError(error, "Không xóa được vị trí theo nhiệm vụ");
  },

  // Xóa dòng cũ hơn 2 giờ và dòng không còn nhiệm vụ hoạt động (kiểm tra theo lô). Trả về số dòng đã xóa.
  async pruneInactive(now: Date = new Date()): Promise<number> {
    let removed = 0;
    const { data: old, error: oldError } = await supabaseAdmin
      .from("live_locations").delete().lt("updated_at", new Date(now.getTime() - STALE_AFTER_MS).toISOString()).select("actor_id");
    if (oldError) handleSupabaseError(oldError, "Không dọn được vị trí cũ");
    removed += (old ?? []).length;
    const { data, error } = await supabaseAdmin.from("live_locations").select("actor_kind,actor_id,context_kind,context_id");
    if (error) handleSupabaseError(error, "Không đọc được vị trí để dọn");
    const live = (data ?? []) as Array<{ actor_kind: LocationActor["kind"]; actor_id: string; context_kind: LocationContext["kind"]; context_id: string }>;
    if (live.length === 0) return removed;

    const activity = await loadActivity(live);
    for (const row of live) {
      if (activity.isActive(row)) continue;
      try {
        await locationService.clear({ kind: row.actor_kind, id: row.actor_id });
        removed += 1;
      } catch (err) {
        logger.warn("Không dọn được một dòng vị trí", { actor: row.actor_id, error: err });
      }
    }
    return removed;
  },

  async listForAdmin(filter: { kind?: "volunteer" | "customer" } = {}): Promise<LiveLocationView[]> {
    let query = supabaseAdmin.from("live_locations").select("*").gte("updated_at", new Date(Date.now() - VISIBLE_WINDOW_MS).toISOString());
    if (filter.kind === "volunteer" || filter.kind === "customer") query = query.eq("actor_kind", filter.kind);
    const { data, error } = await query.order("updated_at", { ascending: false }).limit(LIST_LIMIT);
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        logger.warn("Bảng live_locations chưa tồn tại (chưa áp dụng SQL 039); trả danh sách rỗng", { code: error.code, message: error.message });
        return [];
      }
      handleSupabaseError(error, "Không đọc được danh sách vị trí");
    }
    return toViews((data ?? []) as LiveRow[]);
  },

  // Mặc định từ chối: người gọi không sở hữu tổ chức nào → mảng rỗng
  async listForCharity(actorId: string): Promise<LiveLocationView[]> {
    if (!actorId) return [];
    const { data: owned, error: ownedError } = await supabaseAdmin.from("charity_profiles").select("id").eq("owner_id", actorId);
    if (ownedError) handleSupabaseError(ownedError, "Không đọc được tổ chức");
    const charityIds = ((owned ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (charityIds.length === 0) return [];
    const { data: vols, error: volError } = await supabaseAdmin.from("volunteers").select("id").in("charity_id", charityIds);
    if (volError) handleSupabaseError(volError, "Không đọc được tình nguyện viên");
    const volIds = ((vols ?? []) as Array<{ id: string }>).map((v) => v.id);
    if (volIds.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from("live_locations").select("*")
      .eq("actor_kind", "volunteer").in("actor_id", volIds)
      .gte("updated_at", new Date(Date.now() - VISIBLE_WINDOW_MS).toISOString())
      .order("updated_at", { ascending: false }).limit(LIST_LIMIT);
    if (error) handleSupabaseError(error, "Không đọc được vị trí tình nguyện viên");
    return toViews((data ?? []) as LiveRow[]);
  },

  // Cửa hàng chỉ nhận khoảng cách/ETA của khách, KHÔNG BAO GIỜ trả tọa độ
  async customerEta(partnerId: string, orderId: string): Promise<{ distance_km: number | null; eta_minutes: number | null; updated_at: string | null }> {
    const notFound = () => new AppError("Không tìm thấy đơn hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    const { data: storeData, error: storeError } = await supabaseAdmin.from("stores").select("id,latitude,longitude").eq("owner_id", partnerId);
    if (storeError) handleSupabaseError(storeError, "Không đọc được cửa hàng");
    const stores = (storeData ?? []) as Array<{ id: string; latitude: number | null; longitude: number | null }>;
    if (stores.length === 0) throw notFound();
    const { data: orderData, error: orderError } = await supabaseAdmin.from("orders").select("id,customer_id,store_id,payment_status,status").eq("id", orderId).in("store_id", stores.map((s) => s.id)).maybeSingle();
    if (orderError) handleSupabaseError(orderError, "Không đọc được đơn hàng");
    const order = orderData as { id: string; customer_id: string; store_id: string; payment_status?: string; status?: string } | null;
    if (!order) throw notFound();
    const empty = { distance_km: null, eta_minutes: null, updated_at: null };
    // Đơn đã hủy/no-show/hoàn tất/chưa thanh toán thì không còn theo dõi
    if (!isOrderActive(order, order.customer_id)) return empty;
    const store = stores.find((s) => s.id === order.store_id);
    const { data: locData, error: locError } = await supabaseAdmin
      .from("live_locations").select("lat,lng,updated_at")
      .eq("actor_kind", "customer").eq("actor_id", order.customer_id)
      .eq("context_kind", "order").eq("context_id", order.id)
      .gte("updated_at", new Date(Date.now() - VISIBLE_WINDOW_MS).toISOString())
      .maybeSingle();
    if (locError) handleSupabaseError(locError, "Không đọc được vị trí khách");
    const loc = locData as { lat: number; lng: number; updated_at: string } | null;
    if (!loc || !store || typeof store.latitude !== "number" || typeof store.longitude !== "number") return empty;
    const crowKm = haversineKm({ lat: loc.lat, lng: loc.lng }, { lat: store.latitude, lng: store.longitude });
    return {
      distance_km: Math.max(0.01, Math.round(roadKm(crowKm) * 100) / 100),
      eta_minutes: Math.max(1, Math.ceil(travelMinutes(crowKm))),
      updated_at: loc.updated_at
    };
  }
};
