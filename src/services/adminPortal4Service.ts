/**
 * Wave 5B — Admin Portal Đợt 4:
 *   - Quản trị viên (list, create kèm rollback auth user, grant, status, revoke)
 *   - Thông báo hệ thống & broadcast (cooldown 10 phút/role, thống kê push_subscriptions)
 *   - Hộp thư hỗ trợ: contact_messages & applications (che đệ quy bank/account/cccd/tax/id_card/identity)
 *   - Tổng quan bảng điều khiển (RPC fs_admin_overview + JS fallback theo giờ Việt Nam)
 */
import { z } from "zod";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { adminAuditService, type AuditActor } from "./adminAuditService";
import { applySearch, loadByIds, paginate, type ListResult } from "./adminListing";
import { createNotification } from "./notificationService";
import { pushService } from "./pushService";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

type Row = Record<string, any>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_SCHEMA = z.string().trim().email();
const BROADCAST_COOLDOWN_MS = 10 * 60 * 1000;
const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

const roleBroadcastCooldownUntil = new Map<string, number>();

/** Xóa bộ đếm cooldown broadcast theo vai trò (phục vụ unit test). */
export const resetBroadcastCooldowns = (): void => {
  roleBroadcastCooldownUntil.clear();
};

const isMissingTableError = (error: { code?: string | null; message?: string | null } | null | undefined): boolean =>
  error?.code === "42P01" || error?.code === "PGRST205";

const isMissingColumnError = (error: { code?: string | null; message?: string | null } | null | undefined): boolean =>
  error?.code === "42703" || error?.code === "PGRST204";

const isMissingRpcError = (error: { code?: string | null; message?: string | null } | null | undefined): boolean => {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  const msg = String(error.message ?? "");
  return /42883|PGRST202|could not find the function|function .* does not exist|chưa hỗ trợ rpc/i.test(msg);
};

const escapeLikeExact = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const parseSort = (sort: string | undefined, defaultCol: string, defaultAsc = false): { col: string; ascending: boolean } => {
  if (!sort) return { col: defaultCol, ascending: defaultAsc };
  const [col, dir] = sort.split(".");
  return { col: col || defaultCol, ascending: dir === "asc" };
};

const requireReason = (reason: string | undefined, actionText: string, maxLen = 500): string => {
  const trimmed = (reason ?? "").trim();
  if (trimmed.length < 3) {
    throw new AppError(`Cần nhập lý do ${actionText} (ít nhất 3 ký tự)`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  if (trimmed.length > maxLen) {
    throw new AppError(`Lý do ${actionText} tối đa ${maxLen} ký tự`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  return trimmed;
};

/* ─────────────────────────── A. Admins Management ─────────────────────────── */

export interface CreateAdminInput {
  email: string;
  full_name: string;
  password: string;
}

export interface GrantAdminInput {
  identifier: string;
  reason: string;
}

const ADMIN_FULL_COLS = "id,role,full_name,email,phone,status,last_login_at,suspended_at,suspended_reason,created_at,updated_at";
const ADMIN_BASE_COLS = "id,role,full_name,email,phone,status,created_at,updated_at";

const ensureRemainingActiveAdmin = async (excludeAdminId: string): Promise<void> => {
  const { count, error } = await supabaseAdmin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("status", "active")
    .neq("id", excludeAdminId);
  if (error) handleSupabaseError(error, "Failed to verify remaining active admins");
  if ((count ?? 0) < 1) {
    throw new AppError(
      "Phải giữ lại ít nhất 1 quản trị viên đang hoạt động",
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.RESOURCE_CONFLICT
    );
  }
};

const loadAuthUsersMap = async (): Promise<Map<string, { email?: string | null; last_sign_in_at?: string | null }>> => {
  const map = new Map<string, { email?: string | null; last_sign_in_at?: string | null }>();
  try {
    const authAdmin = (supabaseAdmin as any)?.auth?.admin;
    if (!authAdmin || typeof authAdmin.listUsers !== "function") return map;
    const res = await authAdmin.listUsers({ page: 1, perPage: 200 });
    const users = res?.data?.users;
    if (Array.isArray(users)) {
      for (const u of users) {
        if (u && typeof u.id === "string") {
          map.set(u.id, {
            email: typeof u.email === "string" ? u.email : null,
            last_sign_in_at: typeof u.last_sign_in_at === "string" ? u.last_sign_in_at : null
          });
        }
      }
    }
  } catch {
    // Bỏ qua nếu môi trường stub không có listUsers
  }
  return map;
};

const listAdmins = async (): Promise<{ items: Row[]; total: number; active_count: number }> => {
  let rows: Row[] = [];
  const firstRes = await supabaseAdmin
    .from("profiles")
    .select(ADMIN_FULL_COLS)
    .eq("role", "admin")
    .order("created_at", { ascending: false });

  if (firstRes.error && isMissingColumnError(firstRes.error)) {
    const fallbackRes = await supabaseAdmin
      .from("profiles")
      .select(ADMIN_BASE_COLS)
      .eq("role", "admin")
      .order("created_at", { ascending: false });
    if (fallbackRes.error) handleSupabaseError(fallbackRes.error, "Failed to load admins");
    rows = (fallbackRes.data ?? []) as Row[];
  } else {
    if (firstRes.error) handleSupabaseError(firstRes.error, "Failed to load admins");
    rows = (firstRes.data ?? []) as Row[];
  }
  const authMap = await loadAuthUsersMap();

  const items = rows.map((row) => {
    const authInfo = authMap.get(String(row.id));
    return {
      id: row.id,
      full_name: row.full_name ?? null,
      email: row.email ?? authInfo?.email ?? null,
      phone: row.phone ?? null,
      status: row.status,
      ...(row.suspended_at !== undefined ? { suspended_at: row.suspended_at } : {}),
      ...(row.suspended_reason !== undefined ? { suspended_reason: row.suspended_reason } : {}),
      created_at: row.created_at,
      last_sign_in_at: authInfo?.last_sign_in_at ?? row.last_login_at ?? null
    };
  });

  const activeCount = items.filter((item) => item.status === "active").length;
  return {
    items,
    total: items.length,
    active_count: activeCount
  };
};

const createAdmin = async (input: CreateAdminInput, actor: AuditActor): Promise<Row> => {
  const emailParsed = EMAIL_SCHEMA.safeParse(input.email);
  if (!emailParsed.success) {
    throw new AppError("Email quản trị viên không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  const normalizedEmail = emailParsed.data.toLowerCase();
  const trimmedName = (input.full_name ?? "").trim();
  if (trimmedName.length < 2 || trimmedName.length > 120) {
    throw new AppError("Họ tên quản trị viên phải từ 2 đến 120 ký tự", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  const password = String(input.password ?? "");
  if (password.length < 10 || password.length > 128) {
    throw new AppError("Mật khẩu quản trị viên phải từ 10 đến 128 ký tự", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const { data: existingProfile, error: existingErr } = await supabaseAdmin
    .from("profiles")
    .select("id,role")
    .ilike("email", escapeLikeExact(normalizedEmail))
    .maybeSingle();
  if (existingErr) handleSupabaseError(existingErr, "Failed to verify existing email");
  if (existingProfile) {
    throw new AppError(
      "Email này đã tồn tại trên hệ thống. Hãy dùng chức năng cấp quyền quản trị cho tài khoản có sẵn.",
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.RESOURCE_CONFLICT
    );
  }

  const { data: createdAuth, error: createAuthError } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: trimmedName }
  });

  if (createAuthError || !createdAuth?.user?.id) {
    const msg = String(createAuthError?.message ?? "");
    if (/already|exists|registered|duplicate/i.test(msg)) {
      throw new AppError("Email này đã được đăng ký", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
    throw new AppError(
      msg || "Không tạo được tài khoản xác thực cho quản trị viên",
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const createdUserId = createdAuth.user.id;
  const now = new Date().toISOString();
  let savedProfile: Row | null = null;

  try {
    const profilePatch = {
      role: "admin" as const,
      status: "active" as const,
      full_name: trimmedName,
      email: normalizedEmail,
      updated_at: now
    };

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("profiles")
      .update(profilePatch)
      .eq("id", createdUserId)
      .select(ADMIN_BASE_COLS)
      .single();

    if (updateErr) {
      if (updateErr.code === "PGRST116") {
        // Môi trường không chạy trigger handle_new_user (ví dụ FakeDb) -> chèn trực tiếp dòng profile
        const { data: inserted, error: insertErr } = await supabaseAdmin
          .from("profiles")
          .insert({ id: createdUserId, ...profilePatch })
          .select(ADMIN_BASE_COLS)
          .single();
        if (insertErr) handleSupabaseError(insertErr, "Failed to insert admin profile");
        savedProfile = inserted as Row;
      } else {
        handleSupabaseError(updateErr, "Failed to promote created user to admin");
      }
    } else {
      savedProfile = updated as Row;
    }

    const { error: deleteCustomerErr } = await supabaseAdmin
      .from("customer_profiles")
      .delete()
      .eq("profile_id", createdUserId);
    if (deleteCustomerErr && !isMissingTableError(deleteCustomerErr)) {
      handleSupabaseError(deleteCustomerErr, "Failed to cleanup customer profile for new admin");
    }
  } catch (error) {
    try {
      await supabaseAdmin.auth.admin.deleteUser(createdUserId);
    } catch (rollbackError) {
      logger.warn("Rollback deleteUser thất bại sau lỗi tạo admin", { createdUserId, error: rollbackError });
    }
    throw error;
  }

  await adminAuditService.log(actor, "admin.create", "admin", createdUserId, {
    email: normalizedEmail,
    full_name: trimmedName
  });

  return {
    id: savedProfile?.id ?? createdUserId,
    full_name: savedProfile?.full_name ?? trimmedName,
    email: savedProfile?.email ?? normalizedEmail,
    phone: savedProfile?.phone ?? null,
    role: "admin",
    status: savedProfile?.status ?? "active",
    created_at: savedProfile?.created_at ?? now,
    last_sign_in_at: null
  };
};

const grantAdmin = async (input: GrantAdminInput, actor: AuditActor): Promise<Row> => {
  const identifier = (input.identifier ?? "").trim();
  if (!identifier) {
    throw new AppError("Cần nhập email hoặc UUID tài khoản", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  const normalizedReason = requireReason(input.reason, "cấp quyền quản trị");

  let query = supabaseAdmin.from("profiles").select(ADMIN_BASE_COLS);
  if (UUID_RE.test(identifier)) {
    query = query.eq("id", identifier);
  } else {
    query = query.ilike("email", escapeLikeExact(identifier.toLowerCase()));
  }

  const { data: found, error: findError } = await query.maybeSingle();
  if (findError) handleSupabaseError(findError, "Failed to find profile for admin grant");
  const target = found as Row | null;
  if (!target) {
    throw new AppError("Không tìm thấy tài khoản phù hợp", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }
  if (target.role === "admin") {
    throw new AppError("Tài khoản này đã là quản trị viên", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }
  if (target.status === "suspended") {
    throw new AppError(
      "Không thể cấp quyền quản trị cho tài khoản đang bị tạm khóa",
      HTTP_STATUS.CONFLICT,
      ERROR_CODES.RESOURCE_CONFLICT
    );
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ role: "admin", status: "active", updated_at: now })
    .eq("id", String(target.id))
    .select(ADMIN_BASE_COLS)
    .single();
  if (updateError) handleSupabaseError(updateError, "Failed to grant admin role");

  await adminAuditService.log(actor, "admin.grant", "admin", String(target.id), {
    identifier,
    previous_role: target.role,
    reason: normalizedReason
  });

  return (updated as Row) ?? { ...target, role: "admin", status: "active", updated_at: now };
};

const updateAdminStatus = async (
  id: string,
  status: "active" | "suspended",
  reason: string | undefined,
  actor: AuditActor
): Promise<Row> => {
  const normalizedReason = status === "suspended" ? requireReason(reason, "tạm khóa quản trị viên") : (reason?.trim() || null);

  if (actor.userId.toLowerCase() === id.toLowerCase()) {
    throw new AppError(
      "Không thể tự thay đổi trạng thái khóa của chính mình",
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const { data: found, error: findError } = await supabaseAdmin
    .from("profiles")
    .select("id,role,status,full_name,email")
    .eq("id", id)
    .maybeSingle();
  if (findError) handleSupabaseError(findError, "Failed to load admin");
  const target = found as Row | null;
  if (!target || target.role !== "admin") {
    throw new AppError("Không tìm thấy quản trị viên", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const targetId = String(target.id);
  if (status === "suspended") {
    await ensureRemainingActiveAdmin(targetId);
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
    .eq("id", targetId)
    .select("id,role,status,suspended_at,suspended_reason,updated_at")
    .single();

  if (updateError && isMissingColumnError(updateError)) {
    ({ data: updated, error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ status, updated_at: now })
      .eq("id", targetId)
      .select("id,role,status,updated_at")
      .single());
  }
  if (updateError) handleSupabaseError(updateError, "Failed to update admin status");

  await adminAuditService.log(
    actor,
    status === "suspended" ? "admin.suspend" : "admin.unsuspend",
    "admin",
    targetId,
    { status, reason: normalizedReason }
  );

  return (updated as Row) ?? { id: targetId, role: "admin", status, updated_at: now };
};

const revokeAdmin = async (id: string, reason: string | undefined, actor: AuditActor): Promise<Row> => {
  const normalizedReason = requireReason(reason, "thu hồi quyền quản trị");

  if (actor.userId.toLowerCase() === id.toLowerCase()) {
    throw new AppError(
      "Không thể tự thu hồi quyền quản trị của chính mình",
      HTTP_STATUS.BAD_REQUEST,
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  const { data: found, error: findError } = await supabaseAdmin
    .from("profiles")
    .select("id,role,status,full_name,email")
    .eq("id", id)
    .maybeSingle();
  if (findError) handleSupabaseError(findError, "Failed to load admin");
  const target = found as Row | null;
  if (!target || target.role !== "admin") {
    throw new AppError("Không tìm thấy quản trị viên", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const targetId = String(target.id);
  await ensureRemainingActiveAdmin(targetId);

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("profiles")
    .update({ role: "customer", updated_at: now })
    .eq("id", targetId)
    .select("id,role,status,full_name,email,updated_at")
    .single();
  if (updateError) handleSupabaseError(updateError, "Failed to revoke admin role");

  await adminAuditService.log(actor, "admin.revoke", "admin", targetId, {
    reason: normalizedReason,
    previous_status: target.status
  });

  return (updated as Row) ?? { id: targetId, role: "customer", status: target.status, updated_at: now };
};

/* ─────────────────────────── B. Broadcast Notifications ─────────────────────────── */

export interface SendAdminNotificationInput {
  target: "role" | "user" | "users";
  role?: "customer" | "partner" | "charity" | undefined;
  user_id?: string | undefined;
  user_ids?: string[] | undefined;
  title: string;
  body: string;
  push?: boolean | undefined;
}

export interface ListAdminNotificationsQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  sort?: string | undefined;
}

const sendAdminNotification = async (
  input: SendAdminNotificationInput,
  actor: AuditActor
): Promise<{ sent_count: number; push_attempted: boolean }> => {
  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (title.length < 2 || title.length > 140) {
    throw new AppError("Tiêu đề thông báo phải từ 2 đến 140 ký tự", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  if (body.length < 2 || body.length > 1000) {
    throw new AppError("Nội dung thông báo phải từ 2 đến 1000 ký tự", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  let recipients: Array<{ id: string; role: UserRole }> = [];

  if (input.target === "role") {
    if (!input.role || !["customer", "partner", "charity"].includes(input.role)) {
      throw new AppError("Cần chọn nhóm vai trò nhận thông báo hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    const cooldownUntil = roleBroadcastCooldownUntil.get(input.role) ?? 0;
    if (cooldownUntil > Date.now()) {
      throw new AppError(
        `Nhóm vai trò ${input.role} vừa được gửi thông báo hàng loạt. Vui lòng chờ đủ 10 phút giữa hai lần gửi.`,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        ERROR_CODES.RATE_LIMITED
      );
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,role")
      .eq("role", input.role)
      .eq("status", "active")
      .limit(5000);
    if (error) handleSupabaseError(error, "Failed to load active recipients by role");
    recipients = ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      role: (r.role as UserRole) ?? input.role!
    }));
  } else if (input.target === "user") {
    if (!input.user_id || !UUID_RE.test(input.user_id)) {
      throw new AppError("Cần truyền user_id hợp lệ khi gửi cho cá nhân", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,role")
      .eq("id", input.user_id)
      .maybeSingle();
    if (error) handleSupabaseError(error, "Failed to load recipient profile");
    if (!data) {
      throw new AppError("Không tìm thấy người nhận thông báo", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    recipients = [{ id: String((data as Row).id), role: ((data as Row).role as UserRole) ?? "customer" }];
  } else if (input.target === "users") {
    if (!Array.isArray(input.user_ids) || input.user_ids.length < 1 || input.user_ids.length > 200) {
      throw new AppError("Danh sách user_ids phải từ 1 đến 200 người nhận", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    if (input.user_ids.some((uid) => !UUID_RE.test(String(uid)))) {
      throw new AppError("Danh sách user_ids chứa mã định danh không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }
    const uniqueIds = [...new Set(input.user_ids)];
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,role")
      .in("id", uniqueIds);
    if (error) handleSupabaseError(error, "Failed to load recipient profiles");
    recipients = ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      role: (r.role as UserRole) ?? "customer"
    }));
  } else {
    throw new AppError("Loại đối tượng nhận thông báo không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  if (recipients.length === 1) {
    const single = recipients[0]!;
    await createNotification(
      {
        recipientId: single.id,
        roleTarget: single.role,
        type: "admin_broadcast",
        title,
        body
      },
      { strict: true }
    );
  } else if (recipients.length > 1) {
    for (let i = 0; i < recipients.length; i += 200) {
      const chunk = recipients.slice(i, i + 200).map((r) => ({
        recipient_id: r.id,
        role_target: r.role,
        type: "admin_broadcast",
        title,
        body,
        related_type: null,
        related_id: null
      }));
      const { error: insertError } = await supabaseAdmin.from("notifications").insert(chunk);
      if (insertError) handleSupabaseError(insertError, "Failed to insert broadcast notifications");
    }
  }

  if (input.target === "role" && input.role) {
    roleBroadcastCooldownUntil.set(input.role, Date.now() + BROADCAST_COOLDOWN_MS);
  }

  let pushAttempted = false;
  if (input.push === true && recipients.length > 0) {
    pushAttempted = true;
    try {
      const payload = {
        title,
        body,
        url: "/FOODSAVE_USER.html",
        appUrl: "/FOODSAVE_APP.html",
        tag: "admin-broadcast",
        type: "admin_broadcast"
      };
      if (input.target === "role" && input.role === "customer") {
        await pushService.sendToAllCustomers(payload, "orders");
      } else {
        for (let i = 0; i < recipients.length; i += 10) {
          const batch = recipients.slice(i, i + 10);
          await Promise.all(batch.map((r) => pushService.sendToUser(r.id, payload)));
        }
      }
    } catch (pushErr) {
      logger.warn("Gửi Web Push cho thông báo Admin thất bại (không làm hỏng luồng chính)", {
        error: pushErr instanceof Error ? pushErr.message : String(pushErr)
      });
    }
  }

  await adminAuditService.log(actor, "notification.send", "notification", null, {
    target: input.target,
    role: input.role ?? null,
    count: recipients.length,
    push: Boolean(input.push)
  });

  return {
    sent_count: recipients.length,
    push_attempted: pushAttempted
  };
};

const listAdminNotifications = async (q: ListAdminNotificationsQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  let query = supabaseAdmin
    .from("notifications")
    .select("id,recipient_id,role_target,type,title,body,read_at,created_at", { count: "exact" })
    .ilike("type", "admin%");
  query = applySearch(query, q.q, ["title", "body"]);
  query = query.order(col, { ascending });

  const result = await paginate<Row>(query, { page: q.page, limit: q.limit });
  const recipients = await loadByIds(
    "profiles",
    result.items.map((item) => String(item.recipient_id ?? "")),
    "id,full_name,email"
  );

  return {
    ...result,
    items: result.items.map((item) => {
      const rec = item.recipient_id ? recipients.get(String(item.recipient_id)) : undefined;
      return {
        ...item,
        recipient_name: rec?.full_name ?? null,
        recipient_email: rec?.email ?? null
      };
    })
  };
};

const getNotificationStats = async (): Promise<{
  total_subscriptions: number;
  by_role: Record<string, number>;
  recent_broadcasts: number;
}> => {
  const byRole: Record<string, number> = {
    customer: 0,
    volunteer: 0,
    partner: 0,
    charity: 0,
    admin: 0
  };
  let totalSubscriptions = 0;

  try {
    const { data, error } = await supabaseAdmin.from("push_subscriptions").select("role").limit(10000);
    if (error) {
      if (!isMissingTableError(error)) {
        handleSupabaseError(error, "Failed to load push subscriptions stats");
      }
    } else if (Array.isArray(data)) {
      totalSubscriptions = data.length;
      for (const row of data as Row[]) {
        const r = String(row.role ?? "customer");
        byRole[r] = (byRole[r] ?? 0) + 1;
      }
    }
  } catch (error: any) {
    if (!isMissingTableError(error) && !isMissingTableError(error?.details)) {
      throw error;
    }
  }

  let recentBroadcasts = 0;
  try {
    const since7d = new Date(Date.now() - 7 * DAY_MS).toISOString();
    const { count, error } = await supabaseAdmin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .ilike("type", "admin%")
      .gte("created_at", since7d);
    if (!error) {
      recentBroadcasts = count ?? 0;
    }
  } catch {
    recentBroadcasts = 0;
  }

  return {
    total_subscriptions: totalSubscriptions,
    by_role: byRole,
    recent_broadcasts: recentBroadcasts
  };
};

/* ─────────────────────────── C. Support Inbox ─────────────────────────── */

export interface ListContactMessagesQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  status?: "open" | "in_review" | "in_progress" | "resolved" | "closed" | undefined;
  sort?: string | undefined;
}

export interface UpdateSupportItemInput {
  status?: string | undefined;
  admin_note?: string | undefined;
}

export interface ListApplicationsQuery {
  page: number;
  limit: number;
  q?: string | undefined;
  status?: "pending" | "in_review" | "approved" | "rejected" | "resolved" | undefined;
  type?: "partner" | "charity" | undefined;
  sort?: string | undefined;
}

const CONTACT_FULL_COLS = "id,user_id,full_name,email,phone,subject,message,status,admin_note,handled_by,handled_at,created_at,updated_at";
const CONTACT_BASE_COLS = "id,user_id,full_name,email,phone,subject,message,status,created_at,updated_at";
const CONTACT_STATUS_MAP: Record<string, "open" | "in_review" | "closed"> = {
  open: "open",
  in_review: "in_review",
  in_progress: "in_review",
  resolved: "closed",
  closed: "closed"
};

const APPLICATION_FULL_COLS = "id,user_id,type,org_name,contact_name,email,phone,status,payload,admin_note,handled_by,handled_at,created_at,updated_at";
const APPLICATION_BASE_COLS = "id,user_id,type,org_name,contact_name,email,phone,status,payload,created_at,updated_at";
const APPLICATION_STATUS_MAP: Record<string, "pending" | "in_review" | "approved" | "rejected"> = {
  pending: "pending",
  in_review: "in_review",
  approved: "approved",
  resolved: "approved",
  rejected: "rejected"
};

const APPLICATION_SENSITIVE_KEY_RE = /(?:bank|account|cccd|cmnd|tax|id_card|identity|citizen_id|iban)/i;
const APPLICATION_SAFE_TOP_LEVEL_KEYS = new Set([
  "id",
  "user_id",
  "type",
  "org_name",
  "contact_name",
  "email",
  "phone",
  "status",
  "payload",
  "admin_note",
  "handled_by",
  "handled_at",
  "created_at",
  "updated_at"
]);

const maskScalarSecret = (value: unknown): unknown => {
  if (value === null || value === undefined || value === "") return value;
  const text = String(value).trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return "[đã che]";
  if (text.length <= 4) return "••••";
  return `${"•".repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
};

/** Che đệ quy mọi trường nhạy cảm (bank|account|cccd|tax|id_card|identity...) trong payload/cột. */
export const maskApplicationSensitiveFields = (value: unknown, forceMask = false): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => maskApplicationSensitiveFields(item, forceMask));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sensitive = forceMask || APPLICATION_SENSITIVE_KEY_RE.test(k);
      out[k] = maskApplicationSensitiveFields(v, sensitive);
    }
    return out;
  }
  if (typeof value === "boolean") return value;
  return forceMask ? maskScalarSecret(value) : value;
};

const sanitizeApplicationRow = (row: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "payload") {
      out.payload = v && typeof v === "object" ? maskApplicationSensitiveFields(v, false) : {};
    } else if (!APPLICATION_SAFE_TOP_LEVEL_KEYS.has(k) && APPLICATION_SENSITIVE_KEY_RE.test(k)) {
      out[k] = maskApplicationSensitiveFields(v, true);
    } else {
      out[k] = v;
    }
  }
  return out;
};

const listContactMessages = async (q: ListContactMessagesQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  const resolvedStatus = q.status ? CONTACT_STATUS_MAP[q.status] : undefined;
  const buildQuery = (cols: string) => {
    let query = supabaseAdmin.from("contact_messages").select(cols, { count: "exact" });
    if (resolvedStatus) query = query.eq("status", resolvedStatus);
    query = applySearch(query, q.q, ["full_name", "email", "phone", "subject", "message"]);
    return query.order(col, { ascending });
  };

  try {
    return await paginate<Row>(buildQuery(CONTACT_FULL_COLS), { page: q.page, limit: q.limit });
  } catch (error: any) {
    if (isMissingTableError(error) || isMissingTableError(error?.details)) {
      return { items: [], total: 0, page: q.page, limit: q.limit };
    }
    if (isMissingColumnError(error) || isMissingColumnError(error?.details)) {
      try {
        return await paginate<Row>(buildQuery(CONTACT_BASE_COLS), { page: q.page, limit: q.limit });
      } catch (retryErr: any) {
        if (isMissingTableError(retryErr) || isMissingTableError(retryErr?.details)) {
          return { items: [], total: 0, page: q.page, limit: q.limit };
        }
        throw retryErr;
      }
    }
    throw error;
  }
};

const updateContactMessage = async (id: string, input: UpdateSupportItemInput, actor: AuditActor): Promise<Row> => {
  if (input.status === undefined && input.admin_note === undefined) {
    throw new AppError("Cần cung cấp trạng thái hoặc ghi chú xử lý", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  const normalizedStatus = input.status !== undefined ? CONTACT_STATUS_MAP[input.status] : undefined;
  if (input.status !== undefined && !normalizedStatus) {
    throw new AppError("Trạng thái liên hệ không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  if (input.admin_note !== undefined && input.admin_note.length > 1000) {
    throw new AppError("Ghi chú xử lý tối đa 1000 ký tự", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const { data: existing, error: findErr } = await supabaseAdmin
    .from("contact_messages")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();
  if (findErr) {
    if (isMissingTableError(findErr)) {
      throw new AppError("Không tìm thấy tin nhắn liên hệ", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    handleSupabaseError(findErr, "Failed to load contact message");
  }
  if (!existing) {
    throw new AppError("Không tìm thấy tin nhắn liên hệ", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const now = new Date().toISOString();
  const fullPatch: Row = {
    ...(normalizedStatus !== undefined ? { status: normalizedStatus } : {}),
    ...(input.admin_note !== undefined ? { admin_note: input.admin_note } : {}),
    handled_by: actor.userId,
    handled_at: now,
    updated_at: now
  };

  let { data: updated, error: updateErr } = await supabaseAdmin
    .from("contact_messages")
    .update(fullPatch)
    .eq("id", id)
    .select(CONTACT_FULL_COLS)
    .single();

  if (updateErr && isMissingColumnError(updateErr)) {
    const basePatch: Row = {
      ...(normalizedStatus !== undefined ? { status: normalizedStatus } : {}),
      updated_at: now
    };
    ({ data: updated, error: updateErr } = await supabaseAdmin
      .from("contact_messages")
      .update(basePatch)
      .eq("id", id)
      .select(CONTACT_BASE_COLS)
      .single());
  }
  if (updateErr) handleSupabaseError(updateErr, "Failed to update contact message");

  const finalStatus = normalizedStatus ?? (existing as Row).status;
  await adminAuditService.log(actor, "contact.update", "contact_message", id, {
    status: finalStatus,
    has_note: input.admin_note !== undefined
  });

  return (updated as Row) ?? { id, status: finalStatus, updated_at: now };
};

const listApplications = async (q: ListApplicationsQuery): Promise<ListResult<Row>> => {
  const { col, ascending } = parseSort(q.sort, "created_at", false);
  const resolvedStatus = q.status ? APPLICATION_STATUS_MAP[q.status] : undefined;
  const buildQuery = (cols: string) => {
    let query = supabaseAdmin.from("applications").select(cols, { count: "exact" });
    if (resolvedStatus) query = query.eq("status", resolvedStatus);
    if (q.type) query = query.eq("type", q.type);
    query = applySearch(query, q.q, ["org_name", "contact_name", "email", "phone"]);
    return query.order(col, { ascending });
  };

  let result: ListResult<Row>;
  try {
    result = await paginate<Row>(buildQuery(APPLICATION_FULL_COLS), { page: q.page, limit: q.limit });
  } catch (error: any) {
    if (isMissingTableError(error) || isMissingTableError(error?.details)) {
      return { items: [], total: 0, page: q.page, limit: q.limit };
    }
    if (isMissingColumnError(error) || isMissingColumnError(error?.details)) {
      try {
        result = await paginate<Row>(buildQuery(APPLICATION_BASE_COLS), { page: q.page, limit: q.limit });
      } catch (retryErr: any) {
        if (isMissingTableError(retryErr) || isMissingTableError(retryErr?.details)) {
          return { items: [], total: 0, page: q.page, limit: q.limit };
        }
        throw retryErr;
      }
    } else {
      throw error;
    }
  }

  return {
    ...result,
    items: result.items.map(sanitizeApplicationRow)
  };
};

const updateApplication = async (id: string, input: UpdateSupportItemInput, actor: AuditActor): Promise<Row> => {
  if (input.status === undefined && input.admin_note === undefined) {
    throw new AppError("Cần cung cấp trạng thái hoặc ghi chú xử lý", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  const normalizedStatus = input.status !== undefined ? APPLICATION_STATUS_MAP[input.status] : undefined;
  if (input.status !== undefined && !normalizedStatus) {
    throw new AppError("Trạng thái đơn đăng ký không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }
  if (input.admin_note !== undefined && input.admin_note.length > 1000) {
    throw new AppError("Ghi chú xử lý tối đa 1000 ký tự", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const { data: existing, error: findErr } = await supabaseAdmin
    .from("applications")
    .select("id,type,status")
    .eq("id", id)
    .maybeSingle();
  if (findErr) {
    if (isMissingTableError(findErr)) {
      throw new AppError("Không tìm thấy đơn đăng ký", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
    }
    handleSupabaseError(findErr, "Failed to load application");
  }
  if (!existing) {
    throw new AppError("Không tìm thấy đơn đăng ký", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  const now = new Date().toISOString();
  const fullPatch: Row = {
    ...(normalizedStatus !== undefined ? { status: normalizedStatus } : {}),
    ...(input.admin_note !== undefined ? { admin_note: input.admin_note } : {}),
    handled_by: actor.userId,
    handled_at: now,
    updated_at: now
  };

  let { data: updated, error: updateErr } = await supabaseAdmin
    .from("applications")
    .update(fullPatch)
    .eq("id", id)
    .select(APPLICATION_FULL_COLS)
    .single();

  if (updateErr && isMissingColumnError(updateErr)) {
    const basePatch: Row = {
      ...(normalizedStatus !== undefined ? { status: normalizedStatus } : {}),
      updated_at: now
    };
    ({ data: updated, error: updateErr } = await supabaseAdmin
      .from("applications")
      .update(basePatch)
      .eq("id", id)
      .select(APPLICATION_BASE_COLS)
      .single());
  }
  if (updateErr) handleSupabaseError(updateErr, "Failed to update application");

  const finalStatus = normalizedStatus ?? (existing as Row).status;
  await adminAuditService.log(actor, "application.update", "application", id, {
    status: finalStatus,
    type: (existing as Row).type,
    has_note: input.admin_note !== undefined
  });

  return sanitizeApplicationRow((updated as Row) ?? { id, status: finalStatus, updated_at: now });
};

/* ─────────────────────────── D. Dashboard Overview ─────────────────────────── */

export interface DashboardOverviewSeriesPoint {
  date: string;
  orders: number;
  gmv_cents: number;
  donations: number;
  complaints: number;
  new_users: number;
}

export interface DashboardOverviewTotals {
  orders: number;
  orders_completed: number;
  orders_cancelled: number;
  orders_no_show: number;
  gmv_cents: number;
  donations: number;
  donations_completed: number;
  complaints: number;
  new_users: number;
}

export interface DashboardOverviewResult {
  days: number;
  timezone: "Asia/Ho_Chi_Minh";
  totals: DashboardOverviewTotals;
  series: DashboardOverviewSeriesPoint[];
  source?: "rpc" | "fallback";
}

const toVnDateKey = (value: unknown): string | null => {
  if (!value) return null;
  const ts = Date.parse(String(value));
  if (Number.isNaN(ts)) return null;
  return new Date(ts + VN_OFFSET_MS).toISOString().slice(0, 10);
};

const computeOverviewFallback = async (days: number): Promise<DashboardOverviewResult> => {
  const vnNow = new Date(Date.now() + VN_OFFSET_MS);
  const todayVnMidnightShifted = Date.UTC(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate());
  const startVnMidnightShifted = todayVnMidnightShifted - (days - 1) * DAY_MS;
  const endExclusiveVnMidnightShifted = todayVnMidnightShifted + DAY_MS;

  const startIso = new Date(startVnMidnightShifted - VN_OFFSET_MS).toISOString();
  const endIso = new Date(endExclusiveVnMidnightShifted - VN_OFFSET_MS).toISOString();

  const buckets = new Map<string, DashboardOverviewSeriesPoint>();
  const series: DashboardOverviewSeriesPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const dateKey = new Date(startVnMidnightShifted + i * DAY_MS).toISOString().slice(0, 10);
    const point: DashboardOverviewSeriesPoint = {
      date: dateKey,
      orders: 0,
      gmv_cents: 0,
      donations: 0,
      complaints: 0,
      new_users: 0
    };
    buckets.set(dateKey, point);
    series.push(point);
  }

  const [ordersRes, donationsRes, complaintsRes, profilesRes] = await Promise.all([
    supabaseAdmin
      .from("orders")
      .select("status,total_cents,created_at")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(20000),
    supabaseAdmin
      .from("donations")
      .select("status,created_at")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(20000),
    supabaseAdmin
      .from("complaints")
      .select("status,created_at")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(20000),
    supabaseAdmin
      .from("profiles")
      .select("role,created_at")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(20000)
  ]);

  if (ordersRes.error) handleSupabaseError(ordersRes.error, "Failed to aggregate orders overview");
  if (donationsRes.error) handleSupabaseError(donationsRes.error, "Failed to aggregate donations overview");
  if (complaintsRes.error) handleSupabaseError(complaintsRes.error, "Failed to aggregate complaints overview");
  if (profilesRes.error) handleSupabaseError(profilesRes.error, "Failed to aggregate profiles overview");

  const totals: DashboardOverviewTotals = {
    orders: 0,
    orders_completed: 0,
    orders_cancelled: 0,
    orders_no_show: 0,
    gmv_cents: 0,
    donations: 0,
    donations_completed: 0,
    complaints: 0,
    new_users: 0
  };

  for (const row of (ordersRes.data ?? []) as Row[]) {
    const key = toVnDateKey(row.created_at);
    const bucket = key ? buckets.get(key) : undefined;
    if (!bucket) continue;
    totals.orders += 1;
    bucket.orders += 1;
    if (row.status === "completed") {
      const cents = Number(row.total_cents || 0);
      totals.orders_completed += 1;
      totals.gmv_cents += cents;
      bucket.gmv_cents += cents;
    } else if (row.status === "cancelled") {
      totals.orders_cancelled += 1;
    } else if (row.status === "no_show") {
      totals.orders_no_show += 1;
    }
  }

  for (const row of (donationsRes.data ?? []) as Row[]) {
    const key = toVnDateKey(row.created_at);
    const bucket = key ? buckets.get(key) : undefined;
    if (!bucket) continue;
    totals.donations += 1;
    bucket.donations += 1;
    if (row.status === "completed") {
      totals.donations_completed += 1;
    }
  }

  for (const row of (complaintsRes.data ?? []) as Row[]) {
    const key = toVnDateKey(row.created_at);
    const bucket = key ? buckets.get(key) : undefined;
    if (!bucket) continue;
    totals.complaints += 1;
    bucket.complaints += 1;
  }

  for (const row of (profilesRes.data ?? []) as Row[]) {
    const key = toVnDateKey(row.created_at);
    const bucket = key ? buckets.get(key) : undefined;
    if (!bucket) continue;
    totals.new_users += 1;
    bucket.new_users += 1;
  }

  return {
    days,
    timezone: "Asia/Ho_Chi_Minh",
    totals,
    series,
    source: "fallback"
  };
};

const getDashboardOverview = async (rawDays = 7): Promise<DashboardOverviewResult> => {
  const clampedDays = Math.min(Math.max(Math.trunc(Number(rawDays) || 7), 1), 90);
  const { data, error } = await supabaseAdmin.rpc("fs_admin_overview", { p_days: clampedDays });
  if (!error && data && typeof data === "object") {
    const payload = data as DashboardOverviewResult;
    return {
      ...payload,
      source: payload.source ?? "rpc"
    };
  }
  if (error && !isMissingRpcError(error)) {
    handleSupabaseError(error, "Failed to load admin dashboard overview");
  }
  return computeOverviewFallback(clampedDays);
};

export const adminPortal4Service = {
  listAdmins,
  createAdmin,
  grantAdmin,
  updateAdminStatus,
  revokeAdmin,
  sendAdminNotification,
  listAdminNotifications,
  getNotificationStats,
  resetBroadcastCooldowns,
  listContactMessages,
  updateContactMessage,
  listApplications,
  updateApplication,
  maskApplicationSensitiveFields,
  getDashboardOverview
};
