import { createHmac, timingSafeEqual } from "crypto";
import { env } from "../config/env";

// Tình nguyện viên không có phiên Supabase riêng nên dùng token tự ký (HMAC) có hạn dùng.
// Claim `amr` cho biết cách đăng nhập: "otp" (đã xác minh email) hoặc "demo" (chỉ số điện thoại, bản demo).
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const SELECTION_TTL_SECONDS = 5 * 60;

export type VolunteerAmr = "otp" | "demo";

export interface VolunteerTokenPayload {
  vid: string;
  cid: string;
  exp: number;
  amr: VolunteerAmr;
}

interface SelectionTokenPayload {
  em: string;
  exp: number;
}

// Cùng secret nhưng khác tiền tố: token chọn tổ chức không dùng được làm token TNV và ngược lại.
// Nếu VOLUNTEER_TOKEN_SECRET được cấu hình thì ký bằng khóa riêng; khi verify vẫn fallback sang khóa cũ
// (SUPABASE_SERVICE_ROLE_KEY) để chuyển tiếp 12 giờ không đá văng TNV đang làm nhiệm vụ.
const legacySecret = (): string => `foodsave-volunteer:${env.SUPABASE_SERVICE_ROLE_KEY}`;
const legacySelectionSecret = (): string => `foodsave-volunteer-select:${env.SUPABASE_SERVICE_ROLE_KEY}`;

const secret = (): string =>
  env.VOLUNTEER_TOKEN_SECRET ? `foodsave-volunteer:${env.VOLUNTEER_TOKEN_SECRET}` : legacySecret();

const selectionSecret = (): string =>
  env.VOLUNTEER_TOKEN_SECRET ? `foodsave-volunteer-select:${env.VOLUNTEER_TOKEN_SECRET}` : legacySelectionSecret();

const decodeWithFallback = (token: string, primaryKey: string, fallbackKey: string): Record<string, unknown> | null => {
  const primary = decode(token, primaryKey);
  if (primary) return primary;
  if (fallbackKey !== primaryKey) {
    return decode(token, fallbackKey);
  }
  return null;
};

const sign = (body: string, key: string): string => createHmac("sha256", key).update(body).digest("base64url");
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const encode = (payload: object, key: string): string => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
};

// So sánh chữ ký thời gian hằng rồi mới giải mã nội dung
const decode = (token: string, key: string): Record<string, unknown> | null => {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(body, key));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
    return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const createVolunteerToken = (volunteerId: string, charityId: string, amr: VolunteerAmr = "demo"): string =>
  encode({ vid: volunteerId, cid: charityId, exp: nowSeconds() + TOKEN_TTL_SECONDS, amr } satisfies VolunteerTokenPayload, secret());

export const verifyVolunteerToken = (token: string): VolunteerTokenPayload | null => {
  const payload = decodeWithFallback(token, secret(), legacySecret());
  if (!payload) return null;
  const { vid, cid, exp } = payload;
  if (typeof vid !== "string" || !vid || typeof cid !== "string" || !cid || typeof exp !== "number" || exp < nowSeconds()) return null;
  // Token cũ không có amr (hoặc giá trị lạ) coi như "demo"
  return { vid, cid, exp, amr: payload.amr === "otp" ? "otp" : "demo" };
};

export { isVolunteerTokenUsable } from "./volunteerTokenPolicy";

// Token ngắn hạn (5 phút) sau khi xác minh OTP, dùng để chọn tổ chức khi một email thuộc nhiều TNV
export const createSelectionToken = (email: string): string =>
  encode({ em: normalizeEmail(email), exp: nowSeconds() + SELECTION_TTL_SECONDS } satisfies SelectionTokenPayload, selectionSecret());

export const verifySelectionToken = (token: string): { email: string } | null => {
  const payload = decodeWithFallback(token, selectionSecret(), legacySelectionSecret());
  if (!payload || typeof payload.em !== "string" || !payload.em || typeof payload.exp !== "number" || payload.exp < nowSeconds()) return null;
  return { email: payload.em };
};
