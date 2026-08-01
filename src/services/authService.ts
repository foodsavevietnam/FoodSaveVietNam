import type { Session, User } from "@supabase/supabase-js";
import { env } from "../config/env";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type {
  FacebookOAuthCallbackBody,
  FacebookOAuthStartBody,
  GoogleOAuthStartBody,
  GoogleOtpRequestBody,
  GoogleOtpVerifyBody,
  LoginBody,
  PasswordResetBody,
  PhoneOtpRequestBody,
  PhoneOtpVerifyBody,
  RegisterCharityBody,
  RegisterPartnerBody
} from "../schemas/authSchemas";
import type { Profile, UserRole } from "../types/domain";
import { AppError } from "../utils/appError";
import { logger } from "../utils/logger";
import { handleSupabaseError } from "./supabaseService";

type AuthAuditEvent =
  | "REGISTER_SUCCESS"
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "TOKEN_REFRESH"
  | "PASSWORD_RESET_REQUESTED"
  | "GOOGLE_OAUTH_STARTED"
  | "GOOGLE_OTP_SENT"
  | "GOOGLE_OTP_VERIFIED"
  | "GOOGLE_OTP_FAILED"
  | "FACEBOOK_OAUTH_STARTED"
  | "FACEBOOK_OAUTH_COMPLETED"
  | "FACEBOOK_OAUTH_FAILED"
  | "PHONE_OTP_SENT"
  | "PHONE_OTP_VERIFIED"
  | "PHONE_OTP_FAILED";

interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

// "customer" was removed: no more standalone customer/cart/order role in this project.
// partner_profiles was merged into public.stores; there is no separate "partner" record anymore.
interface AuthContext {
  store: unknown | null;
  charity: unknown | null;
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    phone: string;
    created_at: string;
  };
  profile: Profile;
  session: {
    access_token: string;
    refresh_token: string;
    expires_at: number | null;
    token_type: string;
  };
  context: AuthContext;
}

type OAuthProvider = "google" | "facebook";

interface OAuthProviderConfig {
  provider: OAuthProvider;
  label: string;
  emailLabel: string;
  scopes: string;
  queryParams?: Record<string, string>;
  audit: {
    started: AuthAuditEvent;
    oauthCompleted?: AuthAuditEvent;
    oauthFailed?: AuthAuditEvent;
    otpSent?: AuthAuditEvent;
    otpVerified?: AuthAuditEvent;
    otpFailed?: AuthAuditEvent;
  };
  missingEmailMessage: string;
  duplicateEmailMessage: string;
  invalidSessionMessage: string;
  invalidProviderMessage: string;
  invalidOtpMessage?: string;
  otpSendFailureMessage?: string;
  oauthStartFailureMessage: string;
  notRegisteredMessage: string;
}

export interface OAuthStartResult {
  provider: OAuthProvider;
  auth_url: string;
  redirect_to: string;
}

export interface OAuthOtpSentResult {
  challenge_id: string;
  email: string;
  provider: OAuthProvider;
  expires_at: string;
  expires_in_seconds: number;
  otp_sent: true;
}

export interface PhoneOtpSentResult {
  phone: string;
  channel: "sms";
  expires_in_seconds: number;
  otp_sent: true;
}

interface OAuthOtpChallenge {
  id: string;
  user_id: string;
  email: string;
  expected_role: UserRole | null;
  expires_at: string;
  verified_at: string | null;
}

export type GoogleOAuthStartResult = OAuthStartResult & { provider: "google" };
export type GoogleOtpSentResult = OAuthOtpSentResult & { provider: "google" };
export type FacebookOAuthStartResult = OAuthStartResult & { provider: "facebook" };

const normalizePhone = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) {
    return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  }
  return trimmed.replace(/\D/g, "");
};

const phoneLoginCandidates = (value: string): string[] => {
  const normalized = normalizePhone(value);
  const withoutPlus = normalized.startsWith("+") ? normalized.slice(1) : normalized;
  const candidates = new Set<string>([value.trim(), normalized]);

  if (withoutPlus.startsWith("84")) {
    candidates.add(`+${withoutPlus}`);
  }

  if (withoutPlus.startsWith("0") && withoutPlus.length >= 10) {
    candidates.add(`+84${withoutPlus.slice(1)}`);
  }

  if (!withoutPlus.startsWith("0") && !withoutPlus.startsWith("84") && withoutPlus.length >= 9) {
    candidates.add(`+84${withoutPlus}`);
  }

  return Array.from(candidates).filter(Boolean);
};

const normalizePhoneForSms = (value: string): string => {
  const normalized = normalizePhone(value);
  if (normalized.startsWith("+")) return normalized;

  if (normalized.startsWith("84")) {
    return `+${normalized}`;
  }

  if (normalized.startsWith("0") && normalized.length >= 10) {
    return `+84${normalized.slice(1)}`;
  }

  return `+84${normalized}`;
};

const compactObject = (value: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
};

const metadataText = (metadata: Record<string, unknown>, ...keys: string[]): string | null => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
};

const oauthProviderConfigs: Record<OAuthProvider, OAuthProviderConfig> = {
  google: {
    provider: "google",
    label: "Google",
    emailLabel: "Gmail",
    scopes: "email profile",
    queryParams: {
      prompt: "select_account"
    },
    audit: {
      started: "GOOGLE_OAUTH_STARTED",
      otpSent: "GOOGLE_OTP_SENT",
      otpVerified: "GOOGLE_OTP_VERIFIED",
      otpFailed: "GOOGLE_OTP_FAILED"
    },
    missingEmailMessage: "Google không trả về Gmail hợp lệ cho tài khoản này",
    duplicateEmailMessage: "Gmail này đã thuộc một tài khoản FoodSave khác. Vui lòng đăng nhập bằng tài khoản hiện có rồi kết nối Google trong hồ sơ.",
    invalidSessionMessage: "Phiên Google không hợp lệ hoặc đã hết hạn",
    invalidProviderMessage: "Phiên đăng nhập không phải Google",
    invalidOtpMessage: "Mã OTP Google không hợp lệ hoặc đã hết hạn",
    otpSendFailureMessage: "Không thể gửi OTP về Gmail của bạn",
    oauthStartFailureMessage: "Không thể khởi tạo đăng nhập Google",
    notRegisteredMessage: "Gmail này chưa được đăng ký làm Đối tác hoặc Tổ chức từ thiện trên FoodSave. Vui lòng đăng ký tài khoản trước."
  },
  facebook: {
    provider: "facebook",
    label: "Facebook",
    emailLabel: "email Facebook",
    scopes: "email,public_profile",
    audit: {
      started: "FACEBOOK_OAUTH_STARTED",
      oauthCompleted: "FACEBOOK_OAUTH_COMPLETED",
      oauthFailed: "FACEBOOK_OAUTH_FAILED"
    },
    missingEmailMessage: "Facebook không trả về email cho tài khoản này. Facebook chỉ cung cấp email khi tài khoản có email đã xác minh và bạn cấp quyền email; vui lòng cập nhật email trong Facebook hoặc dùng Google/email mật khẩu.",
    duplicateEmailMessage: "Email Facebook này đã thuộc một tài khoản FoodSave khác. Vui lòng đăng nhập bằng tài khoản hiện có rồi kết nối Facebook trong hồ sơ.",
    invalidSessionMessage: "Phiên Facebook không hợp lệ hoặc đã hết hạn",
    invalidProviderMessage: "Phiên đăng nhập không phải Facebook",
    oauthStartFailureMessage: "Không thể khởi tạo đăng nhập Facebook",
    notRegisteredMessage: "Tài khoản Facebook này chưa được đăng ký làm Đối tác hoặc Tổ chức từ thiện trên FoodSave. Vui lòng đăng ký tài khoản trước."
  }
};

const isOAuthAuthUser = (user: User, oauthProvider: OAuthProvider): boolean => {
  const appMetadata = user.app_metadata as Record<string, unknown>;
  const provider = typeof appMetadata.provider === "string" ? appMetadata.provider : "";
  const providers = Array.isArray(appMetadata.providers)
    ? appMetadata.providers.filter((item): item is string => typeof item === "string")
    : [];
  const identities = Array.isArray(user.identities) ? user.identities : [];

  return provider === oauthProvider || providers.includes(oauthProvider) || identities.some((identity) => identity.provider === oauthProvider);
};

const authError = (message: string, statusCode = HTTP_STATUS.UNAUTHORIZED, code = ERROR_CODES.AUTH_INVALID_TOKEN): AppError => {
  return new AppError(message, statusCode, code);
};

const writeAuditLog = async (
  eventType: AuthAuditEvent,
  userId: string | null,
  role: UserRole | null,
  meta: RequestMeta,
  metadata: Record<string, unknown> = {}
): Promise<void> => {
  const { error } = await supabaseAdmin.from("auth_audit_logs").insert({
    user_id: userId,
    role,
    event_type: eventType,
    ip_address: meta.ipAddress,
    user_agent: meta.userAgent,
    metadata
  });

  if (error) {
    logger.warn("Không thể ghi auth audit log", error);
  }
};

const loadProfile = async (userId: string): Promise<Profile> => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error || !data) {
    throw authError("Không tìm thấy hồ sơ người dùng", HTTP_STATUS.UNAUTHORIZED, ERROR_CODES.AUTH_INVALID_TOKEN);
  }

  return data as Profile;
};

const loadProfileByIdOrNull = async (userId: string): Promise<Profile | null> => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) handleSupabaseError(error, "Failed to load profile");
  return (data as Profile | null) ?? null;
};

const loadContext = async (userId: string, role: UserRole): Promise<AuthContext> => {
  if (role === "partner") {
    const { data, error } = await supabaseAdmin
      .from("stores")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) handleSupabaseError(error, "Failed to load partner store context");
    return {
      store: (data ?? [])[0] ?? null,
      charity: null
    };
  }

  if (role === "charity") {
    const { data, error } = await supabaseAdmin
      .from("charity_profiles")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at", { ascending: true })
      .limit(1);

    if (error) handleSupabaseError(error, "Failed to load charity profile context");
    return {
      store: null,
      charity: (data ?? [])[0] ?? null
    };
  }

  return {
    store: null,
    charity: null
  };
};

const buildAuthResult = async (user: User, session: Session): Promise<AuthResult> => {
  const profile = await loadProfile(user.id);
  const context = await loadContext(user.id, profile.role);

  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      phone: user.phone ?? "",
      created_at: user.created_at ?? ""
    },
    profile,
    session: {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
      token_type: session.token_type
    },
    context
  };
};

const resolveEmailFromIdentifier = async (identifier: string): Promise<string> => {
  const trimmed = identifier.trim();
  if (trimmed.includes("@")) return trimmed.toLowerCase();

  const candidates = phoneLoginCandidates(trimmed);
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .in("phone", candidates);

  if (error) handleSupabaseError(error, "Failed to resolve login phone");
  if (!data || data.length === 0) {
    throw authError("Email, số điện thoại hoặc mật khẩu không chính xác");
  }

  const email = (data[0] as { email: string | null }).email;
  if (!email) {
    throw authError("Tài khoản này chưa có email đăng nhập hợp lệ");
  }

  return email;
};

const loadProfileByPhone = async (phone: string): Promise<Profile> => {
  const candidates = phoneLoginCandidates(phone);

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .in("phone", candidates)
    .limit(1);

  if (error) handleSupabaseError(error, "Failed to load profile by phone");
  if (!data || data.length === 0) {
    throw authError("Số điện thoại hoặc mã OTP không chính xác");
  }

  return data[0] as Profile;
};

const assertProfileCanLoginWithPhoneOtp = async (
  profile: Profile,
  expectedRole: UserRole | undefined,
  meta: RequestMeta,
  metadata: Record<string, unknown>
): Promise<void> => {
  if (expectedRole && profile.role !== expectedRole) {
    await writeAuditLog("PHONE_OTP_FAILED", profile.id, profile.role, meta, {
      ...metadata,
      reason: "ROLE_MISMATCH",
      expected_role: expectedRole
    });
    throw new AppError("Tài khoản không thuộc đúng cổng đăng nhập", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  if (profile.status === "suspended") {
    await writeAuditLog("PHONE_OTP_FAILED", profile.id, profile.role, meta, {
      ...metadata,
      reason: "SUSPENDED"
    });
    throw new AppError("Tài khoản đã bị tạm khóa", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
};

const syncAuthUserPhoneForOtp = async (profile: Profile, smsPhone: string): Promise<void> => {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, {
    phone: smsPhone
  });

  if (error) {
    logger.warn("Không thể đồng bộ số điện thoại Auth user trước khi gửi OTP", {
      userId: profile.id,
      providerMessage: error.message
    });
    throw new AppError("Không thể chuẩn bị OTP SMS cho số điện thoại này", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
};

const createAuthUser = async (
  role: UserRole,
  email: string,
  password: string,
  fullName: string,
  phone: string,
  // Keys here are read by the public.handle_new_user() trigger (014 migration) to
  // auto-create the matching pending public.stores / public.charity_profiles row.
  triggerMetadata: Record<string, unknown>
): Promise<User> => {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    phone: normalizePhoneForSms(phone),
    password,
    email_confirm: true,
    user_metadata: {
      role,
      full_name: fullName,
      phone,
      ...triggerMetadata
    }
  });

  if (error || !data.user) {
    const message = error?.message.toLowerCase().includes("already") ? "Email đã được đăng ký" : "Không thể tạo tài khoản";
    const status = error?.message.toLowerCase().includes("already") ? HTTP_STATUS.CONFLICT : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    throw new AppError(message, status, status === HTTP_STATUS.CONFLICT ? ERROR_CODES.RESOURCE_CONFLICT : ERROR_CODES.INTERNAL_SERVER_ERROR);
  }

  return data.user;
};

const signInWithEmailPassword = async (email: string, password: string): Promise<{ user: User; session: Session }> => {
  const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });

  if (error || !data.user || !data.session) {
    throw authError("Email, số điện thoại hoặc mật khẩu không chính xác");
  }

  return {
    user: data.user,
    session: data.session
  };
};

// public.profiles only has id/role/email/full_name/phone/status/created_at/updated_at now
// (014 migration dropped avatar_url/points/rank/auth_provider/last_login_at/
// terms_accepted_at/marketing_opt_in/metadata). Keep this upsert limited to real columns.
const upsertProfile = async (
  userId: string,
  role: UserRole,
  email: string,
  fullName: string,
  phone: string,
  status: "active" | "pending"
): Promise<void> => {
  const { error } = await supabaseAdmin.from("profiles").upsert({
    id: userId,
    role,
    email,
    full_name: fullName,
    phone,
    status
  });

  if (error) handleSupabaseError(error, "Failed to upsert auth profile");
};

const partnerOpeningHoursText = (schedule: RegisterPartnerBody["opening_schedule"]): string => {
  const openSlots = (schedule ?? [])
    .filter((item) => item.open !== false && item.from && item.to)
    .map((item) => `${item.day} ${item.from}-${item.to}`);

  return openSlots.length > 0 ? openSlots.join("; ") : "08:00-22:00";
};

const deleteCreatedUser = async (userId: string | null): Promise<void> => {
  if (!userId) return;

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    logger.error("Không thể xóa Auth user sau lỗi đăng ký", error);
  }
};

// public.handle_new_user() (014 migration) already inserts a pending stores/charity_profiles
// row synchronously as part of the same auth.users insert transaction, so by the time
// admin.createUser() resolves the row should already exist. Poll briefly to be safe against
// any trigger scheduling lag instead of assuming it is instantly visible.
const waitForTriggerRow = async <T>(
  loader: () => Promise<T | null>,
  notFoundMessage: string
): Promise<T> => {
  const attempts = 5;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const row = await loader();
    if (row) return row;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new AppError(notFoundMessage, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
};

const ensureOAuthProfile = async (user: User, oauthProvider: OAuthProvider, requireEmail = true): Promise<Profile> => {
  const config = oauthProviderConfigs[oauthProvider];
  const email = user.email?.trim().toLowerCase() || null;

  if (!email && requireEmail) {
    throw new AppError(config.missingEmailMessage, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  // There is no more self-serve "customer" role to fall back to, so Google/Facebook can only
  // be used as an alternate sign-in method for an account that already registered as
  // partner/charity/admin through the normal register endpoints — it can no longer create one.
  const existing = await loadProfileByIdOrNull(user.id);
  if (!existing) {
    throw new AppError(config.notRegisteredMessage, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  if (email && email !== existing.email) {
    const { data: emailOwner, error: emailOwnerError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .neq("id", user.id)
      .maybeSingle();

    if (emailOwnerError) handleSupabaseError(emailOwnerError, `Failed to check ${oauthProvider} email owner`);
    if (emailOwner) {
      throw new AppError(config.duplicateEmailMessage, HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
    }
  }

  const userMetadata = user.user_metadata as Record<string, unknown>;
  const fullName = metadataText(userMetadata, "full_name", "name");
  const updatePayload = compactObject({
    email: email && email !== existing.email ? email : undefined,
    full_name: !existing.full_name && fullName ? fullName : undefined
  });

  if (Object.keys(updatePayload).length === 0) {
    return existing;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("profiles")
    .update(updatePayload)
    .eq("id", user.id)
    .select("*")
    .single();

  if (updateError) handleSupabaseError(updateError, `Failed to update ${oauthProvider} profile`);
  return updated as Profile;
};

const createOAuthOtpChallenge = async (
  oauthProvider: OAuthProvider,
  userId: string,
  email: string,
  expectedRole: UserRole | undefined,
  meta: RequestMeta
): Promise<{ challengeId: string; expiresAt: string }> => {
  if (oauthProvider !== "google") {
    throw new AppError("Only Google uses OTP challenges", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.GOOGLE_OTP_EXPIRES_SECONDS * 1000).toISOString();

  const { error: cleanupError } = await supabaseAdmin
    .from("auth_google_otp_challenges")
    .delete()
    .lt("expires_at", now.toISOString());

  if (cleanupError) {
    logger.warn("Không thể dọn Google OTP challenge hết hạn", cleanupError);
  }

  const { data, error } = await supabaseAdmin
    .from("auth_google_otp_challenges")
    .insert({
      user_id: userId,
      email,
      expected_role: expectedRole ?? null,
      expires_at: expiresAt,
      metadata: compactObject({
        ip_address: meta.ipAddress,
        user_agent: meta.userAgent
      })
    })
    .select("id")
    .single();

  if (error || !data) handleSupabaseError(error!, "Failed to create Google OTP challenge");

  return {
    challengeId: (data as { id: string }).id,
    expiresAt
  };
};

const loadOAuthOtpChallenge = async (challengeId: string, oauthProvider: OAuthProvider): Promise<OAuthOtpChallenge> => {
  if (oauthProvider !== "google") {
    throw new AppError("Only Google uses OTP challenges", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const config = oauthProviderConfigs[oauthProvider];
  const invalidOtpMessage = config.invalidOtpMessage ?? "Mã OTP Google không hợp lệ hoặc đã hết hạn";
  const { data, error } = await supabaseAdmin
    .from("auth_google_otp_challenges")
    .select("id,user_id,email,expected_role,expires_at,verified_at")
    .eq("id", challengeId)
    .single();

  if (error || !data) {
    throw authError(invalidOtpMessage);
  }

  const challenge = data as OAuthOtpChallenge;
  if (challenge.verified_at || new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw authError(invalidOtpMessage);
  }

  return challenge;
};

const startOAuth = async (
  oauthProvider: OAuthProvider,
  body: GoogleOAuthStartBody | FacebookOAuthStartBody,
  meta: RequestMeta
): Promise<OAuthStartResult> => {
  const config = oauthProviderConfigs[oauthProvider];
  const redirectTo = body.redirect_to ?? (oauthProvider === "facebook" ? env.FACEBOOK_OAUTH_REDIRECT_URL : env.GOOGLE_OAUTH_REDIRECT_URL);

  if (!redirectTo) {
    throw new AppError(`redirect_to is required for ${config.label} OAuth`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const { data, error } = await supabaseAuth.auth.signInWithOAuth({
    provider: oauthProvider,
    options: {
      redirectTo,
      scopes: config.scopes,
      ...(config.queryParams ? { queryParams: config.queryParams } : {})
    }
  });

  if (error || !data.url) {
    throw new AppError(config.oauthStartFailureMessage, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }

  await writeAuditLog(config.audit.started, null, null, meta, {
    provider: oauthProvider,
    redirect_to: redirectTo
  });

  return {
    provider: oauthProvider,
    auth_url: data.url,
    redirect_to: redirectTo
  };
};

const requestOAuthOtp = async (
  oauthProvider: OAuthProvider,
  body: GoogleOtpRequestBody,
  meta: RequestMeta
): Promise<OAuthOtpSentResult> => {
  const config = oauthProviderConfigs[oauthProvider];
  const otpFailedEvent = config.audit.otpFailed;
  const otpSentEvent = config.audit.otpSent;
  const otpSendFailureMessage = config.otpSendFailureMessage;
  if (!otpFailedEvent || !otpSentEvent || !otpSendFailureMessage) {
    throw new AppError(`${config.label} does not support OTP login`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const { data, error } = await supabaseAuth.auth.getUser(body.access_token);

  if (error || !data.user) {
    await writeAuditLog(otpFailedEvent, null, body.expected_role ?? null, meta, { reason: "INVALID_OAUTH_SESSION" });
    throw authError(config.invalidSessionMessage);
  }

  if (!isOAuthAuthUser(data.user, oauthProvider)) {
    await writeAuditLog(otpFailedEvent, data.user.id, body.expected_role ?? null, meta, { reason: "WRONG_OAUTH_PROVIDER" });
    throw new AppError(config.invalidProviderMessage, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  const email = data.user.email?.trim().toLowerCase();
  if (!email) {
    await writeAuditLog(otpFailedEvent, data.user.id, body.expected_role ?? null, meta, {
      reason: "MISSING_PROVIDER_EMAIL",
      provider: oauthProvider
    });
    throw new AppError(config.missingEmailMessage, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const profile = await ensureOAuthProfile(data.user, oauthProvider);

  if (body.expected_role && profile.role !== body.expected_role) {
    await writeAuditLog(otpFailedEvent, data.user.id, profile.role, meta, {
      reason: "ROLE_MISMATCH",
      expected_role: body.expected_role
    });
    throw new AppError("Tài khoản không thuộc đúng cổng đăng nhập", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  if (profile.status === "suspended") {
    await writeAuditLog(otpFailedEvent, data.user.id, profile.role, meta, { reason: "SUSPENDED" });
    throw new AppError("Tài khoản đã bị tạm khóa", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  const challenge = await createOAuthOtpChallenge(oauthProvider, data.user.id, email, body.expected_role, meta);
  const { error: otpError } = await supabaseAuth.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      data: {
        auth_provider: oauthProvider,
        role: profile.role
      }
    }
  });

  if (otpError) {
    await supabaseAdmin.from("auth_google_otp_challenges").delete().eq("id", challenge.challengeId);
    await writeAuditLog(otpFailedEvent, data.user.id, profile.role, meta, {
      reason: "OTP_SEND_FAILED",
      provider: oauthProvider,
      provider_message: otpError.message
    });
    throw new AppError(otpSendFailureMessage, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }

  await writeAuditLog(otpSentEvent, data.user.id, profile.role, meta, {
    provider: oauthProvider,
    email,
    challenge_id: challenge.challengeId,
    expires_at: challenge.expiresAt
  });

  return {
    challenge_id: challenge.challengeId,
    email,
    provider: oauthProvider,
    expires_at: challenge.expiresAt,
    expires_in_seconds: env.GOOGLE_OTP_EXPIRES_SECONDS,
    otp_sent: true
  };
};

const verifyOAuthOtp = async (
  oauthProvider: OAuthProvider,
  body: GoogleOtpVerifyBody,
  meta: RequestMeta
): Promise<AuthResult> => {
  const config = oauthProviderConfigs[oauthProvider];
  const otpFailedEvent = config.audit.otpFailed;
  const otpVerifiedEvent = config.audit.otpVerified;
  const invalidOtpMessage = config.invalidOtpMessage;
  if (!otpFailedEvent || !otpVerifiedEvent || !invalidOtpMessage) {
    throw new AppError(`${config.label} does not support OTP verification`, HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
  }

  const challenge = await loadOAuthOtpChallenge(body.challenge_id, oauthProvider);
  const email = challenge.email.trim().toLowerCase();

  if (challenge.expected_role && body.expected_role && challenge.expected_role !== body.expected_role) {
    await writeAuditLog(otpFailedEvent, challenge.user_id, challenge.expected_role, meta, {
      reason: "EXPECTED_ROLE_CHANGED",
      challenge_id: challenge.id
    });
    throw new AppError("Tài khoản không thuộc đúng cổng đăng nhập", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  const { data, error } = await supabaseAuth.auth.verifyOtp({
    email,
    token: body.otp,
    type: "email"
  });

  if (error || !data.user || !data.session) {
    await writeAuditLog(otpFailedEvent, challenge.user_id, challenge.expected_role ?? body.expected_role ?? null, meta, {
      reason: "OTP_VERIFY_FAILED",
      challenge_id: challenge.id
    });
    throw authError(invalidOtpMessage);
  }

  if (data.user.id !== challenge.user_id) {
    await writeAuditLog(otpFailedEvent, data.user.id, challenge.expected_role ?? body.expected_role ?? null, meta, {
      reason: "USER_MISMATCH",
      challenge_id: challenge.id
    });
    throw authError(invalidOtpMessage);
  }

  const profile = await ensureOAuthProfile(data.user, oauthProvider);
  const expectedRole = body.expected_role ?? challenge.expected_role ?? undefined;

  if (expectedRole && profile.role !== expectedRole) {
    await writeAuditLog(otpFailedEvent, data.user.id, profile.role, meta, {
      reason: "ROLE_MISMATCH",
      challenge_id: challenge.id,
      expected_role: expectedRole
    });
    throw new AppError("Tài khoản không thuộc đúng cổng đăng nhập", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  if (profile.status === "suspended") {
    await writeAuditLog(otpFailedEvent, data.user.id, profile.role, meta, {
      reason: "SUSPENDED",
      challenge_id: challenge.id
    });
    throw new AppError("Tài khoản đã bị tạm khóa", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  const verifiedAt = new Date().toISOString();
  const { error: challengeError } = await supabaseAdmin
    .from("auth_google_otp_challenges")
    .update({
      verified_at: verifiedAt,
      consumed_at: verifiedAt
    })
    .eq("id", challenge.id);

  if (challengeError) handleSupabaseError(challengeError, `Failed to verify ${oauthProvider} OTP challenge`);

  await writeAuditLog(otpVerifiedEvent, data.user.id, profile.role, meta, {
    provider: oauthProvider,
    challenge_id: challenge.id,
    expected_role: expectedRole ?? null
  });
  await writeAuditLog("LOGIN_SUCCESS", data.user.id, profile.role, meta, {
    provider: oauthProvider,
    expected_role: expectedRole ?? null
  });

  return buildAuthResult(data.user, data.session);
};

const buildAuthResultFromOAuthCallback = async (user: User, body: FacebookOAuthCallbackBody): Promise<AuthResult> => {
  const profile = await loadProfile(user.id);
  const context = await loadContext(user.id, profile.role);

  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      phone: user.phone ?? "",
      created_at: user.created_at ?? ""
    },
    profile,
    session: {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: body.expires_at ?? null,
      token_type: body.token_type
    },
    context
  };
};

const completeFacebookOAuthCallback = async (body: FacebookOAuthCallbackBody, meta: RequestMeta): Promise<AuthResult> => {
  const config = oauthProviderConfigs.facebook;
  const { data, error } = await supabaseAuth.auth.getUser(body.access_token);

  if (error || !data.user) {
    await writeAuditLog("FACEBOOK_OAUTH_FAILED", null, body.expected_role ?? null, meta, { reason: "INVALID_FACEBOOK_SESSION" });
    throw authError(config.invalidSessionMessage);
  }

  if (!isOAuthAuthUser(data.user, "facebook")) {
    await writeAuditLog("FACEBOOK_OAUTH_FAILED", data.user.id, body.expected_role ?? null, meta, { reason: "NOT_FACEBOOK_PROVIDER" });
    throw new AppError(config.invalidProviderMessage, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  const profile = await ensureOAuthProfile(data.user, "facebook", false);

  if (body.expected_role && profile.role !== body.expected_role) {
    await writeAuditLog("FACEBOOK_OAUTH_FAILED", data.user.id, profile.role, meta, {
      reason: "ROLE_MISMATCH",
      expected_role: body.expected_role
    });
    throw new AppError("Tài khoản không thuộc đúng cổng đăng nhập", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  if (profile.status === "suspended") {
    await writeAuditLog("FACEBOOK_OAUTH_FAILED", data.user.id, profile.role, meta, { reason: "SUSPENDED" });
    throw new AppError("Tài khoản đã bị tạm khóa", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }

  await writeAuditLog("FACEBOOK_OAUTH_COMPLETED", data.user.id, profile.role, meta, {
    provider: "facebook",
    email: data.user.email ?? null,
    expected_role: body.expected_role ?? null
  });
  await writeAuditLog("LOGIN_SUCCESS", data.user.id, profile.role, meta, {
    provider: "facebook",
    expected_role: body.expected_role ?? null
  });

  return buildAuthResultFromOAuthCallback(data.user, body);
};

const requestPhoneOtp = async (body: PhoneOtpRequestBody, meta: RequestMeta): Promise<PhoneOtpSentResult> => {
  const profile = await loadProfileByPhone(body.phone);
  const smsPhone = normalizePhoneForSms(profile.phone ?? body.phone);

  await assertProfileCanLoginWithPhoneOtp(profile, body.expected_role, meta, {
    phone: smsPhone,
    phase: "REQUEST"
  });
  await syncAuthUserPhoneForOtp(profile, smsPhone);

  const { error } = await supabaseAuth.auth.signInWithOtp({
    phone: smsPhone,
    options: {
      shouldCreateUser: false,
      data: {
        auth_provider: "phone_otp",
        role: profile.role
      }
    }
  });

  if (error) {
    await writeAuditLog("PHONE_OTP_FAILED", profile.id, profile.role, meta, {
      phone: smsPhone,
      reason: "OTP_SEND_FAILED",
      provider_message: error.message
    });
    throw new AppError("Không thể gửi OTP về số điện thoại này", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }

  await writeAuditLog("PHONE_OTP_SENT", profile.id, profile.role, meta, {
    phone: smsPhone,
    expected_role: body.expected_role ?? null
  });

  return {
    phone: smsPhone,
    channel: "sms",
    expires_in_seconds: env.PHONE_OTP_EXPIRES_SECONDS,
    otp_sent: true
  };
};

const verifyPhoneOtp = async (body: PhoneOtpVerifyBody, meta: RequestMeta): Promise<AuthResult> => {
  const profile = await loadProfileByPhone(body.phone);
  const smsPhone = normalizePhoneForSms(profile.phone ?? body.phone);

  await assertProfileCanLoginWithPhoneOtp(profile, body.expected_role, meta, {
    phone: smsPhone,
    phase: "VERIFY"
  });

  const { data, error } = await supabaseAuth.auth.verifyOtp({
    phone: smsPhone,
    token: body.otp,
    type: "sms"
  });

  if (error || !data.user || !data.session) {
    await writeAuditLog("PHONE_OTP_FAILED", profile.id, profile.role, meta, {
      phone: smsPhone,
      reason: "OTP_VERIFY_FAILED",
      provider_message: error?.message ?? null
    });
    throw authError("Mã OTP SMS không hợp lệ hoặc đã hết hạn");
  }

  if (data.user.id !== profile.id) {
    await writeAuditLog("PHONE_OTP_FAILED", data.user.id, profile.role, meta, {
      phone: smsPhone,
      reason: "USER_MISMATCH",
      expected_user_id: profile.id
    });
    throw authError("Mã OTP SMS không hợp lệ hoặc đã hết hạn");
  }

  await writeAuditLog("PHONE_OTP_VERIFIED", data.user.id, profile.role, meta, {
    phone: smsPhone,
    expected_role: body.expected_role ?? null
  });
  await writeAuditLog("LOGIN_SUCCESS", data.user.id, profile.role, meta, {
    provider: "phone_otp",
    expected_role: body.expected_role ?? null
  });

  return buildAuthResult(data.user, data.session);
};

export const authService = {
  async registerPartner(body: RegisterPartnerBody, meta: RequestMeta): Promise<AuthResult> {
    let createdUserId: string | null = null;
    const phone = normalizePhone(body.phone);
    const adminPhone = normalizePhone(body.admin_phone ?? body.phone);
    const publicHotline = body.public_hotline ? normalizePhone(body.public_hotline) : adminPhone;
    const publicEmail = body.admin_email ?? body.email;

    try {
      // Trigger metadata: read by public.handle_new_user() to auto-create a pending
      // public.stores row in the same transaction as the auth user insert.
      const user = await createAuthUser("partner", body.email, body.password, body.representative_name, phone, {
        store_name: body.store_name,
        org_name: body.store_name,
        legal_name: body.legal_name,
        tax_code: body.tax_code,
        business_license_number: body.business_license_number,
        business_type: body.business_type,
        cccd_number: body.cccd_number,
        public_email: publicEmail,
        public_hotline: publicHotline,
        street: body.street,
        ward: body.ward,
        city: body.city
      });
      createdUserId = user.id;

      await upsertProfile(user.id, "partner", body.email, body.representative_name, phone, "pending");

      const store = await waitForTriggerRow(async () => {
        const { data, error } = await supabaseAdmin
          .from("stores")
          .select("id")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (error) handleSupabaseError(error, "Failed to load auto-created store");
        return (data as { id: string } | null) ?? null;
      }, "Không tìm thấy hồ sơ cửa hàng được tạo tự động");

      const { error: storeUpdateError } = await supabaseAdmin
        .from("stores")
        .update(compactObject({
          name: body.store_name,
          legal_name: body.legal_name ?? null,
          tax_code: body.tax_code ?? null,
          business_license_number: body.business_license_number ?? null,
          business_type: body.business_type,
          cccd_number: body.cccd_number ?? null,
          description: body.description ?? null,
          hashtags: body.hashtags ?? [],
          public_email: publicEmail,
          public_hotline: publicHotline,
          street: body.street,
          ward: body.ward ?? null,
          city: body.city,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          avatar_url: body.avatar_url ?? null,
          cover_url: body.cover_url ?? null,
          cccd_front_url: body.cccd_front_url ?? null,
          cccd_back_url: body.cccd_back_url ?? null,
          business_license_url: body.business_license_url ?? null,
          food_safety_certificate_url: body.food_safety_certificate_url ?? null,
          opening_hours: partnerOpeningHoursText(body.opening_schedule)
        }))
        .eq("id", store.id);

      if (storeUpdateError) handleSupabaseError(storeUpdateError, "Failed to update partner store");

      const { error: reputationError } = await supabaseAdmin.from("seller_reputation").insert({
        seller_id: store.id
      });

      if (reputationError) handleSupabaseError(reputationError, "Failed to create seller reputation");

      await writeAuditLog("REGISTER_SUCCESS", user.id, "partner", meta, { channel: "partner", store_id: store.id });

      return authService.login({
        identifier: body.email,
        password: body.password,
        expected_role: "partner"
      }, meta);
    } catch (error) {
      await deleteCreatedUser(createdUserId);
      throw error;
    }
  },

  async registerCharity(body: RegisterCharityBody, meta: RequestMeta): Promise<AuthResult> {
    let createdUserId: string | null = null;
    const phone = normalizePhone(body.phone);

    try {
      // Trigger metadata: read by public.handle_new_user() to auto-create a pending
      // public.charity_profiles row in the same transaction as the auth user insert.
      const user = await createAuthUser("charity", body.email, body.password, body.representative_name, phone, {
        charity_name: body.organization_name,
        org_name: body.organization_name,
        legal_name: body.legal_name,
        public_email: body.email,
        public_hotline: phone,
        street: body.street,
        ward: body.ward,
        city: body.city
      });
      createdUserId = user.id;

      await upsertProfile(user.id, "charity", body.email, body.representative_name, phone, "pending");

      const charity = await waitForTriggerRow(async () => {
        const { data, error } = await supabaseAdmin
          .from("charity_profiles")
          .select("id")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (error) handleSupabaseError(error, "Failed to load auto-created charity profile");
        return (data as { id: string } | null) ?? null;
      }, "Không tìm thấy hồ sơ tổ chức từ thiện được tạo tự động");

      const { error: charityUpdateError } = await supabaseAdmin
        .from("charity_profiles")
        .update(compactObject({
          name: body.organization_name,
          legal_name: body.legal_name ?? null,
          representative_title: body.representative_title ?? null,
          public_email: body.email,
          public_hotline: phone,
          street: body.street,
          ward: body.ward ?? null,
          city: body.city,
          beneficiaries_count: body.beneficiaries_count
        }))
        .eq("id", charity.id);

      if (charityUpdateError) handleSupabaseError(charityUpdateError, "Failed to update charity profile");

      await writeAuditLog("REGISTER_SUCCESS", user.id, "charity", meta, { channel: "charity", charity_id: charity.id });

      return authService.login({
        identifier: body.email,
        password: body.password,
        expected_role: "charity"
      }, meta);
    } catch (error) {
      await deleteCreatedUser(createdUserId);
      throw error;
    }
  },

  async startGoogleOAuth(body: GoogleOAuthStartBody, meta: RequestMeta): Promise<GoogleOAuthStartResult> {
    return startOAuth("google", body, meta) as Promise<GoogleOAuthStartResult>;
  },

  async requestGoogleOtp(body: GoogleOtpRequestBody, meta: RequestMeta): Promise<GoogleOtpSentResult> {
    return requestOAuthOtp("google", body, meta) as Promise<GoogleOtpSentResult>;
  },

  async verifyGoogleOtp(body: GoogleOtpVerifyBody, meta: RequestMeta): Promise<AuthResult> {
    return verifyOAuthOtp("google", body, meta);
  },

  async startFacebookOAuth(body: FacebookOAuthStartBody, meta: RequestMeta): Promise<FacebookOAuthStartResult> {
    return startOAuth("facebook", body, meta) as Promise<FacebookOAuthStartResult>;
  },

  async completeFacebookOAuth(body: FacebookOAuthCallbackBody, meta: RequestMeta): Promise<AuthResult> {
    return completeFacebookOAuthCallback(body, meta);
  },

  async requestPhoneOtp(body: PhoneOtpRequestBody, meta: RequestMeta): Promise<PhoneOtpSentResult> {
    return requestPhoneOtp(body, meta);
  },

  async verifyPhoneOtp(body: PhoneOtpVerifyBody, meta: RequestMeta): Promise<AuthResult> {
    return verifyPhoneOtp(body, meta);
  },

  async login(body: LoginBody, meta: RequestMeta): Promise<AuthResult> {
    let resolvedEmail = "";
    let failureAudited = false;

    try {
      resolvedEmail = await resolveEmailFromIdentifier(body.identifier);
      const { user, session } = await signInWithEmailPassword(resolvedEmail, body.password);
      const profile = await loadProfile(user.id);

      if (body.expected_role && profile.role !== body.expected_role) {
        await writeAuditLog("LOGIN_FAILED", user.id, profile.role, meta, {
          reason: "ROLE_MISMATCH",
          expected_role: body.expected_role
        });
        failureAudited = true;
        throw new AppError("Tài khoản không thuộc đúng cổng đăng nhập", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
      }

      if (profile.status === "suspended") {
        await writeAuditLog("LOGIN_FAILED", user.id, profile.role, meta, { reason: "SUSPENDED" });
        failureAudited = true;
        throw new AppError("Tài khoản đã bị tạm khóa", HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
      }

      await writeAuditLog("LOGIN_SUCCESS", user.id, profile.role, meta, { expected_role: body.expected_role ?? null });

      return buildAuthResult(user, session);
    } catch (error) {
      if (!failureAudited) {
        await writeAuditLog("LOGIN_FAILED", null, body.expected_role ?? null, meta, {
          identifier: resolvedEmail || body.identifier,
          reason: error instanceof AppError ? error.code : "AUTH_PROVIDER_ERROR"
        });
      }

      throw error;
    }
  },

  async refreshSession(body: { refresh_token: string }, meta: RequestMeta): Promise<AuthResult> {
    const { data, error } = await supabaseAuth.auth.refreshSession({
      refresh_token: body.refresh_token
    });

    if (error || !data.user || !data.session) {
      throw authError("Refresh token không hợp lệ hoặc đã hết hạn");
    }

    const profile = await loadProfile(data.user.id);
    await writeAuditLog("TOKEN_REFRESH", data.user.id, profile.role, meta);

    return buildAuthResult(data.user, data.session);
  },

  async requestPasswordReset(body: PasswordResetBody, meta: RequestMeta): Promise<{ sent: true }> {
    let email = "";

    try {
      email = await resolveEmailFromIdentifier(body.identifier);
    } catch (error) {
      await writeAuditLog("PASSWORD_RESET_REQUESTED", null, null, meta, {
        identifier: body.identifier,
        result: "ACCOUNT_NOT_DISCLOSED"
      });
      return { sent: true };
    }

    const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
      redirectTo: env.PASSWORD_RESET_REDIRECT_URL
    });

    if (error) {
      throw new AppError("Không thể gửi email đặt lại mật khẩu", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }

    await writeAuditLog("PASSWORD_RESET_REQUESTED", null, null, meta, { email });
    return { sent: true };
  },

  async logout(accessToken: string, userId: string, role: UserRole, meta: RequestMeta): Promise<{ revoked: true }> {
    const { error } = await supabaseAdmin.auth.admin.signOut(accessToken, "local");

    if (error) {
      throw new AppError("Không thể đăng xuất phiên hiện tại", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }

    await writeAuditLog("LOGOUT", userId, role, meta);
    return { revoked: true };
  }
};
