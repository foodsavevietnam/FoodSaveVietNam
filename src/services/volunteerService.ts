import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "../utils/appError";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { createSelectionToken, createVolunteerToken, normalizeEmail, verifySelectionToken } from "../utils/volunteerToken";
import { handleSupabaseError, requireRecord, supabaseAdmin, supabaseAuth } from "./supabaseService";
import { createNotification } from "./notificationService";
import { teamService } from "./teamService";
import { VISIBLE_WINDOW_MS } from "./locationService";
import { logger } from "../utils/logger";
import { bestOrder, routeDirectionsLinks, type DirectionsLinks } from "../core/routing";

type VolunteerRoute = { ordered_stops: Array<{ lat: number; lng: number; label: string }>; directions: DirectionsLinks };
type StoreInfo = { name?: string | null; latitude?: number | null; longitude?: number | null };

const isRunningPickup = (task: Record<string, unknown>): boolean =>
  task.does_pickup === true && ["accepted", "in_route"].includes(String(task.status)) && !(task.my_pickup as { done_at?: string | null } | null)?.done_at;

// Điểm lấy = cửa hàng của các lô đang chạy; điểm giao = tổ chức của lô đầu tiên; xuất phát = vị trí TNV vừa chia sẻ
const buildVolunteerRoute = async (volunteerId: string, running: Array<Record<string, unknown>>): Promise<VolunteerRoute | null> => {
  const { data: locData, error: locError } = await supabaseAdmin.from("live_locations").select("lat,lng").eq("actor_kind", "volunteer").eq("actor_id", volunteerId).gte("updated_at", new Date(Date.now() - VISIBLE_WINDOW_MS).toISOString()).maybeSingle();
  if (locError) handleSupabaseError(locError, "Không đọc được vị trí TNV");
  const here = locData as { lat: number; lng: number } | null;
  if (!here) return null;

  const stops = new Map<string, { id: string; lat: number; lng: number; label: string }>();
  for (const task of running) {
    const store = task.stores as StoreInfo | null;
    if (typeof store?.latitude !== "number" || typeof store.longitude !== "number") continue;
    const key = store.latitude.toFixed(6) + "," + store.longitude.toFixed(6);
    if (!stops.has(key)) stops.set(key, { id: key, lat: store.latitude, lng: store.longitude, label: store.name || "Cửa hàng" });
  }
  if (stops.size === 0) return null;

  const ids = running.map((task) => String(task.id));
  const { data: donationData, error: donationError } = await supabaseAdmin.from("donations").select("id,charity_id").in("id", ids);
  if (donationError) handleSupabaseError(donationError, "Không đọc được lô quyên góp");
  const charityId = ((donationData ?? []) as Array<{ charity_id: string | null }>).map((d) => d.charity_id).find(Boolean);
  if (!charityId) return null;
  const { data: charityData, error: charityError } = await supabaseAdmin.from("charity_profiles").select("latitude,longitude").eq("id", charityId).maybeSingle();
  if (charityError) handleSupabaseError(charityError, "Không đọc được tổ chức");
  const charity = charityData as { latitude: number | null; longitude: number | null } | null;
  if (typeof charity?.latitude !== "number" || typeof charity.longitude !== "number") return null;
  const dropoff = { lat: charity.latitude, lng: charity.longitude };

  const list = Array.from(stops.values());
  const plan = bestOrder({
    stops: list.map((s) => ({ id: s.id, location: { lat: s.lat, lng: s.lng } })),
    dropoff: { id: "dropoff", location: dropoff },
    start: { id: "start", location: here },
    departAt: new Date()
  });
  const ordered = plan.order.map((id) => stops.get(id)).filter((s): s is NonNullable<typeof s> => Boolean(s));
  return {
    ordered_stops: ordered.map(({ lat, lng, label }) => ({ lat, lng, label })),
    directions: routeDirectionsLinks(ordered.map((s) => ({ lat: s.lat, lng: s.lng })), dropoff, { origin: here })
  };
};

const normalizePhone =(value: string): string => {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("84") && digits.length >= 11 ? "0" + digits.slice(2) : digits;
};

interface VolunteerRow {
  id: string;
  charity_id: string;
  full_name: string;
  phone: string;
  status: string;
  vehicle: string;
  charity_profiles: { name: string } | null;
}

interface ProfileRow {
  id: string;
  charity_id: string;
  full_name: string;
  phone: string;
  email: string;
  vehicle: string;
  zones: string[];
  schedule: string;
  role: string;
  duty_role: string;
  active_on: string | null;
  avatar_url: string | null;
  status: string;
  runs: number;
  kg_collected: number;
  rating: number;
  charity_profiles: { name: string; owner_id: string } | null;
}

const PROFILE_SELECT = "id,charity_id,full_name,phone,email,vehicle,zones,schedule,role,duty_role,active_on,avatar_url,status,runs,kg_collected,rating,charity_profiles(name,owner_id)";

// Ngày hiện tại theo giờ Việt Nam (YYYY-MM-DD)
const vnToday = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());

export interface VolunteerProfilePatch {
  full_name?: string | undefined;
  email?: string | undefined;
  vehicle?: string | undefined;
  zones?: string[] | undefined;
  schedule?: string | undefined;
  duty_role?: "pickup" | "distribute" | "both" | undefined;
  avatar_url?: string | undefined;
}

const AVATAR_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const avatarPrefix = (volunteerId: string): string => env.SUPABASE_URL.replace(/\/+$/, "") + "/storage/v1/object/public/donation-proofs/avatars/volunteers/" + volunteerId + "/";

// ---- Đăng nhập OTP email cho TNV ----
const OTP_MAX_FAILED = 5;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const OTP_LOCK_MS = 15 * 60 * 1000;
const OTP_MAX_SENDS = 3;
const OTP_GENERIC_MESSAGE = "Nếu email đã được tổ chức đăng ký, mã sẽ được gửi.";
const VOLUNTEER_EMAIL_SELECT = "id,charity_id,full_name,phone,email,status";

interface EmailVolunteerRow {
  id: string;
  charity_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  status: string | null;
}

interface OtpAttemptRow {
  key: string;
  failed_count: number;
  window_started_at: string;
  locked_until: string | null;
}

export type VolunteerSession = { token: string; volunteer: { id: string; full_name: string; phone: string; charity_name: string } };
export type VolunteerSelection = { selection_token: string; options: Array<{ volunteer_id: string; charity_name: string }> };

// Khóa đếm theo email đã chuẩn hóa: mọi biến thể hoa/thường, khoảng trắng dùng chung một bộ đếm
const otpAttemptKey = (email: string): string => "volunteer-email:" + email;

// Log chỉ giữ ký tự đầu + tên miền, không bao giờ ghi đủ email
const maskEmail = (email: string): string => {
  const [name = "", domain = ""] = email.split("@");
  return name.slice(0, 1) + "***@" + domain;
};

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => "\\" + char);

const otpLockedError = (): AppError =>
  new AppError("Bạn đã nhập sai mã quá nhiều lần. Vui lòng thử lại sau 15 phút.", HTTP_STATUS.TOO_MANY_REQUESTS, ERROR_CODES.OTP_LOCKED);

// TNV còn hoạt động có email khớp (so sánh lowercase + trim; ilike chỉ để thu hẹp, lọc chính xác ở đây)
const findActiveVolunteersByEmail = async (email: string): Promise<EmailVolunteerRow[]> => {
  const { data, error } = await supabaseAdmin.from("volunteers").select(VOLUNTEER_EMAIL_SELECT).ilike("email", escapeLike(email)).limit(50);
  if (error) handleSupabaseError(error, "Không tra được tình nguyện viên theo email");
  return ((data ?? []) as unknown as EmailVolunteerRow[]).filter(
    (row) => typeof row.email === "string" && normalizeEmail(row.email) === email && row.status !== "inactive"
  );
};

const charityNames = async (charityIds: string[]): Promise<Map<string, string>> => {
  const ids = Array.from(new Set(charityIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from("charity_profiles").select("id,name").in("id", ids);
  if (error) handleSupabaseError(error, "Không đọc được tên tổ chức");
  return new Map(((data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name ?? ""]));
};

/**
 * Giữ chỗ một lượt trong auth_otp_attempts TRƯỚC khi làm việc thật: cập nhật kiểu compare-and-swap theo failed_count
 * nên nhiều request song song (kể cả trên nhiều instance serverless) không vượt quá `max` lượt / 15 phút.
 * Lượt thứ `max` đặt luôn locked_until = lockUntil(now, windowStart). Trả false khi đang khóa hoặc tranh chấp liên tục.
 */
const reserveAttemptSlot = async (key: string, max: number, lockUntil: (now: number, windowStart: number) => number): Promise<boolean> => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const now = Date.now();
    const { data, error } = await supabaseAdmin.from("auth_otp_attempts").select("key,failed_count,window_started_at,locked_until").eq("key", key).maybeSingle();
    if (error) handleSupabaseError(error, "Không đọc được bộ đếm OTP");
    const row = data as OtpAttemptRow | null;

    if (!row) {
      const { error: insertError } = await supabaseAdmin.from("auth_otp_attempts").insert({
        key, failed_count: 1, window_started_at: new Date(now).toISOString(),
        locked_until: max <= 1 ? new Date(lockUntil(now, now)).toISOString() : null
      });
      if (!insertError) return true;
      if (insertError.code !== "23505") handleSupabaseError(insertError, "Không ghi được bộ đếm OTP");
      continue; // request khác vừa tạo dòng: đọc lại
    }

    const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : null;
    if (lockedUntil !== null && lockedUntil > now) return false;

    const fresh = new Date(row.window_started_at).getTime() < now - OTP_WINDOW_MS || lockedUntil !== null;
    const count = (fresh ? 0 : Number(row.failed_count) || 0) + 1;
    const windowStart = fresh ? now : new Date(row.window_started_at).getTime();
    const patch = {
      failed_count: count,
      window_started_at: fresh ? new Date(now).toISOString() : row.window_started_at,
      locked_until: count >= max ? new Date(lockUntil(now, windowStart)).toISOString() : null
    };
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("auth_otp_attempts")
      .update(patch)
      .eq("key", key)
      .eq("failed_count", row.failed_count)
      .select("key");
    if (updateError) handleSupabaseError(updateError, "Không ghi được bộ đếm OTP");
    if (((updated ?? []) as unknown[]).length === 1) return true;
  }
  // Tranh chấp liên tục: coi như đang bị dò mã, từ chối
  return false;
};

// Xác minh: 5 lần sai / 15 phút, sau đó khóa 15 phút tính từ lượt thứ 5
const reserveOtpAttempt = async (key: string): Promise<void> => {
  if (!(await reserveAttemptSlot(key, OTP_MAX_FAILED, (now) => now + OTP_LOCK_MS))) throw otpLockedError();
};

// Gửi mã: tối đa 3 lần / 15 phút / email (khóa tới hết cửa sổ 15 phút). false → không gửi
const reserveOtpSend = (email: string): Promise<boolean> =>
  reserveAttemptSlot("volunteer-send:" + email, OTP_MAX_SENDS, (_now, windowStart) => windowStart + OTP_WINDOW_MS);

/**
 * Thời gian phản hồi tối thiểu của /otp/request: mọi nhánh (có/không có TNV, vượt hạn mức, lỗi) đều chờ tới cùng một mốc
 * để không đoán được email đã đăng ký qua thời gian phản hồi. Có thể thay `sleepUntil` trong test.
 */
export const otpRequestTiming = {
  minResponseMs: 1500,
  sleepUntil: (deadline: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())))
};

const resetOtpAttempts = async (key: string): Promise<void> => {
  const { error } = await supabaseAdmin
    .from("auth_otp_attempts")
    .update({ failed_count: 0, locked_until: null, window_started_at: new Date().toISOString() })
    .eq("key", key);
  if (error) handleSupabaseError(error, "Không ghi được bộ đếm OTP");
};

// OTP TNV tạo auth user không có hồ sơ (trigger bỏ qua account_type volunteer): xóa đi để email này
// sau đó vẫn đăng ký người mua được. Có hồ sơ (người mua/cửa hàng/...) hoặc không đọc được hồ sơ → KHÔNG xóa.
const removeOrphanAuthUser = async (userId: string, email: string): Promise<void> => {
  try {
    const { data, error } = await supabaseAdmin.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (error || data) return;
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) logger.warn("Không xóa được tài khoản Supabase tạm sau OTP TNV", { email: maskEmail(email) });
  } catch {
    logger.warn("Không xóa được tài khoản Supabase tạm sau OTP TNV", { email: maskEmail(email) });
  }
};

const issueOtpSession = async (row: EmailVolunteerRow, charityName: string): Promise<VolunteerSession> => {
  const { error } = await supabaseAdmin.from("volunteers").update({ last_login_at: new Date().toISOString() }).eq("id", row.id);
  if (error) handleSupabaseError(error, "Không cập nhật được lần đăng nhập");
  return {
    token: createVolunteerToken(row.id, row.charity_id, "otp"),
    volunteer: { id: row.id, full_name: row.full_name, phone: row.phone, charity_name: charityName }
  };
};

export const volunteerService = {
  async login(phone: string): Promise<{ token: string; volunteer: { id: string; full_name: string; phone: string; charity_name: string } }> {
    // The existing phone-only flow is a development demo, not identity proof.
    // Fail before lookup so public deployments cannot mint sessions or enumerate
    // volunteers until a verified sign-in flow is implemented.
    if (env.NODE_ENV === "production" || !env.DEMO_MODE) {
      throw new AppError(
        "Đăng nhập tình nguyện viên yêu cầu xác minh OTP. Đăng nhập thử chỉ bằng số điện thoại đang bị tắt.",
        HTTP_STATUS.FORBIDDEN,
        ERROR_CODES.AUTH_VERIFICATION_REQUIRED,
      );
    }
    const normalized = normalizePhone(phone);
    if (normalized.length < 9) {
      throw new AppError("Số điện thoại không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    }

    // Số điện thoại có thể được lưu kèm dấu cách, dấu chấm hay +84 nên so sánh sau khi chuẩn hóa
    const { data, error } = await supabaseAdmin
      .from("volunteers")
      .select("id,charity_id,full_name,phone,status,vehicle,charity_profiles(name)")
      .limit(2000);
    if (error) handleSupabaseError(error, "Failed to look up volunteer");

    const match = ((data ?? []) as unknown as VolunteerRow[]).find((row) => normalizePhone(row.phone) === normalized);
    if (!match) {
      throw new AppError("Số điện thoại này chưa được tổ chức đăng ký tình nguyện viên", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
    }
    if (match.status === "inactive") {
      throw new AppError("Tài khoản tình nguyện viên đang bị tạm ngưng", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    await supabaseAdmin.from("volunteers").update({ last_login_at: new Date().toISOString() }).eq("id", match.id);

    return {
      token: createVolunteerToken(match.id, match.charity_id, "demo"),
      volunteer: { id: match.id, full_name: match.full_name, phone: match.phone, charity_name: match.charity_profiles?.name ?? "" }
    };
  },
  // Bước 1 đăng nhập OTP: luôn trả cùng một thông báo để không lộ email nào đã đăng ký
  async requestOtp(rawEmail: string): Promise<{ message: string }> {
    const deadline = Date.now() + otpRequestTiming.minResponseMs;
    const email = normalizeEmail(rawEmail);
    try {
      const matches = await findActiveVolunteersByEmail(email);
      if (matches.length > 0 && (await reserveOtpSend(email))) {
        // Không gửi nền (Netlify có thể cắt tiến trình): chờ gửi nhưng không quá mốc thời gian
        const send = supabaseAuth.auth
          .signInWithOtp({ email, options: { shouldCreateUser: true, data: { account_type: "volunteer" } } })
          .then(
            ({ error }) => { if (error) logger.warn("Không gửi được mã OTP cho TNV", { email: maskEmail(email), reason: error.message }); },
            () => { logger.warn("Không gửi được mã OTP cho TNV", { email: maskEmail(email) }); }
          );
        await Promise.race([send, otpRequestTiming.sleepUntil(deadline)]);
      }
    } finally {
      await otpRequestTiming.sleepUntil(deadline);
    }
    return { message: OTP_GENERIC_MESSAGE };
  },

  // Bước 2: kiểm tra khóa → xác minh mã với Supabase → thu hồi phiên Supabase → cấp token TNV (amr "otp")
  async verifyOtp(rawEmail: string, code: string): Promise<VolunteerSession | VolunteerSelection> {
    const email = normalizeEmail(rawEmail);
    const key = otpAttemptKey(email);
    await reserveOtpAttempt(key);

    const { data, error } = await supabaseAuth.auth.verifyOtp({ email, token: code, type: "email" });
    if (error || !data.session) {
      logger.warn("TNV nhập mã OTP không hợp lệ", { email: maskEmail(email) });
      throw new AppError("Mã xác minh không đúng hoặc đã hết hạn", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
    }
    await resetOtpAttempts(key);

    // OTP chỉ để chứng minh sở hữu email: phiên Supabase vừa sinh không trả cho client nên thu hồi ngay
    try {
      const { error: signOutError } = await supabaseAdmin.auth.admin.signOut(data.session.access_token, "local");
      if (signOutError) logger.warn("Không thu hồi được phiên Supabase sau OTP TNV", { email: maskEmail(email) });
    } catch {
      logger.warn("Không thu hồi được phiên Supabase sau OTP TNV", { email: maskEmail(email) });
    }
    if (data.user?.id) await removeOrphanAuthUser(data.user.id, email);

    const matches = await findActiveVolunteersByEmail(email);
    if (matches.length === 0) {
      throw new AppError("Email này chưa được tổ chức đăng ký tình nguyện viên hoặc tài khoản đang tạm ngưng", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }
    const names = await charityNames(matches.map((row) => row.charity_id));
    const [only] = matches;
    if (matches.length === 1 && only) return issueOtpSession(only, names.get(only.charity_id) ?? "");
    return {
      selection_token: createSelectionToken(email),
      options: matches.map((row) => ({ volunteer_id: row.id, charity_name: names.get(row.charity_id) ?? "" }))
    };
  },

  // Bước 3 (email thuộc nhiều tổ chức): chọn một TNV bằng selection_token còn hạn 5 phút
  async selectVolunteer(selectionToken: string, volunteerId: string): Promise<VolunteerSession> {
    const forbidden = new AppError("Lựa chọn không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    const selection = verifySelectionToken(selectionToken);
    if (!selection) throw forbidden;

    const { data, error } = await supabaseAdmin.from("volunteers").select(VOLUNTEER_EMAIL_SELECT).eq("id", volunteerId).maybeSingle();
    if (error) handleSupabaseError(error, "Không tra được tình nguyện viên");
    const row = data as unknown as EmailVolunteerRow | null;
    if (!row || typeof row.email !== "string" || normalizeEmail(row.email) !== selection.email || row.status === "inactive") throw forbidden;

    const names = await charityNames([row.charity_id]);
    return issueOtpSession(row, names.get(row.charity_id) ?? "");
  },

  async getProfile(volunteerId: string): Promise<unknown> {
    const { data, error } = await supabaseAdmin.from("volunteers").select(PROFILE_SELECT).eq("id", volunteerId).maybeSingle();
    if (error) handleSupabaseError(error, "Failed to load volunteer profile");
    const row = requireRecord(data as unknown as ProfileRow | null, "Không tìm thấy tài khoản tình nguyện viên");
    return {
      id: row.id,
      full_name: row.full_name,
      phone: row.phone,
      email: row.email,
      vehicle: row.vehicle,
      zones: row.zones,
      schedule: row.schedule,
      role: row.role,
      duty_role: row.duty_role ?? "both",
      avatar_url: row.avatar_url,
      demo_mode: env.DEMO_MODE,
      active_today: row.active_on === vnToday(),
      status: row.status,
      runs: row.runs,
      kg_collected: Number(row.kg_collected) || 0,
      rating: Number(row.rating) || 5,
      charity_name: row.charity_profiles?.name ?? ""
    };
  },

  // TNV tự sửa thông tin. KHÔNG cho sửa số điện thoại: chỉ tổ chức được đổi số.
  async updateProfile(volunteerId: string, patch: VolunteerProfilePatch): Promise<unknown> {
    const { data: existing, error: loadError } = await supabaseAdmin.from("volunteers").select(PROFILE_SELECT).eq("id", volunteerId).maybeSingle();
    if (loadError) handleSupabaseError(loadError, "Failed to load volunteer profile");
    const row = requireRecord(existing as unknown as ProfileRow | null, "Không tìm thấy tài khoản tình nguyện viên");
    if (row.status === "inactive") {
      throw new AppError("Tài khoản tình nguyện viên đang bị tạm ngưng", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }

    const update: VolunteerProfilePatch = {};
    if (patch.full_name !== undefined) update.full_name = patch.full_name;
    if (patch.email !== undefined) update.email = patch.email;
    if (patch.vehicle !== undefined) update.vehicle = patch.vehicle;
    if (patch.zones !== undefined) update.zones = patch.zones;
    if (patch.schedule !== undefined) update.schedule = patch.schedule;
    if (patch.duty_role !== undefined) update.duty_role = patch.duty_role;
    if (patch.avatar_url !== undefined) {
      if (!patch.avatar_url.startsWith(avatarPrefix(volunteerId))) {
        throw new AppError("Ảnh đại diện không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }
      update.avatar_url = patch.avatar_url;
    }
    if (Object.keys(update).length > 0) {
      const { error } = await supabaseAdmin.from("volunteers").update(update).eq("id", volunteerId);
      if (error) handleSupabaseError(error, "Failed to update volunteer profile");

      // Báo tổ chức biết TNV vừa cập nhật thông tin (danh sách TNV của tổ chức cũng tự cập nhật theo)
      if (row.charity_profiles?.owner_id) {
        await createNotification({
          recipientId: row.charity_profiles.owner_id,
          roleTarget: "charity",
          type: "volunteer-profile-updated",
          title: "TNV " + (update.full_name ?? row.full_name) + " đã cập nhật thông tin",
          body: "Thông tin tình nguyện viên trong danh sách của tổ chức đã được làm mới.",
          relatedType: "volunteer",
          relatedId: volunteerId
        });
      }
    }
    return volunteerService.getProfile(volunteerId);
  },

  // Link tạm để TNV tải ảnh đại diện lên kho ảnh
  async createAvatarUploadUrl(volunteerId: string, contentType: string): Promise<{ path: string; token: string; signed_url: string; public_url: string }> {
    const extension = AVATAR_TYPES[contentType];
    if (!extension) throw new AppError("Chỉ nhận ảnh JPG, PNG hoặc WEBP", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
    const path = "avatars/volunteers/" + volunteerId + "/" + randomUUID() + "." + extension;
    const bucket = supabaseAdmin.storage.from("donation-proofs");
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error || !data) {
      throw new AppError("Không tạo được link tải ảnh. Hãy chắc chắn đã chạy file SQL 019.", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
    return { path, token: data.token, signed_url: data.signedUrl, public_url: bucket.getPublicUrl(path).data.publicUrl };
  },

  // Bật / tắt "đang hoạt động hôm nay". Còn việc dở thì không cho tắt.
  async setActive(volunteerId: string, active: boolean): Promise<unknown> {
    if (!active) {
      const { count, error: countError } = await supabaseAdmin
        .from("donations")
        .select("id", { count: "exact", head: true })
        .eq("assigned_volunteer_id", volunteerId)
        .in("status", ["accepted", "in_route"]);
      if (countError) handleSupabaseError(countError, "Failed to check volunteer tasks");
      if ((count ?? 0) > 0) {
        throw new AppError("Bạn còn " + count + " việc chưa xong nên chưa thể tắt hoạt động", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
      }
    }
    const { error } = await supabaseAdmin.from("volunteers").update({ active_on: active ? vnToday() : null }).eq("id", volunteerId);
    if (error) handleSupabaseError(error, "Failed to update volunteer activity");
    return volunteerService.getProfile(volunteerId);
  },

  // Gắn `route` (thứ tự điểm lấy tối ưu từ vị trí hiện tại của TNV) cho các nhiệm vụ lấy hàng đang chạy
  async listTasks(volunteerId: string): Promise<unknown[]> {
    const tasks = (await teamService.listVolunteerTasks(volunteerId)) as Array<Record<string, unknown>>;
    const withRoute = (route: VolunteerRoute | null) => (task: Record<string, unknown>) => ({ ...task, route: isRunningPickup(task) ? route : null });
    if (!tasks.some(isRunningPickup)) return tasks.map(withRoute(null));
    try {
      return tasks.map(withRoute(await buildVolunteerRoute(volunteerId, tasks.filter(isRunningPickup))));
    } catch (error) {
      logger.warn("Không dựng được tuyến tối ưu cho TNV, giữ danh sách cũ", { volunteerId, error });
      return tasks.map(withRoute(null));
    }
  },

  // TNV bấm "Bắt đầu đi lấy"
  async startTask(volunteerId: string, donationId: string): Promise<unknown> {
    const { data: loaded, error: loadError } = await supabaseAdmin
      .from("donations")
      .select("id,status,assigned_volunteer_id,donation_code,stores!inner(owner_id),volunteers!assigned_volunteer_id(full_name)")
      .eq("id", donationId)
      .maybeSingle();
    if (loadError) handleSupabaseError(loadError, "Failed to load task");
    const task = requireRecord(
      loaded as unknown as { id: string; status: string; assigned_volunteer_id: string | null; donation_code: string; stores: { owner_id: string }; volunteers: { full_name: string } | null } | null,
      "Không tìm thấy nhiệm vụ"
    );
    const { data: mine } = await supabaseAdmin.from("donation_assignments").select("id").eq("donation_id", donationId).eq("volunteer_id", volunteerId).eq("stage", "pickup").maybeSingle();
    if (!mine && task.assigned_volunteer_id !== volunteerId) {
      throw new AppError("Nhiệm vụ này không được giao cho bạn", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
    }
    const { data: me } = await supabaseAdmin.from("volunteers").select("full_name").eq("id", volunteerId).maybeSingle();
    const myName = (me as { full_name: string } | null)?.full_name ?? "Tình nguyện viên";
    if (task.status !== "accepted") {
      throw new AppError("Nhiệm vụ này không ở trạng thái chờ xuất phát", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }

    const { data, error } = await supabaseAdmin
      .from("donations")
      .update({ status: "in_route" })
      .eq("id", donationId)
      .eq("status", "accepted")
      .select("id,status")
      .single();
    if (error) handleSupabaseError(error, "Failed to start task");

    await createNotification({
      recipientId: task.stores.owner_id,
      roleTarget: "partner",
      type: "donation-volunteer-en-route",
      title: "TNV đang đến lấy lô " + task.donation_code,
      body: myName + " đã xuất phát đến cửa hàng.",
      relatedType: "donation",
      relatedId: donationId
    });
    return data;
  }
};
