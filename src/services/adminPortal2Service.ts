/**
 * Wave 4A — Admin Portal Đợt 2:
 *   - Hồ sơ 360° & đổi trạng thái cho Tài khoản (accounts), Cửa hàng (stores), Tổ chức (charities) và Tình nguyện viên (volunteers)
 *   - Tìm kiếm toàn cục (GET /admin/search)
 *
 * Bảo mật & tương thích ngược:
 *   - Không bao giờ trả `pickup_code`, `qr_code`, các trường `bank_*` hoặc CCCD/mã số thuế nguyên văn.
 *   - Xử lý mềm dẻo khi SQL 039 (location_consents -> 42P01/PGRST205) hoặc SQL 043 (suspended_* -> 42703/PGRST204) chưa chạy.
 *   - Mọi thao tác đổi trạng thái đều ghi nhật ký qua `adminAuditService.log`.
 */
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { sanitizeSearch } from "../schemas/adminSchemas";
import { AppError } from "../utils/appError";
import { adminAuditService, type AuditActor } from "./adminAuditService";
import { applySearch, loadByIds, maskPhone, paginate, type ListResult } from "./adminListing";
import { customerReputationService } from "./customerReputationService";
import { ledgerService } from "./ledgerService";
import { payoutAccountService } from "./payoutAccountService";
import { sellerReputationService } from "./sellerReputationService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

type Row = Record<string, any>;

const isMissingTableError = (error: { code?: string | null } | null | undefined): boolean =>
  error?.code === "42P01" || error?.code === "PGRST205";

const isMissingColumnError = (error: { code?: string | null } | null | undefined): boolean =>
  error?.code === "42703" || error?.code === "PGRST204";

const maskSensitiveId = (value: unknown): string | null => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length <= 4) return "••••";
  return `${"•".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
};

const BANK_KEY_RE = /(?:^bank_|account_number|iban|bank_account)/i;
const SENSITIVE_ID_KEY_RE = /(?:cccd|cmnd|id_card|citizen_id|tax_code|tax_id|business_license)/i;

const sanitizeMetaValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sanitizeMetaValue);
  if (value && typeof value === "object") return sanitizeMetadata(value);
  return value;
};

const sanitizeMetadata = (meta: unknown): Record<string, unknown> => {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (BANK_KEY_RE.test(k)) continue;
    if (SENSITIVE_ID_KEY_RE.test(k)) {
      if (typeof v === "string" && /^https?:\/\//i.test(v)) {
        out[k] = "[đã che]";
      } else {
        out[k] = maskSensitiveId(v);
      }
      continue;
    }
    out[k] = sanitizeMetaValue(v);
  }
  return out;
};

const sanitizePartnerProfile = (row: Row | null): Row | null => {
  if (!row) return null;
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (BANK_KEY_RE.test(k)) continue;
    if (SENSITIVE_ID_KEY_RE.test(k)) {
      out[k] = typeof v === "string" && /^https?:\/\//i.test(v) ? "[đã che]" : maskSensitiveId(v);
    } else if (k === "metadata" || k === "documents") {
      out[k] = sanitizeMetaValue(v);
    } else {
      out[k] = v;
    }
  }
  return out;
};

const sanitizeCharity = (row: Row): Row => {
  const { metadata, ...rest } = row;
  return {
    ...rest,
    ...(metadata !== undefined ? { metadata: sanitizeMetadata(metadata) } : {})
  };
};

const sanitizeDonation = (row: Row): Row => {
  const { pickup_code: _omit, ...safe } = row;
  return safe;
};

const sanitizeOrder = (row: Row): Row => {
  const { qr_code: _omit, ...safe } = row;
  return safe;
};

const parseSort = (sort: string | undefined, defaultCol: string, defaultAsc = false): { col: string; ascending: boolean } => {
  if (!sort) return { col: defaultCol, ascending: defaultAsc };
  const [col, dir] = sort.split(".");
  return { col: col || defaultCol, ascending: dir === "asc" };
};

const requireReason = (reason: string | undefined, actionText: string): string => {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) {
    throw new AppError(`Cần nhập lý do ${actionText} (ít nhất 3 ký tự)`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  return trimmed;
};

const safeCount = async (table: string, apply: (q: any) => any): Promise<number> => {
  try {
    const { count, error } = await apply(supabaseAdmin.from(table).select("id", { count: "exact", head: true }));
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
};

const loadLocationConsents = async (actorId: string, actorKind?: "volunteer" | "customer"): Promise<Row[]> => {
  try {
    let query = supabaseAdmin
      .from("location_consents")
      .select("actor_kind,actor_id,granted,policy_version,decided_at")
      .eq("actor_id", actorId);
    if (actorKind) query = query.eq("actor_kind", actorKind);
    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error)) return [];
      handleSupabaseError(error, "Failed to load location consents");
    }
    return (data ?? []) as Row[];
  } catch (error: any) {
    if (isMissingTableError(error) || isMissingTableError(error?.details)) return [];
    return [];
  }
};

/* ─────────────────────────── Accounts (360°) ─────────────────────────── */

export interface ListAccountsQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  role?: "customer" | "partner" | "charity" | "admin" | undefined;
  status?: "active" | "pending" | "suspended" | "rejected" | undefined;
  red_banned?: boolean | undefined;
  sort?: string | undefined;
}

const PROFILE_FULL_COLS = "id,role,full_name,email,phone,avatar_url,points,rank,status,red_ban_until,auth_provider,last_login_at,suspended_at,suspended_reason,created_at,updated_at";
const PROFILE_BASE_COLS = "id,role,full_name,email,phone,avatar_url,points,rank,status,created_at,updated_at";

const listAccounts = async (q: ListAccountsQuery): Promise<ListResult<Row> & { counts: Record<string, number> }> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  const nowIso = new Date().toISOString();

  const buildQuery = (columns: string) => {
    let query = supabaseAdmin.from("profiles").select(columns, { count: "exact" });
    if (q.role) query = query.eq("role", q.role);
    if (q.status) query = query.eq("status", q.status);
    if (q.red_banned === true) query = query.gt("red_ban_until", nowIso);
    query = applySearch(query, q.q, ["full_name", "email", "phone"]);
    return query.order(col, { ascending });
  };

  let result: ListResult<Row>;
  try {
    result = await paginate<Row>(buildQuery(PROFILE_FULL_COLS), { page: q.page, limit: q.limit });
  } catch (error: any) {
    if (isMissingColumnError(error?.details) || isMissingColumnError(error)) {
      result = await paginate<Row>(buildQuery(PROFILE_BASE_COLS), { page: q.page, limit: q.limit });
    } else {
      throw error;
    }
  }

  const ids = result.items.map((r) => String(r.id));
  const stats = new Map<string, { total: number; completed: number; cancelled: number; no_show: number }>();
  if (ids.length > 0) {
    const { data: orders } = await supabaseAdmin
      .from("orders")
      .select("customer_id,status")
      .in("customer_id", ids)
      .limit(5000);
    for (const o of (orders ?? []) as Row[]) {
      const key = String(o.customer_id);
      const st = stats.get(key) ?? { total: 0, completed: 0, cancelled: 0, no_show: 0 };
      st.total += 1;
      if (o.status === "completed") st.completed += 1;
      if (o.status === "cancelled") st.cancelled += 1;
      if (o.status === "no_show") st.no_show += 1;
      stats.set(key, st);
    }
  }

  const roleScope = (query: any) => (q.role ? query.eq("role", q.role) : query);
  const [totalAll, activeCount, suspendedCount, lockedCount] = await Promise.all([
    safeCount("profiles", (query) => roleScope(query)),
    safeCount("profiles", (query) => roleScope(query).eq("status", "active")),
    safeCount("profiles", (query) => roleScope(query).eq("status", "suspended")),
    safeCount("profiles", (query) => roleScope(query).gt("red_ban_until", nowIso))
  ]);

  const items = result.items.map((row) => {
    const st = stats.get(String(row.id));
    return {
      ...row,
      orders_total: st?.total ?? 0,
      orders_completed: st?.completed ?? 0,
      orders_cancelled: st?.cancelled ?? 0,
      orders_no_show: st?.no_show ?? 0
    };
  });

  return {
    ...result,
    items,
    counts: {
      total: totalAll,
      active: activeCount,
      suspended: suspendedCount,
      locked: lockedCount
    }
  };
};

const getAccountDetail = async (id: string): Promise<Row> => {
  let { data, error } = await supabaseAdmin.from("profiles").select(PROFILE_FULL_COLS).eq("id", id).maybeSingle();
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabaseAdmin.from("profiles").select(PROFILE_BASE_COLS).eq("id", id).maybeSingle());
  }
  if (error) handleSupabaseError(error, "Failed to load account");
  const profile = data as Row | null;
  if (!profile) {
    throw new AppError("Không tìm thấy tài khoản", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const [trust, ordersRes, partnerRes, storeRes, charityRes, locationConsents, recentAudit] = await Promise.all([
    customerReputationService.getStatus(id).catch(() => ({
      points: Number(profile.points ?? 100),
      rank: String(profile.rank ?? "Tin cậy"),
      red_ban_until: profile.red_ban_until ?? null,
      red_banned: Boolean(profile.red_ban_until && new Date(profile.red_ban_until).getTime() > Date.now()),
      blocked: Number(profile.points ?? 100) < 40,
      no_show_count: 0,
      no_show_limit: 3,
      window_days: 60
    })),
    supabaseAdmin
      .from("orders")
      .select("id,order_number,store_id,status,payment_status,total_cents,created_at,completed_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
    profile.role === "partner"
      ? supabaseAdmin.from("partner_profiles").select("*").eq("profile_id", id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    profile.role === "partner"
      ? supabaseAdmin.from("stores").select("id,owner_id,name,slug,address,district,city,rating,is_verified,is_open,status,created_at").eq("owner_id", id).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: null, error: null }),
    profile.role === "charity"
      ? supabaseAdmin.from("charity_profiles").select("*").eq("owner_id", id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    loadLocationConsents(id),
    adminAuditService.list(20, { target_id: id }).catch(() => [])
  ]);

  const allOrders = ((ordersRes.data ?? []) as Row[]).map(sanitizeOrder);
  const orderStats = {
    total: allOrders.length,
    completed: allOrders.filter((o) => o.status === "completed").length,
    cancelled: allOrders.filter((o) => o.status === "cancelled").length,
    no_show: allOrders.filter((o) => o.status === "no_show").length,
    spent_cents: allOrders.filter((o) => o.status === "completed").reduce((sum, o) => sum + Number(o.total_cents || 0), 0)
  };
  const recentOrders = allOrders.slice(0, 10);
  const storeRows = Array.isArray(storeRes.data) ? (storeRes.data as Row[]) : [];

  const out: Row = {
    profile,
    trust,
    order_stats: orderStats,
    recent_orders: recentOrders,
    location_consents: locationConsents,
    recent_audit: recentAudit.slice(0, 20)
  };
  if (partnerRes.data) out.partner_profile = sanitizePartnerProfile(partnerRes.data as Row);
  if (storeRows[0]) out.store = storeRows[0];
  if (charityRes.data) out.charity_profile = sanitizeCharity(charityRes.data as Row);
  return out;
};

const updateAccountStatus = async (
  id: string,
  status: "active" | "suspended",
  reason: string | undefined,
  actor: AuditActor
): Promise<Row> => {
  const normalizedReason = status === "suspended" ? requireReason(reason, "tạm khóa tài khoản") : (reason?.trim() || null);

  if (actor.userId.toLowerCase() === id.toLowerCase() && status === "suspended") {
    throw new AppError("Không thể tự tạm khóa tài khoản của chính mình", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const { data: found, error: findError } = await supabaseAdmin
    .from("profiles")
    .select("id,role,status,full_name")
    .eq("id", id)
    .maybeSingle();
  if (findError) handleSupabaseError(findError, "Failed to load account");
  const target = found as Row | null;
  if (!target) {
    throw new AppError("Không tìm thấy tài khoản", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  if (target.role === "admin" && status === "suspended") {
    const { count, error: countError } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("status", "active")
      .neq("id", id);
    if (countError) handleSupabaseError(countError, "Failed to verify remaining active admins");
    if ((count ?? 0) < 1) {
      throw new AppError("Phải giữ lại ít nhất 1 quản trị viên đang hoạt động", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
  }

  const now = new Date().toISOString();
  const fullPatch: Row = {
    status,
    suspended_at: status === "suspended" ? now : null,
    suspended_reason: status === "suspended" ? normalizedReason : null,
    updated_at: now
  };

  let { data: updated, error: updateError } = await supabaseAdmin
    .from("profiles")
    .update(fullPatch)
    .eq("id", id)
    .select("id,status,suspended_at,suspended_reason,updated_at")
    .single();

  if (updateError && isMissingColumnError(updateError)) {
    ({ data: updated, error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ status, updated_at: now })
      .eq("id", id)
      .select("id,status,updated_at")
      .single());
  }
  if (updateError) handleSupabaseError(updateError, "Failed to update account status");

  await adminAuditService.log(
    actor,
    status === "suspended" ? "account.suspend" : "account.unsuspend",
    "account",
    id,
    { role: target.role, status, reason: normalizedReason }
  );

  return (updated as Row) ?? { id, status, updated_at: now };
};

/* ─────────────────────────── Stores (360°) ─────────────────────────── */

export interface ListStoresQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  status?: "active" | "pending" | "suspended" | "rejected" | undefined;
  sort?: string | undefined;
}

const STORE_FULL_COLS = "id,owner_id,name,slug,address,district,city,rating,commission_rate,service_tier,is_verified,is_open,opening_hours,status,rejection_reason,reviewed_at,suspended_at,suspended_reason,suspended_by,created_at,updated_at";
const STORE_BASE_COLS = "id,owner_id,name,slug,address,district,city,rating,commission_rate,service_tier,is_verified,is_open,opening_hours,status,created_at,updated_at";

const listStores = async (q: ListStoresQuery): Promise<ListResult<Row> & { counts: Record<string, number> }> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);

  const buildQuery = (columns: string) => {
    let query = supabaseAdmin.from("stores").select(columns, { count: "exact" });
    if (q.status) query = query.eq("status", q.status);
    query = applySearch(query, q.q, ["name", "address", "district"]);
    return query.order(col, { ascending });
  };

  let result: ListResult<Row>;
  try {
    result = await paginate<Row>(buildQuery(STORE_FULL_COLS), { page: q.page, limit: q.limit });
  } catch (error: any) {
    if (isMissingColumnError(error?.details) || isMissingColumnError(error)) {
      result = await paginate<Row>(buildQuery(STORE_BASE_COLS), { page: q.page, limit: q.limit });
    } else {
      throw error;
    }
  }

  const owners = await loadByIds("profiles", result.items.map((s) => String(s.owner_id ?? "")), "id,full_name,phone,email,status");
  const [activeCount, pendingCount, suspendedCount, rejectedCount] = await Promise.all([
    safeCount("stores", (query) => query.eq("status", "active")),
    safeCount("stores", (query) => query.eq("status", "pending")),
    safeCount("stores", (query) => query.eq("status", "suspended")),
    safeCount("stores", (query) => query.eq("status", "rejected"))
  ]);

  const items = result.items.map((store) => {
    const owner = owners.get(String(store.owner_id));
    return {
      ...store,
      owner_name: owner?.full_name ?? null,
      owner_phone: owner?.phone ? maskPhone(owner.phone) : null
    };
  });

  return {
    ...result,
    items,
    counts: {
      active: activeCount,
      pending: pendingCount,
      suspended: suspendedCount,
      rejected: rejectedCount,
      total: activeCount + pendingCount + suspendedCount + rejectedCount
    }
  };
};

const getStoreDetail = async (id: string): Promise<Row> => {
  let { data, error } = await supabaseAdmin.from("stores").select(STORE_FULL_COLS).eq("id", id).maybeSingle();
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabaseAdmin.from("stores").select(STORE_BASE_COLS).eq("id", id).maybeSingle());
  }
  if (error) handleSupabaseError(error, "Failed to load store");
  const store = data as Row | null;
  if (!store) {
    throw new AppError("Không tìm thấy cửa hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const [
    ownerRes,
    partnerByStoreRes,
    payoutAccounts,
    wallet,
    reputation,
    productsRes,
    ordersRes,
    complaintsRes,
    donationsRes,
    recentAudit
  ] = await Promise.all([
    store.owner_id
      ? supabaseAdmin.from("profiles").select("id,full_name,email,phone,status,created_at").eq("id", store.owner_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin.from("partner_profiles").select("*").eq("store_id", id).maybeSingle(),
    payoutAccountService.getForStore(id).catch(() => ({ current: null, history: [] })),
    ledgerService.getStoreBalance(id).catch(() => null),
    sellerReputationService.getSellerReputation(id).catch(() => null),
    supabaseAdmin.from("products").select("id,label,is_active,stock_quantity").eq("store_id", id).limit(1000),
    supabaseAdmin
      .from("orders")
      .select("id,order_number,customer_id,status,payment_status,total_cents,created_at,completed_at")
      .eq("store_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("complaints")
      .select("id,order_id,customer_id,issue,priority,status,resolution,created_at,resolved_at")
      .eq("store_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("donations")
      .select("id,donation_code,charity_id,items,amount_text,weight_kg,urgency,status,expires_at,created_at,completed_at")
      .eq("store_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    adminAuditService.list(20, { target_id: id }).catch(() => [])
  ]);

  let partnerRow = (partnerByStoreRes.data as Row | null) ?? null;
  if (!partnerRow && store.owner_id) {
    const byOwner = await supabaseAdmin.from("partner_profiles").select("*").eq("profile_id", store.owner_id).maybeSingle();
    partnerRow = (byOwner.data as Row | null) ?? null;
  }

  const products = (productsRes.data ?? []) as Row[];
  const byLabel = { green: 0, yellow: 0, red: 0 };
  let activeProducts = 0;
  let outOfStock = 0;
  for (const p of products) {
    if (p.is_active) activeProducts += 1;
    if (Number(p.stock_quantity ?? 0) <= 0) outOfStock += 1;
    const lbl = String(p.label ?? "");
    if (lbl === "green" || lbl === "yellow" || lbl === "red") byLabel[lbl] += 1;
  }

  const ownerRow = (ownerRes.data as Row | null) ?? null;
  const owner = ownerRow
    ? { ...ownerRow, phone: ownerRow.phone ? maskPhone(ownerRow.phone) : null }
    : null;

  return {
    store,
    owner,
    partner_profile: sanitizePartnerProfile(partnerRow),
    payout_accounts: payoutAccounts,
    wallet,
    reputation,
    product_summary: {
      total: products.length,
      active: activeProducts,
      out_of_stock: outOfStock,
      by_label: byLabel
    },
    recent_orders: ((ordersRes.data ?? []) as Row[]).map(sanitizeOrder),
    recent_complaints: (complaintsRes.data ?? []) as Row[],
    recent_donations: ((donationsRes.data ?? []) as Row[]).map(sanitizeDonation),
    recent_audit: recentAudit.slice(0, 20)
  };
};

export interface ListStoreProductsQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  sort?: string | undefined;
}

const listStoreProducts = async (storeId: string, q: ListStoreProductsQuery): Promise<ListResult<Row>> => {
  const { data: store, error: storeErr } = await supabaseAdmin.from("stores").select("id").eq("id", storeId).maybeSingle();
  if (storeErr) handleSupabaseError(storeErr, "Failed to load store");
  if (!store) {
    throw new AppError("Không tìm thấy cửa hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const { col, ascending } = parseSort(q.sort, "created_at", false);
  let query = supabaseAdmin
    .from("products")
    .select("id,store_id,name,category,label,price_cents,original_price_cents,stock_quantity,sold_count,is_active,blocked_reason,expires_at,created_at", { count: "exact" })
    .eq("store_id", storeId);
  query = applySearch(query, q.q, ["name", "category"]);
  query = query.order(col, { ascending });
  return paginate<Row>(query, { page: q.page, limit: q.limit });
};

const updateStoreStatus = async (
  id: string,
  status: "active" | "suspended",
  reason: string | undefined,
  actor: AuditActor
): Promise<Row> => {
  const normalizedReason = status === "suspended" ? requireReason(reason, "tạm ngưng cửa hàng") : (reason?.trim() || null);

  const { data: found, error: findError } = await supabaseAdmin
    .from("stores")
    .select("id,owner_id,name,status,is_verified")
    .eq("id", id)
    .maybeSingle();
  if (findError) handleSupabaseError(findError, "Failed to load store");
  const store = found as Row | null;
  if (!store) {
    throw new AppError("Không tìm thấy cửa hàng", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  if (status === "active" && store.is_verified !== true) {
    throw new AppError("Chỉ có thể mở bán lại cho cửa hàng đã được xác minh", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }

  const now = new Date().toISOString();
  const fullPatch: Row = {
    status,
    suspended_at: status === "suspended" ? now : null,
    suspended_reason: status === "suspended" ? normalizedReason : null,
    suspended_by: status === "suspended" ? actor.userId : null,
    updated_at: now
  };

  let { data: updated, error: updateError } = await supabaseAdmin
    .from("stores")
    .update(fullPatch)
    .eq("id", id)
    .select("id,status,suspended_at,suspended_reason,suspended_by,updated_at")
    .single();

  if (updateError && isMissingColumnError(updateError)) {
    ({ data: updated, error: updateError } = await supabaseAdmin
      .from("stores")
      .update({ status, updated_at: now })
      .eq("id", id)
      .select("id,status,updated_at")
      .single());
  }
  if (updateError) handleSupabaseError(updateError, "Failed to update store status");

  await adminAuditService.log(
    actor,
    status === "suspended" ? "store.suspend" : "store.unsuspend",
    "store",
    id,
    { name: store.name, status, reason: normalizedReason }
  );

  return (updated as Row) ?? { id, status, updated_at: now };
};

/* ─────────────────────────── Charities & Volunteers (360°) ─────────────────────────── */

export interface ListCharitiesQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  status?: "active" | "pending" | "suspended" | "rejected" | undefined;
  sort?: string | undefined;
}

const CHARITY_FULL_COLS = "id,owner_id,name,slug,phone,email,address,district,city,beneficiaries_count,rating,is_open,status,approved_by,rejection_reason,reviewed_at,suspended_at,suspended_reason,metadata,created_at,updated_at";
const CHARITY_BASE_COLS = "id,owner_id,name,slug,phone,email,address,district,city,beneficiaries_count,rating,is_open,status,metadata,created_at,updated_at";

const listCharities = async (q: ListCharitiesQuery): Promise<ListResult<Row> & { counts: Record<string, number> }> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);

  const buildQuery = (columns: string) => {
    let query = supabaseAdmin.from("charity_profiles").select(columns, { count: "exact" });
    if (q.status) query = query.eq("status", q.status);
    query = applySearch(query, q.q, ["name", "address", "email", "phone"]);
    return query.order(col, { ascending });
  };

  let result: ListResult<Row>;
  try {
    result = await paginate<Row>(buildQuery(CHARITY_FULL_COLS), { page: q.page, limit: q.limit });
  } catch (error: any) {
    if (isMissingColumnError(error?.details) || isMissingColumnError(error)) {
      result = await paginate<Row>(buildQuery(CHARITY_BASE_COLS), { page: q.page, limit: q.limit });
    } else {
      throw error;
    }
  }

  const [activeCount, pendingCount, suspendedCount, rejectedCount] = await Promise.all([
    safeCount("charity_profiles", (query) => query.eq("status", "active")),
    safeCount("charity_profiles", (query) => query.eq("status", "pending")),
    safeCount("charity_profiles", (query) => query.eq("status", "suspended")),
    safeCount("charity_profiles", (query) => query.eq("status", "rejected"))
  ]);

  return {
    ...result,
    items: result.items.map(sanitizeCharity),
    counts: {
      active: activeCount,
      pending: pendingCount,
      suspended: suspendedCount,
      rejected: rejectedCount,
      total: activeCount + pendingCount + suspendedCount + rejectedCount
    }
  };
};

const getCharityDetail = async (id: string): Promise<Row> => {
  let { data, error } = await supabaseAdmin.from("charity_profiles").select(CHARITY_FULL_COLS).eq("id", id).maybeSingle();
  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabaseAdmin.from("charity_profiles").select(CHARITY_BASE_COLS).eq("id", id).maybeSingle());
  }
  if (error) handleSupabaseError(error, "Failed to load charity");
  const charityRow = data as Row | null;
  if (!charityRow) {
    throw new AppError("Không tìm thấy tổ chức", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const [ownerRes, volunteersRes, donationsRes, recentAudit] = await Promise.all([
    charityRow.owner_id
      ? supabaseAdmin.from("profiles").select("id,full_name,email,phone,status,created_at").eq("id", charityRow.owner_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabaseAdmin
      .from("volunteers")
      .select("id,charity_id,full_name,phone,email,role,duty_role,vehicle,zones,schedule,runs,kg_collected,rating,status,last_login_at,created_at")
      .eq("charity_id", id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("donations")
      .select("id,donation_code,store_id,charity_id,assigned_volunteer_id,items,amount_text,weight_kg,urgency,status,expires_at,accepted_at,completed_at,created_at")
      .eq("charity_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    adminAuditService.list(20, { target_id: id }).catch(() => [])
  ]);

  const ownerRow = (ownerRes.data as Row | null) ?? null;
  const owner = ownerRow
    ? { ...ownerRow, phone: ownerRow.phone ? maskPhone(ownerRow.phone) : null }
    : null;

  return {
    charity: sanitizeCharity(charityRow),
    owner,
    volunteers: (volunteersRes.data ?? []) as Row[],
    recent_donations: ((donationsRes.data ?? []) as Row[]).map(sanitizeDonation),
    recent_audit: recentAudit.slice(0, 20)
  };
};

const updateCharityStatus = async (
  id: string,
  status: "active" | "suspended",
  reason: string | undefined,
  actor: AuditActor
): Promise<Row> => {
  const normalizedReason = status === "suspended" ? requireReason(reason, "tạm ngưng tổ chức") : (reason?.trim() || null);

  const { data: found, error: findError } = await supabaseAdmin
    .from("charity_profiles")
    .select("id,owner_id,name,status")
    .eq("id", id)
    .maybeSingle();
  if (findError) handleSupabaseError(findError, "Failed to load charity");
  const charity = found as Row | null;
  if (!charity) {
    throw new AppError("Không tìm thấy tổ chức", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  if (status === "active" && (charity.status === "pending" || charity.status === "rejected")) {
    throw new AppError(
      "Chỉ có thể mở lại tổ chức đã được duyệt",
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.RESOURCE_CONFLICT
    );
  }

  const now = new Date().toISOString();
  const fullPatch: Row = {
    status,
    suspended_at: status === "suspended" ? now : null,
    suspended_reason: status === "suspended" ? normalizedReason : null,
    updated_at: now
  };

  let { data: updated, error: updateError } = await supabaseAdmin
    .from("charity_profiles")
    .update(fullPatch)
    .eq("id", id)
    .select("id,status,suspended_at,suspended_reason,updated_at")
    .single();

  if (updateError && isMissingColumnError(updateError)) {
    ({ data: updated, error: updateError } = await supabaseAdmin
      .from("charity_profiles")
      .update({ status, updated_at: now })
      .eq("id", id)
      .select("id,status,updated_at")
      .single());
  }
  if (updateError) handleSupabaseError(updateError, "Failed to update charity status");

  await adminAuditService.log(
    actor,
    status === "suspended" ? "charity.suspend" : "charity.unsuspend",
    "charity",
    id,
    { name: charity.name, status, reason: normalizedReason }
  );

  return (updated as Row) ?? { id, status, updated_at: now };
};

export interface ListVolunteersQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  status?: "new" | "active" | "inactive" | undefined;
  charity_id?: string | undefined;
  sort?: string | undefined;
}

const listVolunteers = async (q: ListVolunteersQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  let query = supabaseAdmin
    .from("volunteers")
    .select("id,charity_id,full_name,phone,email,role,duty_role,vehicle,zones,runs,kg_collected,rating,status,last_login_at,created_at", { count: "exact" });
  if (q.status) query = query.eq("status", q.status);
  if (q.charity_id) query = query.eq("charity_id", q.charity_id);
  query = applySearch(query, q.q, ["full_name", "phone", "email"]);
  query = query.order(col, { ascending });
  const result = await paginate<Row>(query, { page: q.page, limit: q.limit });

  const charities = await loadByIds("charity_profiles", result.items.map((v) => String(v.charity_id ?? "")), "id,name");
  return {
    ...result,
    items: result.items.map((v) => ({
      ...v,
      charity_name: charities.get(String(v.charity_id))?.name ?? null
    }))
  };
};

const getVolunteerDetail = async (id: string): Promise<Row> => {
  const { data, error } = await supabaseAdmin
    .from("volunteers")
    .select("id,charity_id,full_name,phone,email,role,duty_role,vehicle,zones,schedule,runs,kg_collected,rating,status,last_login_at,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) handleSupabaseError(error, "Failed to load volunteer");
  const volunteer = data as Row | null;
  if (!volunteer) {
    throw new AppError("Không tìm thấy tình nguyện viên", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const [charityRes, locationConsents, donationsRes] = await Promise.all([
    volunteer.charity_id
      ? supabaseAdmin.from("charity_profiles").select("id,name,address,district,city,status").eq("id", volunteer.charity_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    loadLocationConsents(id, "volunteer"),
    supabaseAdmin
      .from("donations")
      .select("id,donation_code,store_id,charity_id,items,amount_text,weight_kg,urgency,status,expires_at,accepted_at,completed_at,created_at")
      .eq("assigned_volunteer_id", id)
      .order("created_at", { ascending: false })
      .limit(10)
  ]);

  return {
    volunteer,
    charity: charityRes.data ? sanitizeCharity(charityRes.data as Row) : null,
    location_consents: locationConsents,
    recent_donations: ((donationsRes.data ?? []) as Row[]).map(sanitizeDonation)
  };
};

const updateVolunteerStatus = async (
  id: string,
  status: "active" | "inactive",
  reason: string | undefined,
  actor: AuditActor
): Promise<Row> => {
  const normalizedReason = status === "inactive" ? requireReason(reason, "vô hiệu hóa tình nguyện viên") : (reason?.trim() || null);

  const { data: found, error: findError } = await supabaseAdmin
    .from("volunteers")
    .select("id,charity_id,full_name,status")
    .eq("id", id)
    .maybeSingle();
  if (findError) handleSupabaseError(findError, "Failed to load volunteer");
  const volunteer = found as Row | null;
  if (!volunteer) {
    throw new AppError("Không tìm thấy tình nguyện viên", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("volunteers")
    .update({ status, updated_at: now })
    .eq("id", id)
    .select("id,charity_id,status,updated_at")
    .single();
  if (updateError) handleSupabaseError(updateError, "Failed to update volunteer status");

  await adminAuditService.log(actor, "volunteer.status", "volunteer", id, {
    full_name: volunteer.full_name,
    charity_id: volunteer.charity_id,
    from: volunteer.status,
    to: status,
    reason: normalizedReason
  });

  return (updated as Row) ?? { id, status, updated_at: now };
};

/* ─────────────────────────── Global Search ─────────────────────────── */

const GLOBAL_SEARCH_LIMIT = 5;

const globalSearch = async (rawQuery: string): Promise<{
  query: string;
  orders: Row[];
  accounts: Row[];
  stores: Row[];
  charities: Row[];
  complaints: Row[];
}> => {
  const term = sanitizeSearch(rawQuery);
  if (term.length < 2) {
    return { query: term, orders: [], accounts: [], stores: [], charities: [], complaints: [] };
  }

  const safeSelect = async (promise: PromiseLike<{ data: any; error: any }>): Promise<Row[]> => {
    try {
      const { data, error } = await promise;
      return error ? [] : ((data ?? []) as Row[]);
    } catch {
      return [];
    }
  };

  const [orders, accounts, stores, charities, complaints] = await Promise.all([
    safeSelect(
      applySearch(
        supabaseAdmin.from("orders").select("id,order_number,status,total_cents,created_at"),
        term,
        ["order_number"]
      ).order("created_at", { ascending: false }).limit(GLOBAL_SEARCH_LIMIT)
    ),
    safeSelect(
      applySearch(
        supabaseAdmin.from("profiles").select("id,full_name,role,status,email,phone"),
        term,
        ["full_name", "email", "phone"]
      ).order("created_at", { ascending: false }).limit(GLOBAL_SEARCH_LIMIT)
    ),
    safeSelect(
      applySearch(
        supabaseAdmin.from("stores").select("id,name,district,city,status,is_verified"),
        term,
        ["name", "address"]
      ).order("created_at", { ascending: false }).limit(GLOBAL_SEARCH_LIMIT)
    ),
    safeSelect(
      applySearch(
        supabaseAdmin.from("charity_profiles").select("id,name,district,city,status,phone"),
        term,
        ["name", "address", "phone", "email"]
      ).order("created_at", { ascending: false }).limit(GLOBAL_SEARCH_LIMIT)
    ),
    safeSelect(
      applySearch(
        supabaseAdmin.from("complaints").select("id,order_id,status,priority,issue,created_at"),
        term,
        ["issue"]
      ).order("created_at", { ascending: false }).limit(GLOBAL_SEARCH_LIMIT)
    )
  ]);

  return {
    query: term,
    orders: orders.slice(0, GLOBAL_SEARCH_LIMIT).map((o) => ({
      id: o.id,
      order_number: o.order_number,
      status: o.status,
      total_cents: o.total_cents,
      created_at: o.created_at
    })),
    accounts: accounts.slice(0, GLOBAL_SEARCH_LIMIT).map((a) => ({
      id: a.id,
      full_name: a.full_name ?? null,
      role: a.role,
      status: a.status,
      email: a.email ?? null,
      phone: a.phone ? maskPhone(a.phone) : null
    })),
    stores: stores.slice(0, GLOBAL_SEARCH_LIMIT).map((s) => ({
      id: s.id,
      name: s.name,
      district: s.district ?? null,
      city: s.city ?? null,
      status: s.status,
      is_verified: Boolean(s.is_verified)
    })),
    charities: charities.slice(0, GLOBAL_SEARCH_LIMIT).map((c) => ({
      id: c.id,
      name: c.name,
      district: c.district ?? null,
      city: c.city ?? null,
      status: c.status,
      phone: c.phone ? maskPhone(c.phone) : null
    })),
    complaints: complaints.slice(0, GLOBAL_SEARCH_LIMIT).map((c) => ({
      id: c.id,
      order_id: c.order_id,
      status: c.status,
      priority: c.priority,
      issue: c.issue,
      created_at: c.created_at
    }))
  };
};

export const adminPortal2Service = {
  listAccounts,
  getAccountDetail,
  updateAccountStatus,
  listStores,
  getStoreDetail,
  listStoreProducts,
  updateStoreStatus,
  listCharities,
  getCharityDetail,
  updateCharityStatus,
  listVolunteers,
  getVolunteerDetail,
  updateVolunteerStatus,
  globalSearch
};
