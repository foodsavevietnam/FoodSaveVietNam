/**
 * Wave 5A — Admin Portal Đợt 3 (Hoạt động):
 *   - Đơn hàng (GET /admin/orders, GET /admin/orders/:id, POST /admin/orders/:id/status, POST /admin/orders/:id/note)
 *   - Lô tặng (GET /admin/donations, GET /admin/donations/:id, POST /admin/donations/:id/cancel)
 *   - Hàng đang bán (GET /admin/products, GET /admin/products/:id, POST /admin/products/:id/visibility)
 *   - Sự kiện thanh toán (GET /admin/payments, GET /admin/payments/summary)
 *   - Đánh giá (GET /admin/reviews, POST /admin/reviews/:id/visibility)
 *
 * Bảo mật & tương thích ngược:
 *   - TUYỆT ĐỐI không trả `pickup_code` hoặc `qr_code` trên lô tặng (kể cả đã hoàn tất) hoặc đơn hàng chưa hoàn tất (`status !== "completed"`).
 *   - Tương thích ngược khi SQL 034/039 (`payment_events`, `live_locations` -> 42P01/PGRST205) hoặc SQL 043 (`admin_hidden_*`, `hidden_*` -> 42703/PGRST204) chưa áp dụng.
 *   - Mọi thao tác can thiệp ghi nhận vào `admin_audit_log` qua `adminAuditService.log`.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { COMPLETE_GRACE_MINUTES, policyMs } from "../constants/orderPolicy";
import { sanitizeSearch } from "../schemas/adminSchemas";
import type { Order } from "../types/domain";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { adminAuditService, type AuditActor } from "./adminAuditService";
import { applySearch, loadByIds, maskPhone, paginate, type ListResult } from "./adminListing";
import { signEvidenceUrls } from "./complaintService";
import { VISIBLE_WINDOW_MS } from "./locationService";
import { orderService } from "./orderService";
import { sellerReputationService } from "./sellerReputationService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

type Row = Record<string, any>;

const extractCode = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string" && direct !== ERROR_CODES.SUPABASE_ERROR) return direct;
  const details = (error as { details?: unknown }).details;
  if (details && typeof details === "object") {
    const nested = (details as { code?: unknown }).code;
    if (typeof nested === "string") return nested;
  }
  return typeof direct === "string" ? direct : null;
};

const isMissingTableError = (error: unknown): boolean => {
  const code = extractCode(error);
  return code === "42P01" || code === "PGRST205";
};

const isMissingColumnError = (error: unknown): boolean => {
  const code = extractCode(error);
  return code === "42703" || code === "PGRST204";
};

const parseSort = (sort: string | undefined, defaultCol: string, defaultAsc = false): { col: string; ascending: boolean } => {
  if (!sort) return { col: defaultCol, ascending: defaultAsc };
  const [col, dir] = sort.split(".");
  return { col: col || defaultCol, ascending: dir === "asc" };
};

const normalizeDateBound = (value: string | undefined, bound: "from" | "to"): string | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return bound === "from" ? `${trimmed}T00:00:00.000Z` : `${trimmed}T23:59:59.999Z`;
  }
  return trimmed;
};

const requireReason = (reason: string | undefined, actionText: string, minLen = 3): string => {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < minLen) {
    throw new AppError(`Cần nhập ${actionText} (ít nhất ${minLen} ký tự)`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  return trimmed;
};

/** Che/bỏ hoàn toàn pickup_code và qr_code trên đơn chưa hoàn tất. */
const sanitizeOrderRow = (row: Row): Row => {
  if (row.status === "completed") {
    const { pickup_code: _omitPickup, ...rest } = row;
    return row.pickup_code !== undefined && row.pickup_code !== null ? row : rest;
  }
  const { pickup_code: _omitPickup, qr_code: _omitQr, ...safe } = row;
  return safe;
};

/** Lô tặng: không bao giờ lộ pickup_code hoặc qr_code cho cổng Admin. */
const sanitizeDonationRow = (row: Row): Row => {
  const { pickup_code: _omitPickup, qr_code: _omitQr, ...safe } = row;
  return safe;
};

const appendOrderEventSafe = async (
  orderId: string,
  eventType: "admin_action" | "admin_note",
  actorId: string,
  metadata: Record<string, unknown>
): Promise<Row> => {
  const createdAt = new Date().toISOString();
  const detailPayload = { actor_id: actorId, actor_role: "admin", ...metadata };
  const richInsert = {
    order_id: orderId,
    event_type: eventType,
    actor_id: actorId,
    actor_role: "admin",
    metadata,
    detail: detailPayload
  };

  try {
    let { data, error } = await supabaseAdmin
      .from("order_events")
      .insert(richInsert)
      .select("*")
      .single();

    if (error && isMissingColumnError(error)) {
      ({ data, error } = await supabaseAdmin
        .from("order_events")
        .insert({
          order_id: orderId,
          event_type: eventType,
          detail: detailPayload
        })
        .select("*")
        .single());
    }

    if (error) {
      if (!isMissingTableError(error)) {
        logger.warn("Không ghi được order_events cho thao tác Admin", { orderId, eventType, error });
      }
      return { order_id: orderId, event_type: eventType, actor_id: actorId, actor_role: "admin", metadata, detail: detailPayload, created_at: createdAt };
    }

    const saved = (data ?? {}) as Row;
    return {
      ...saved,
      actor_id: saved.actor_id ?? actorId,
      actor_role: saved.actor_role ?? "admin",
      metadata: saved.metadata ?? metadata
    };
  } catch (error) {
    logger.warn("Lỗi bất ngờ khi ghi order_events cho Admin", { orderId, eventType, error });
    return { order_id: orderId, event_type: eventType, actor_id: actorId, actor_role: "admin", metadata, detail: detailPayload, created_at: createdAt };
  }
};

/* ─────────────────────────── 1. Orders ─────────────────────────── */

export interface ListAdminOrdersQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  status?: "awaiting_payment" | "pending" | "confirmed" | "ready" | "completed" | "cancelled" | "no_show" | undefined;
  payment_status?: "pending" | "paid" | "refunded" | "failed" | undefined;
  settlement_status?: "none" | "held" | "released" | "forfeited" | "refunded" | "partially_refunded" | undefined;
  store_id?: string | undefined;
  customer_id?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  has_complaint?: boolean | undefined;
  sort?: string | undefined;
}

const listOrders = async (q: ListAdminOrdersQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  const fromIso = normalizeDateBound(q.from, "from");
  const toIso = normalizeDateBound(q.to, "to");

  let complaintOrderIds: string[] | null = null;
  if (q.has_complaint !== undefined) {
    const { data: cRows, error: cErr } = await supabaseAdmin.from("complaints").select("order_id").limit(5000);
    if (cErr && !isMissingTableError(cErr)) handleSupabaseError(cErr, "Failed to load order complaints");
    complaintOrderIds = [...new Set(((cRows ?? []) as Row[]).map((r) => String(r.order_id ?? "")).filter(Boolean))];
    if (q.has_complaint === true && complaintOrderIds.length === 0) {
      return { items: [], total: 0, page: q.page, limit: q.limit };
    }
  }

  let matchedCustomerIds: string[] = [];
  const term = q.q ? sanitizeSearch(q.q) : "";
  if (term) {
    const { data: matchedProfiles } = await applySearch(
      supabaseAdmin.from("profiles").select("id"),
      term,
      ["full_name", "phone"]
    ).limit(50);
    matchedCustomerIds = ((matchedProfiles ?? []) as Row[]).map((p) => String(p.id)).filter(Boolean);
  }

  let query = supabaseAdmin.from("orders").select("*", { count: "exact" });
  if (q.status) query = query.eq("status", q.status);
  if (q.payment_status) query = query.eq("payment_status", q.payment_status);
  if (q.settlement_status) query = query.eq("settlement_status", q.settlement_status);
  if (q.store_id) query = query.eq("store_id", q.store_id);
  if (q.customer_id) query = query.eq("customer_id", q.customer_id);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lte("created_at", toIso);

  if (q.has_complaint === true && complaintOrderIds) {
    query = query.in("id", complaintOrderIds);
  } else if (q.has_complaint === false && complaintOrderIds && complaintOrderIds.length > 0) {
    for (const cid of complaintOrderIds.slice(0, 100)) {
      query = query.neq("id", cid);
    }
  }

  if (term) {
    const orExpr = [
      `order_number.ilike.%${term}%`,
      ...matchedCustomerIds.map((cid) => `customer_id.eq.${cid}`)
    ].join(",");
    query = query.or(orExpr);
  }

  const result = await paginate<Row>(query.order(col, { ascending }), { page: q.page, limit: q.limit });
  const orderIds = result.items.map((r) => String(r.id));

  const [customersMap, storesMap, pageComplaintsRes] = await Promise.all([
    loadByIds("profiles", result.items.map((r) => String(r.customer_id ?? "")), "id,full_name,phone"),
    loadByIds("stores", result.items.map((r) => String(r.store_id ?? "")), "id,name"),
    complaintOrderIds !== null || orderIds.length === 0
      ? Promise.resolve({ data: null, error: null })
      : supabaseAdmin.from("complaints").select("order_id").in("order_id", orderIds)
  ]);

  const complaintSet = complaintOrderIds !== null
    ? new Set(complaintOrderIds)
    : new Set(((pageComplaintsRes.data ?? []) as Row[]).map((r) => String(r.order_id ?? "")));

  const items = result.items.map((row) => {
    const cust = customersMap.get(String(row.customer_id));
    const store = storesMap.get(String(row.store_id));
    const item: Row = {
      id: row.id,
      order_number: row.order_number,
      status: row.status,
      payment_status: row.payment_status,
      payment_method: row.payment_method,
      settlement_status: row.settlement_status ?? "none",
      policy_label: row.policy_label ?? null,
      subtotal_cents: Number(row.subtotal_cents ?? 0),
      discount_cents: Number(row.discount_cents ?? 0),
      donation_cents: Number(row.donation_cents ?? 0),
      platform_fee_cents: Number(row.platform_fee_cents ?? 0),
      total_cents: Number(row.total_cents ?? 0),
      created_at: row.created_at,
      pickup_deadline: row.pickup_deadline ?? null,
      paid_at: row.paid_at ?? null,
      completed_at: row.completed_at ?? null,
      cancelled_at: row.cancelled_at ?? null,
      cancelled_by: row.cancelled_by ?? null,
      cancel_reason: row.cancel_reason ?? null,
      no_show_at: row.no_show_at ?? null,
      customer: cust
        ? { id: cust.id, full_name: cust.full_name ?? null, phone: cust.phone ? maskPhone(cust.phone) : null }
        : { id: row.customer_id, full_name: null, phone: null },
      stores: store
        ? { id: store.id, name: store.name ?? null }
        : { id: row.store_id, name: null },
      has_complaint: complaintSet.has(String(row.id))
    };
    if (row.status === "completed" && row.qr_code) {
      item.qr_code = row.qr_code;
    }
    return item;
  });

  return {
    items,
    total: result.total,
    page: result.page,
    limit: result.limit
  };
};

export interface RefundCapability {
  can_cancel_refund: boolean;
  can_mark_no_show: boolean;
  can_complete: boolean;
  reason?: string;
}

const computeRefundCapability = (order: Row): RefundCapability => {
  const status = String(order.status ?? "");
  const paid = order.payment_status === "paid";
  const activePickup = status === "pending" || status === "confirmed" || status === "ready";
  const canCancelRefund = status === "awaiting_payment" || activePickup;
  const canMarkNoShow = activePickup;

  const deadlineExpired = Boolean(
    order.pickup_deadline &&
    Date.now() > new Date(String(order.pickup_deadline)).getTime() + policyMs(COMPLETE_GRACE_MINUTES)
  );
  const canComplete = activePickup && paid && !deadlineExpired;

  let reason: string | undefined;
  if (status === "completed") {
    reason = "Đơn đã hoàn tất chỉ có thể hoàn tiền qua quy trình xử lý khiếu nại.";
  } else if (status === "cancelled" || status === "no_show") {
    reason = "Đơn hàng đã kết thúc.";
  } else if (activePickup && !paid) {
    reason = "Đơn chưa thanh toán nên chưa thể hoàn tất bàn giao.";
  } else if (activePickup && deadlineExpired) {
    reason = "Đã quá hạn lấy hàng nên không thể xác nhận hoàn tất thay cửa hàng.";
  }

  return reason
    ? { can_cancel_refund: canCancelRefund, can_mark_no_show: canMarkNoShow, can_complete: canComplete, reason }
    : { can_cancel_refund: canCancelRefund, can_mark_no_show: canMarkNoShow, can_complete: canComplete };
};

const safeTableRows = async (
  build: () => PromiseLike<{ data: any; error: any }>,
  fallbackMsg: string
): Promise<Row[]> => {
  try {
    const { data, error } = await build();
    if (error) {
      if (isMissingTableError(error)) return [];
      handleSupabaseError(error, fallbackMsg);
    }
    return (data ?? []) as Row[];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
};

const loadCustomerLiveLocation = async (order: Row): Promise<Row | null> => {
  const active = order.payment_status === "paid" && ["pending", "confirmed", "ready"].includes(String(order.status ?? ""));
  if (!active || !order.customer_id) return null;
  try {
    const cutoff = new Date(Date.now() - VISIBLE_WINDOW_MS).toISOString();
    const { data, error } = await supabaseAdmin
      .from("live_locations")
      .select("*")
      .eq("actor_kind", "customer")
      .eq("actor_id", order.customer_id)
      .eq("context_kind", "order")
      .eq("context_id", order.id)
      .gte("updated_at", cutoff)
      .maybeSingle();
    if (error) {
      if (isMissingTableError(error)) return null;
      handleSupabaseError(error, "Failed to load customer live location");
    }
    return (data as Row | null) ?? null;
  } catch (error) {
    if (isMissingTableError(error)) return null;
    return null;
  }
};

const getOrderDetail = async (id: string, actor?: AuditActor | null): Promise<Row> => {
  const { data, error } = await supabaseAdmin.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load order");
  const rawOrder = data as Row | null;
  if (!rawOrder) {
    throw new AppError("Không tìm thấy đơn hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const [
    customerRes,
    storeRes,
    orderItems,
    orderEvents,
    rawMessages,
    rawComplaints,
    reviews,
    ledgerEntries,
    paymentEvents,
    customerLocation
  ] = await Promise.all([
    rawOrder.customer_id
      ? supabaseAdmin.from("profiles").select("id,full_name,email,phone,points,rank,status").eq("id", rawOrder.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    rawOrder.store_id
      ? supabaseAdmin.from("stores").select("id,name,slug,owner_id,emoji,address,district,city,status").eq("id", rawOrder.store_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    safeTableRows(
      () => supabaseAdmin.from("order_items").select("*").eq("order_id", id).order("created_at", { ascending: true }),
      "Failed to load order items"
    ),
    safeTableRows(
      () => supabaseAdmin.from("order_events").select("*").eq("order_id", id).order("created_at", { ascending: true }),
      "Failed to load order events"
    ),
    safeTableRows(
      () => supabaseAdmin.from("order_messages").select("id,order_id,sender_id,sender_role,body,read_at,created_at").eq("order_id", id).order("created_at", { ascending: true }).limit(300),
      "Failed to load order messages"
    ),
    safeTableRows(
      () => supabaseAdmin.from("complaints").select("*").eq("order_id", id).order("created_at", { ascending: false }),
      "Failed to load order complaints"
    ),
    safeTableRows(
      () => supabaseAdmin.from("reviews").select("*").eq("order_id", id).order("created_at", { ascending: false }),
      "Failed to load order reviews"
    ),
    safeTableRows(
      () => supabaseAdmin.from("ledger_entries").select("*").eq("order_id", id).order("created_at", { ascending: true }),
      "Failed to load order ledger entries"
    ),
    safeTableRows(
      () => supabaseAdmin.from("payment_events").select("*").eq("order_id", id).order("created_at", { ascending: true }),
      "Failed to load payment events"
    ),
    loadCustomerLiveLocation(rawOrder)
  ]);

  const complaints = await Promise.all(
    rawComplaints.map(async (c) => ({
      ...c,
      image_urls: Array.isArray(c.image_urls) ? await signEvidenceUrls(c.image_urls as string[]) : [],
      store_response_images: Array.isArray(c.store_response_images) ? await signEvidenceUrls(c.store_response_images as string[]) : []
    }))
  );

  if (rawMessages.length > 0 && actor) {
    await adminAuditService.log(actor, "order.chat_view", "order", id, {
      order_number: rawOrder.order_number,
      message_count: rawMessages.length
    });
  }

  const custRow = (customerRes.data as Row | null) ?? null;
  const customer = custRow
    ? { ...custRow, phone: custRow.phone ? maskPhone(custRow.phone) : null }
    : null;
  const stores = (storeRes.data as Row | null) ?? null;

  const walletIds = ledgerEntries.flatMap((le) => [String(le.from_wallet_id ?? ""), String(le.to_wallet_id ?? "")]).filter(Boolean);
  const walletsMap = walletIds.length > 0 ? await loadByIds("wallets", walletIds, "id,owner_type,store_id") : new Map<string, Row>();
  const resolveWalletName = (walletId: unknown): string | null => {
    const w = walletsMap.get(String(walletId ?? ""));
    if (!w) return null;
    if (w.owner_type === "store") return stores?.name ? `Ví ${String(stores.name)}` : "Ví cửa hàng";
    return String(w.owner_type ?? "");
  };
  const enrichedLedgerEntries = ledgerEntries.map((le) => ({
    ...le,
    from: le.from ?? resolveWalletName(le.from_wallet_id),
    to: le.to ?? resolveWalletName(le.to_wallet_id)
  }));

  return {
    ...sanitizeOrderRow(rawOrder),
    customer,
    stores,
    order_items: orderItems,
    order_events: orderEvents,
    messages: rawMessages,
    can_send: false,
    complaints,
    reviews,
    ledger_entries: enrichedLedgerEntries,
    payment_events: paymentEvents,
    customer_location: customerLocation,
    refund_capability: computeRefundCapability(rawOrder)
  };
};

export type AdminOrderActionStatus = "cancelled" | "no_show" | "completed";

const ADMIN_ORDER_AUDIT_ACTION: Record<AdminOrderActionStatus, string> = {
  cancelled: "order.cancel",
  no_show: "order.no_show",
  completed: "order.complete"
};

const updateOrderStatus = async (
  id: string,
  body: { status: AdminOrderActionStatus; reason: string },
  actor: AuditActor
): Promise<Row> => {
  const reason = requireReason(body.reason, "lý do can thiệp đơn hàng");

  const { data: beforeData, error: beforeErr } = await supabaseAdmin
    .from("orders")
    .select("id,order_number,status,payment_status,total_cents")
    .eq("id", id)
    .maybeSingle();
  if (beforeErr) handleSupabaseError(beforeErr, "Failed to load order");
  const before = beforeData as Row | null;
  if (!before) {
    throw new AppError("Không tìm thấy đơn hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const wasAlreadySameStatus = before.status === body.status;
  const wasPaid = before.payment_status === "paid";

  const updated: Order = await orderService.updateOrderStatus(actor.userId, "admin", id, {
    status: body.status,
    is_charity_order: false
  });

  if (!wasAlreadySameStatus) {
    const refundCents = body.status === "cancelled" && wasPaid ? Number(updated.total_cents ?? before.total_cents ?? 0) : 0;
    await appendOrderEventSafe(id, "admin_action", actor.userId, { status: body.status, reason });
    await adminAuditService.log(actor, ADMIN_ORDER_AUDIT_ACTION[body.status], "order", id, {
      order_number: updated.order_number,
      status: body.status,
      reason,
      refund_cents: refundCents
    });
  }

  return sanitizeOrderRow(updated as unknown as Row);
};

const addOrderNote = async (id: string, rawNote: string, actor: AuditActor): Promise<{ ok: true; event: Row }> => {
  const note = requireReason(rawNote, "ghi chú đơn hàng");

  const { data: existing, error } = await supabaseAdmin.from("orders").select("id,order_number").eq("id", id).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load order");
  if (!existing) {
    throw new AppError("Không tìm thấy đơn hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const event = await appendOrderEventSafe(id, "admin_note", actor.userId, { note });
  await adminAuditService.log(actor, "order.note", "order", id, { note });

  return { ok: true, event };
};

/* ─────────────────────────── 2. Donations ─────────────────────────── */

export interface ListAdminDonationsQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  status?: "open" | "accepted" | "in_route" | "completed" | "rejected" | "cancelled" | undefined;
  store_id?: string | undefined;
  charity_id?: string | undefined;
  sort?: string | undefined;
}

const listDonations = async (q: ListAdminDonationsQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  const term = q.q ? sanitizeSearch(q.q) : "";

  let matchedStoreIds: string[] = [];
  if (term) {
    const { data: matchedStores } = await applySearch(
      supabaseAdmin.from("stores").select("id"),
      term,
      ["name"]
    ).limit(50);
    matchedStoreIds = ((matchedStores ?? []) as Row[]).map((s) => String(s.id)).filter(Boolean);
  }

  let query = supabaseAdmin.from("donations").select("*", { count: "exact" });
  if (q.status) query = query.eq("status", q.status);
  if (q.store_id) query = query.eq("store_id", q.store_id);
  if (q.charity_id) query = query.eq("charity_id", q.charity_id);
  if (term) {
    const orExpr = [
      `donation_code.ilike.%${term}%`,
      `items.ilike.%${term}%`,
      ...matchedStoreIds.map((sid) => `store_id.eq.${sid}`)
    ].join(",");
    query = query.or(orExpr);
  }

  const result = await paginate<Row>(query.order(col, { ascending }), { page: q.page, limit: q.limit });

  const [storesMap, charitiesMap, volunteersMap] = await Promise.all([
    loadByIds("stores", result.items.map((d) => String(d.store_id ?? "")), "id,name,address,district,emoji"),
    loadByIds("charity_profiles", result.items.map((d) => String(d.charity_id ?? "")), "id,name"),
    loadByIds("volunteers", result.items.map((d) => String(d.assigned_volunteer_id ?? "")), "id,full_name,phone")
  ]);

  const items = result.items.map((row) => {
    const safe = sanitizeDonationRow(row);
    const store = storesMap.get(String(row.store_id)) ?? null;
    const charity = row.charity_id ? (charitiesMap.get(String(row.charity_id)) ?? null) : null;
    const vol = row.assigned_volunteer_id ? (volunteersMap.get(String(row.assigned_volunteer_id)) ?? null) : null;
    return {
      ...safe,
      store_name: store?.name ?? null,
      charity_name: charity?.name ?? null,
      stores: store,
      charity_profiles: charity,
      volunteers: vol
        ? { id: vol.id, full_name: vol.full_name ?? null, phone: vol.phone ? maskPhone(vol.phone) : null }
        : null
    };
  });

  return {
    items,
    total: result.total,
    page: result.page,
    limit: result.limit
  };
};

const loadVolunteerLiveLocation = async (donation: Row, volunteersMap: Map<string, Row>): Promise<Row | null> => {
  if (!["accepted", "in_route", "completed"].includes(String(donation.status ?? ""))) return null;
  try {
    const cutoff = new Date(Date.now() - VISIBLE_WINDOW_MS).toISOString();
    const { data, error } = await supabaseAdmin
      .from("live_locations")
      .select("*")
      .eq("actor_kind", "volunteer")
      .eq("context_kind", "donation")
      .eq("context_id", donation.id)
      .gte("updated_at", cutoff)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) {
      if (isMissingTableError(error)) return null;
      handleSupabaseError(error, "Failed to load volunteer live location");
    }
    const row = ((data ?? []) as Row[])[0] ?? null;
    if (!row) return null;
    const vol = volunteersMap.get(String(row.actor_id));
    return {
      ...row,
      name: vol?.full_name ?? "Tình nguyện viên"
    };
  } catch (error) {
    if (isMissingTableError(error)) return null;
    return null;
  }
};

const buildDonationReport = (
  donation: Row,
  store: Row | null,
  charity: Row | null,
  assignments: Row[],
  photos: Row[]
): Row => {
  const buildTeamStage = (stage: "pickup" | "distribute") =>
    assignments
      .filter((a) => a.stage === stage)
      .map((a) => ({
        volunteer_id: a.volunteer_id,
        name: a.volunteer_name ?? a.volunteers?.full_name ?? "TNV",
        phone: a.volunteer_phone ?? a.volunteers?.phone ?? null,
        vehicle: a.volunteers?.vehicle ?? "",
        share: Number(a.share ?? 1),
        done_at: a.done_at ?? null,
        photo_count: photos.filter((p) => p.volunteer_id === a.volunteer_id && p.stage === stage && p.status !== "retake").length
      }));

  const timeline: Array<{ at: string; label: string }> = [];
  const push = (at: unknown, label: string): void => {
    if (typeof at === "string" && at) timeline.push({ at, label });
  };
  push(donation.created_at, "Cửa hàng đăng lô tặng");
  push(donation.accepted_at, `${charity?.name ?? "Tổ chức"} chọn lô`);
  push(donation.store_confirmed_at, "Cửa hàng chấp nhận quyên góp");
  push(donation.volunteer_assigned_at, "Tổ chức giao đội lấy hàng");
  push(donation.packed_at, "Cửa hàng đóng gói xong");
  push(donation.completed_at, "Cửa hàng bàn giao cho TNV");
  for (const photo of photos) {
    if (photo.stage === "pickup") {
      push(photo.taken_at, `Ảnh nhận hàng của ${String(photo.volunteer_name ?? photo.volunteers?.full_name ?? "TNV")}`);
      break;
    }
  }
  push(donation.distribute_assigned_at, "Tổ chức giao đội phát hàng");
  push(donation.distribution_done_at, "Hoàn tất phát hàng");
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    donation: {
      id: donation.id,
      code: donation.donation_code,
      status: donation.status,
      items: donation.items,
      amount_text: donation.amount_text,
      quantity: donation.quantity ?? null,
      weight_kg: donation.weight_kg,
      portions: donation.portions ?? null,
      completed_at: donation.completed_at ?? null,
      distribution_done_at: donation.distribution_done_at ?? null
    },
    store: { name: store?.name ?? "" },
    charity: { name: charity?.name ?? "" },
    team: {
      pickup: buildTeamStage("pickup"),
      distribute: buildTeamStage("distribute")
    },
    photos,
    timeline
  };
};

const getDonationDetail = async (id: string): Promise<Row> => {
  const { data, error } = await supabaseAdmin.from("donations").select("*").eq("id", id).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load donation");
  const rawDonation = data as Row | null;
  if (!rawDonation) {
    throw new AppError("Không tìm thấy lô quyên góp", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const safeDonation = sanitizeDonationRow(rawDonation);

  const [storeRes, charityRes, rawAssignments, rawPhotos] = await Promise.all([
    rawDonation.store_id
      ? supabaseAdmin.from("stores").select("id,name,owner_id,emoji,address,district,city,latitude,longitude").eq("id", rawDonation.store_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    rawDonation.charity_id
      ? supabaseAdmin.from("charity_profiles").select("id,name,owner_id,phone,address,district,city,latitude,longitude").eq("id", rawDonation.charity_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    safeTableRows(
      () => supabaseAdmin.from("donation_assignments").select("*").eq("donation_id", id).order("assigned_at", { ascending: true }),
      "Failed to load donation assignments"
    ),
    safeTableRows(
      () => supabaseAdmin.from("donation_photos").select("*").eq("donation_id", id).order("taken_at", { ascending: true }),
      "Failed to load donation photos"
    )
  ]);

  const volunteerIds = [
    rawDonation.assigned_volunteer_id ? String(rawDonation.assigned_volunteer_id) : "",
    rawDonation.distribute_volunteer_id ? String(rawDonation.distribute_volunteer_id) : "",
    ...rawAssignments.map((a) => String(a.volunteer_id ?? "")),
    ...rawPhotos.map((p) => String(p.volunteer_id ?? ""))
  ].filter(Boolean);

  const volunteersMap = await loadByIds("volunteers", volunteerIds, "id,full_name,phone,vehicle,status");

  const assignments = rawAssignments.map((a) => {
    const vol = volunteersMap.get(String(a.volunteer_id));
    const masked = vol?.phone ? maskPhone(vol.phone) : null;
    return {
      ...a,
      volunteer_name: vol?.full_name ?? null,
      volunteer_phone: masked,
      volunteers: vol
        ? { id: vol.id, full_name: vol.full_name ?? null, phone: masked, vehicle: vol.vehicle ?? null }
        : null
    };
  });

  const photos = rawPhotos.map((p) => {
    const vol = volunteersMap.get(String(p.volunteer_id));
    return {
      ...p,
      volunteer_name: vol?.full_name ?? null,
      volunteers: vol ? { full_name: vol.full_name ?? null } : null
    };
  });

  const store = (storeRes.data as Row | null) ?? null;
  const charityRow = (charityRes.data as Row | null) ?? null;
  const charity = charityRow
    ? { ...charityRow, phone: charityRow.phone ? maskPhone(charityRow.phone) : null }
    : null;

  const volunteerLocation = await loadVolunteerLiveLocation(rawDonation, volunteersMap);
  const report = buildDonationReport(safeDonation, store, charity, assignments, photos);

  return {
    ...safeDonation,
    stores: store,
    charity_profiles: charity,
    donation_assignments: assignments,
    photos,
    report,
    volunteer_location: volunteerLocation
  };
};

const cancelDonation = async (id: string, rawReason: string, actor: AuditActor): Promise<Row> => {
  const reason = requireReason(rawReason, "lý do hủy lô tặng");

  const { data: found, error: findErr } = await supabaseAdmin
    .from("donations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (findErr) handleSupabaseError(findErr, "Failed to load donation");
  const existing = found as Row | null;
  if (!existing) {
    throw new AppError("Không tìm thấy lô quyên góp", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  if (existing.status === "completed" || existing.status === "cancelled" || existing.status === "rejected") {
    throw new AppError(
      `Lô quyên góp đã ở trạng thái "${existing.status}", không thể hủy`,
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.RESOURCE_CONFLICT
    );
  }

  const now = new Date().toISOString();
  const nextNote = existing.note ? `${existing.note} | [Admin hủy] ${reason}` : `[Admin hủy] ${reason}`;

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("donations")
    .update({ status: "cancelled", note: nextNote, updated_at: now })
    .eq("id", id)
    .eq("status", existing.status)
    .select("*")
    .maybeSingle();
  if (updateErr) handleSupabaseError(updateErr, "Failed to cancel donation");
  if (!updated) {
    throw new AppError("Lô quyên góp vừa được cập nhật ở nơi khác, hãy tải lại", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }

  // Nếu lô còn mở và đang giữ tồn kho sản phẩm, hoàn trả tồn kho về sản phẩm đang bán.
  if (existing.status === "open" && existing.product_id && Number(existing.quantity) > 0) {
    const { data: prod } = await supabaseAdmin
      .from("products")
      .select("id,stock_quantity")
      .eq("id", existing.product_id)
      .maybeSingle();
    const loadedProd = prod as { id: string; stock_quantity: number } | null;
    if (loadedProd) {
      await supabaseAdmin
        .from("products")
        .update({ stock_quantity: Number(loadedProd.stock_quantity) + Number(existing.quantity) })
        .eq("id", loadedProd.id);
    }
  }

  try {
    await supabaseAdmin.from("live_locations").delete().eq("context_kind", "donation").eq("context_id", id);
  } catch {
    // Bỏ qua nếu bảng live_locations (SQL 039) chưa áp dụng.
  }

  await adminAuditService.log(actor, "donation.cancel", "donation", id, {
    donation_code: existing.donation_code,
    previous_status: existing.status,
    reason
  });

  return sanitizeDonationRow(updated as Row);
};

/* ─────────────────────────── 3. Products ─────────────────────────── */

export interface ListAdminProductsQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  label?: "green" | "yellow" | "red" | undefined;
  store_id?: string | undefined;
  visibility?: "all" | "visible" | "hidden" | undefined;
  sort?: string | undefined;
}

const PRODUCT_FULL_COLS =
  "id,name,store_id,category,food_group,label,stock_quantity,sold_count,original_price_cents,price_cents,expires_at,effective_deadline_at,label_changed_at,is_active,blocked_reason,admin_hidden_at,admin_hidden_reason,admin_hidden_by,image_url,emoji,created_at,updated_at";
const PRODUCT_BASE_COLS =
  "id,name,store_id,category,food_group,label,stock_quantity,sold_count,original_price_cents,price_cents,expires_at,effective_deadline_at,label_changed_at,is_active,blocked_reason,image_url,emoji,created_at,updated_at";

const normalizeAdminProductRow = (row: Row, storeName: string | null): Row => {
  const blocked = row.blocked_reason ?? null;
  const fallbackReason =
    typeof blocked === "string" && blocked.startsWith("[Admin]")
      ? blocked.replace(/^\[Admin\]\s*/, "")
      : null;
  const hiddenAt = row.admin_hidden_at ?? null;
  const hiddenReason = row.admin_hidden_reason ?? fallbackReason;
  return {
    ...row,
    store_name: storeName,
    effective_deadline_at: row.effective_deadline_at ?? null,
    label_changed_at: row.label_changed_at ?? null,
    blocked_reason: blocked,
    admin_hidden: Boolean(hiddenAt || fallbackReason !== null),
    admin_hidden_at: hiddenAt,
    admin_hidden_reason: hiddenReason
  };
};

const listProducts = async (q: ListAdminProductsQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  const visibility = q.visibility ?? "all";
  const term = q.q ? sanitizeSearch(q.q) : "";

  let matchedStoreIds: string[] = [];
  if (term) {
    const { data: matchedStores } = await applySearch(
      supabaseAdmin.from("stores").select("id"),
      term,
      ["name"]
    ).limit(50);
    matchedStoreIds = ((matchedStores ?? []) as Row[]).map((s) => String(s.id)).filter(Boolean);
  }

  const buildQuery = (columns: string, hasAdminCols: boolean) => {
    let query = supabaseAdmin.from("products").select(columns, { count: "exact" });
    if (q.label) query = query.eq("label", q.label);
    if (q.store_id) query = query.eq("store_id", q.store_id);
    if (visibility === "visible") {
      query = query.eq("is_active", true);
      if (hasAdminCols) query = query.is("admin_hidden_at", null);
    } else if (visibility === "hidden") {
      query = hasAdminCols ? query.not("admin_hidden_at", "is", null) : query.ilike("blocked_reason", "[Admin]%");
    }
    if (term) {
      const orExpr = [
        `name.ilike.%${term}%`,
        ...matchedStoreIds.map((sid) => `store_id.eq.${sid}`)
      ].join(",");
      query = query.or(orExpr);
    }
    return query.order(col, { ascending });
  };

  let result: ListResult<Row>;
  try {
    result = await paginate<Row>(buildQuery(PRODUCT_FULL_COLS, true), { page: q.page, limit: q.limit });
  } catch (error) {
    if (isMissingColumnError(error)) {
      result = await paginate<Row>(buildQuery(PRODUCT_BASE_COLS, false), { page: q.page, limit: q.limit });
    } else {
      throw error;
    }
  }

  const storesMap = await loadByIds("stores", result.items.map((p) => String(p.store_id ?? "")), "id,name");
  const items = result.items.map((row) => normalizeAdminProductRow(row, storesMap.get(String(row.store_id))?.name ?? null));

  return {
    items,
    total: result.total,
    page: result.page,
    limit: result.limit
  };
};

const getProductDetail = async (id: string): Promise<Row> => {
  const { data, error } = await supabaseAdmin.from("products").select("*").eq("id", id).maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load product");
  const product = data as Row | null;
  if (!product) {
    throw new AppError("Không tìm thấy sản phẩm", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const { data: storeData } = product.store_id
    ? await supabaseAdmin
        .from("stores")
        .select("id,name,slug,owner_id,address,district,city,status,rating,is_verified,is_open")
        .eq("id", product.store_id)
        .maybeSingle()
    : { data: null };
  const store = (storeData as Row | null) ?? null;

  return {
    ...normalizeAdminProductRow(product, store?.name ?? null),
    store,
    stores: store
  };
};

const updateProductVisibility = async (
  id: string,
  body: { action: "hide" | "unhide"; reason?: string | undefined },
  actor: AuditActor
): Promise<Row> => {
  const normalizedReason = body.action === "hide"
    ? requireReason(body.reason, "lý do ẩn sản phẩm")
    : (body.reason?.trim() || null);

  const { data: found, error: findErr } = await supabaseAdmin.from("products").select("*").eq("id", id).maybeSingle();
  if (findErr) handleSupabaseError(findErr, "Failed to load product");
  const existing = found as Row | null;
  if (!existing) {
    throw new AppError("Không tìm thấy sản phẩm", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const now = new Date().toISOString();
  const blockedReason = body.action === "hide" ? `[Admin] ${normalizedReason}` : null;

  const fullPatch: Row = body.action === "hide"
    ? {
        is_active: false,
        blocked_reason: blockedReason,
        admin_hidden_at: now,
        admin_hidden_reason: normalizedReason,
        admin_hidden_by: actor.userId,
        updated_at: now
      }
    : {
        is_active: true,
        blocked_reason: null,
        admin_hidden_at: null,
        admin_hidden_reason: null,
        admin_hidden_by: null,
        updated_at: now
      };

  const fallbackPatch: Row = {
    is_active: body.action === "unhide",
    blocked_reason: blockedReason,
    updated_at: now
  };

  let { data: updated, error: updateErr } = await supabaseAdmin
    .from("products")
    .update(fullPatch)
    .eq("id", id)
    .select("*")
    .single();

  if (updateErr && isMissingColumnError(updateErr)) {
    ({ data: updated, error: updateErr } = await supabaseAdmin
      .from("products")
      .update(fallbackPatch)
      .eq("id", id)
      .select("*")
      .single());
  }
  if (updateErr) handleSupabaseError(updateErr, "Failed to update product visibility");

  await adminAuditService.log(
    actor,
    body.action === "hide" ? "product.hide" : "product.unhide",
    "product",
    id,
    {
      name: existing.name,
      store_id: existing.store_id,
      ...(normalizedReason ? { reason: normalizedReason } : {})
    }
  );

  return normalizeAdminProductRow((updated ?? fallbackPatch) as Row, null);
};

/* ─────────────────────────── 4. Payments ─────────────────────────── */

export interface ListAdminPaymentsQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  provider?: string | undefined;
  status?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort?: string | undefined;
}

const listPayments = async (q: ListAdminPaymentsQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  const fromIso = normalizeDateBound(q.from, "from");
  const toIso = normalizeDateBound(q.to, "to");
  const term = q.q ? sanitizeSearch(q.q) : "";

  let matchedOrderIds: string[] = [];
  if (term) {
    const { data: matchedOrders } = await applySearch(
      supabaseAdmin.from("orders").select("id"),
      term,
      ["order_number"]
    ).limit(50);
    matchedOrderIds = ((matchedOrders ?? []) as Row[]).map((o) => String(o.id)).filter(Boolean);
  }

  let result: ListResult<Row>;
  try {
    let query = supabaseAdmin.from("payment_events").select("*", { count: "exact" });
    if (q.provider) query = query.eq("provider", q.provider);
    if (q.status) query = query.eq("status", q.status);
    if (fromIso) query = query.gte("created_at", fromIso);
    if (toIso) query = query.lte("created_at", toIso);
    if (term) {
      const orExpr = [
        `provider_txn_id.ilike.%${term}%`,
        ...matchedOrderIds.map((oid) => `order_id.eq.${oid}`)
      ].join(",");
      query = query.or(orExpr);
    }
    result = await paginate<Row>(query.order(col, { ascending }), { page: q.page, limit: q.limit });
  } catch (error) {
    if (isMissingTableError(error)) {
      return { items: [], total: 0, page: q.page, limit: q.limit };
    }
    throw error;
  }

  const ordersMap = await loadByIds(
    "orders",
    result.items.map((r) => String(r.order_id ?? "")),
    "id,order_number,total_cents,payment_status,status"
  );

  const items = result.items.map((row) => {
    const ord = row.order_id ? ordersMap.get(String(row.order_id)) : undefined;
    return {
      ...row,
      amount_cents: Number(row.amount_cents ?? 0),
      order_number: ord?.order_number ?? null
    };
  });

  return {
    items,
    total: result.total,
    page: result.page,
    limit: result.limit
  };
};

export interface PaymentsSummary {
  total_events: number;
  total_amount_cents: number;
  processed_amount_cents: number;
  by_provider: Record<string, { count: number; amount_cents: number }>;
  by_status: Record<string, { count: number; amount_cents: number }>;
}

const getPaymentsSummary = async (filter: { from?: string | undefined; to?: string | undefined } = {}): Promise<PaymentsSummary> => {
  const empty: PaymentsSummary = {
    total_events: 0,
    total_amount_cents: 0,
    processed_amount_cents: 0,
    by_provider: {},
    by_status: {}
  };

  try {
    const fromIso = normalizeDateBound(filter.from, "from");
    const toIso = normalizeDateBound(filter.to, "to");
    let query = supabaseAdmin.from("payment_events").select("provider,status,amount_cents");
    if (fromIso) query = query.gte("created_at", fromIso);
    if (toIso) query = query.lte("created_at", toIso);
    const { data, error } = await query.limit(10000);
    if (error) {
      if (isMissingTableError(error)) return empty;
      handleSupabaseError(error, "Failed to load payment summary");
    }

    const byProvider: Record<string, { count: number; amount_cents: number }> = {};
    const byStatus: Record<string, { count: number; amount_cents: number }> = {};
    let totalEvents = 0;
    let totalAmountCents = 0;

    for (const row of (data ?? []) as Row[]) {
      const amount = Number.isFinite(Number(row.amount_cents)) ? Number(row.amount_cents) : 0;
      const providerKey = String(row.provider || "unknown");
      const statusKey = String(row.status || "unknown");

      totalEvents += 1;
      totalAmountCents += amount;

      const pBucket = byProvider[providerKey] ?? { count: 0, amount_cents: 0 };
      pBucket.count += 1;
      pBucket.amount_cents += amount;
      byProvider[providerKey] = pBucket;

      const sBucket = byStatus[statusKey] ?? { count: 0, amount_cents: 0 };
      sBucket.count += 1;
      sBucket.amount_cents += amount;
      byStatus[statusKey] = sBucket;
    }

    return {
      total_events: totalEvents,
      total_amount_cents: totalAmountCents,
      processed_amount_cents: byStatus.processed?.amount_cents ?? 0,
      by_provider: byProvider,
      by_status: byStatus
    };
  } catch (error) {
    if (isMissingTableError(error)) return empty;
    throw error;
  }
};

/* ─────────────────────────── 5. Reviews ─────────────────────────── */

export interface ListAdminReviewsQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  store_id?: string | undefined;
  rating?: number | undefined;
  visibility?: "all" | "visible" | "hidden" | undefined;
  sort?: string | undefined;
}

const REVIEW_FULL_COLS = "id,order_id,customer_id,store_id,product_id,rating,comment,photo_urls,hidden_at,hidden_reason,hidden_by,created_at,updated_at";
const REVIEW_BASE_COLS = "id,order_id,customer_id,store_id,product_id,rating,comment,photo_urls,created_at,updated_at";

const listReviews = async (q: ListAdminReviewsQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  const visibility = q.visibility ?? "all";
  const term = q.q ? sanitizeSearch(q.q) : "";

  let matchedOrderIds: string[] = [];
  let matchedStoreIds: string[] = [];
  let matchedCustomerIds: string[] = [];
  if (term) {
    const [ordersRes, storesRes, customersRes] = await Promise.all([
      applySearch(supabaseAdmin.from("orders").select("id"), term, ["order_number"]).limit(50),
      applySearch(supabaseAdmin.from("stores").select("id"), term, ["name"]).limit(50),
      applySearch(supabaseAdmin.from("profiles").select("id"), term, ["full_name"]).limit(50)
    ]);
    matchedOrderIds = ((ordersRes.data ?? []) as Row[]).map((o) => String(o.id)).filter(Boolean);
    matchedStoreIds = ((storesRes.data ?? []) as Row[]).map((s) => String(s.id)).filter(Boolean);
    matchedCustomerIds = ((customersRes.data ?? []) as Row[]).map((c) => String(c.id)).filter(Boolean);
  }

  const buildQuery = (columns: string, includeVisibility: boolean) => {
    let query = supabaseAdmin.from("reviews").select(columns, { count: "exact" });
    if (q.store_id) query = query.eq("store_id", q.store_id);
    if (q.rating !== undefined) query = query.eq("rating", q.rating);
    if (includeVisibility) {
      if (visibility === "visible") query = query.is("hidden_at", null);
      else if (visibility === "hidden") query = query.not("hidden_at", "is", null);
    }
    if (term) {
      const orExpr = [
        `comment.ilike.%${term}%`,
        ...matchedOrderIds.map((oid) => `order_id.eq.${oid}`),
        ...matchedStoreIds.map((sid) => `store_id.eq.${sid}`),
        ...matchedCustomerIds.map((cid) => `customer_id.eq.${cid}`)
      ].join(",");
      query = query.or(orExpr);
    }
    return query.order(col, { ascending });
  };

  let result: ListResult<Row>;
  try {
    result = await paginate<Row>(buildQuery(REVIEW_FULL_COLS, true), { page: q.page, limit: q.limit });
  } catch (error) {
    if (isMissingColumnError(error)) {
      if (visibility === "hidden") {
        return { items: [], total: 0, page: q.page, limit: q.limit };
      }
      result = await paginate<Row>(buildQuery(REVIEW_BASE_COLS, false), { page: q.page, limit: q.limit });
    } else {
      throw error;
    }
  }

  const [storesMap, customersMap, ordersMap] = await Promise.all([
    loadByIds("stores", result.items.map((r) => String(r.store_id ?? "")), "id,name"),
    loadByIds("profiles", result.items.map((r) => String(r.customer_id ?? "")), "id,full_name"),
    loadByIds("orders", result.items.map((r) => String(r.order_id ?? "")), "id,order_number")
  ]);

  const items = result.items.map((row) => ({
    ...row,
    store_name: storesMap.get(String(row.store_id))?.name ?? null,
    customer_name: customersMap.get(String(row.customer_id))?.full_name ?? null,
    order_number: ordersMap.get(String(row.order_id))?.order_number ?? null,
    hidden_at: row.hidden_at ?? null,
    hidden_reason: row.hidden_reason ?? null
  }));

  return {
    items,
    total: result.total,
    page: result.page,
    limit: result.limit
  };
};

const updateReviewVisibility = async (
  id: string,
  body: { action: "hide" | "unhide"; reason?: string | undefined },
  actor: AuditActor
): Promise<Row> => {
  const normalizedReason = body.action === "hide"
    ? requireReason(body.reason, "lý do ẩn đánh giá")
    : (body.reason?.trim() || null);

  const { data: found, error: findErr } = await supabaseAdmin.from("reviews").select("*").eq("id", id).maybeSingle();
  if (findErr) handleSupabaseError(findErr, "Failed to load review");
  const review = found as Row | null;
  if (!review) {
    throw new AppError("Không tìm thấy đánh giá", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const now = new Date().toISOString();
  const patch: Row = body.action === "hide"
    ? { hidden_at: now, hidden_reason: normalizedReason, hidden_by: actor.userId, updated_at: now }
    : { hidden_at: null, hidden_reason: null, hidden_by: null, updated_at: now };

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("reviews")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (updateErr) {
    if (isMissingColumnError(updateErr)) {
      throw new AppError(
        "Chưa thể ẩn/hiện đánh giá vì cơ sở dữ liệu chưa áp dụng nâng cấp SQL 043_admin_portal.sql.",
        HTTP_STATUS.CONFLICT,
        ERROR_CODES.RESOURCE_CONFLICT
      );
    }
    handleSupabaseError(updateErr, "Failed to update review visibility");
  }

  if (review.store_id) {
    try {
      const { data: visibleRows, error: avgErr } = await supabaseAdmin
        .from("reviews")
        .select("rating")
        .eq("store_id", review.store_id)
        .is("hidden_at", null);
      if (!avgErr) {
        const ratings = (visibleRows ?? []) as Array<{ rating: number }>;
        const avg = ratings.length > 0
          ? Math.round((ratings.reduce((sum, r) => sum + Number(r.rating ?? 0), 0) / ratings.length) * 100) / 100
          : 5;
        await sellerReputationService.updateSellerRatingAverage(String(review.store_id), avg);
        await supabaseAdmin.from("stores").update({ rating: avg }).eq("id", review.store_id);
      }
    } catch (err) {
      logger.warn("Không tính lại được sao trung bình của cửa hàng sau khi ẩn/hiện đánh giá", {
        reviewId: id,
        storeId: review.store_id,
        error: err
      });
    }
  }

  await adminAuditService.log(
    actor,
    body.action === "hide" ? "review.hide" : "review.unhide",
    "review",
    id,
    {
      store_id: review.store_id,
      order_id: review.order_id,
      rating: review.rating,
      ...(normalizedReason ? { reason: normalizedReason } : {})
    }
  );

  return (updated ?? { ...review, ...patch }) as Row;
};

export const adminPortal3Service = {
  listOrders,
  getOrderDetail,
  updateOrderStatus,
  addOrderNote,
  listDonations,
  getDonationDetail,
  cancelDonation,
  listProducts,
  getProductDetail,
  updateProductVisibility,
  listPayments,
  getPaymentsSummary,
  listReviews,
  updateReviewVisibility
};
