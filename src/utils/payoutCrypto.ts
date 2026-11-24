/**
 * Mã hóa số tài khoản nhận tiền: AES-256-GCM.
 * - Hỗ trợ xoay vòng đa khóa qua PAYOUT_ENCRYPTION_KEYS (ví dụ: "v2:<64hex>,v1:<64hex>"):
 *   mã hóa mới bằng khóa đầu tiên kèm tiền tố `<ver>:`, giải mã tự dò khóa theo tiền tố `<ver>:`.
 * - Tương thích ngược 100%: khi chưa đặt PAYOUT_ENCRYPTION_KEYS, dùng PAYOUT_ENCRYPTION_KEY với nhãn `v1:`.
 * - Định dạng lưu: <ver>:<iv base64>:<authTag base64>:<ciphertext base64>.
 * - Đóng cửa an toàn: thiếu hoặc sai khóa thì từ chối mã hóa và giải mã (ném lỗi), không bao giờ lưu rõ.
 */
import crypto from "crypto";
import { env } from "../config/env";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import { AppError } from "./appError";

const VERSION_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

interface PayoutKeyRing {
  primaryVersion: string;
  primaryKey: Buffer;
  keys: Map<string, Buffer>;
}

const parseRawKey = (raw: string, label: string): Buffer => {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new AppError(
      `${label} phải là 32 byte (base64 hoặc 64 ký tự hex)`,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.PROVIDER_NOT_CONFIGURED
    );
  }
  return key;
};

const isKeyRingSpec = (raw: string): boolean => {
  const firstSegment = raw.split(",")[0]?.trim() ?? "";
  const colonIndex = firstSegment.indexOf(":");
  if (colonIndex <= 0) return false;
  const prefix = firstSegment.slice(0, colonIndex).trim();
  return VERSION_PATTERN.test(prefix);
};

const parseKeyRingSpec = (spec: string): PayoutKeyRing => {
  const entries = spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    throw new AppError(
      "PAYOUT_ENCRYPTION_KEYS không hợp lệ (định dạng: v2:<khóa 32 byte>,v1:<khóa 32 byte>)",
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.PROVIDER_NOT_CONFIGURED
    );
  }

  const keys = new Map<string, Buffer>();
  let primaryVersion = "";
  let primaryKey: Buffer | null = null;

  for (const entry of entries) {
    const colonIndex = entry.indexOf(":");
    if (colonIndex <= 0) {
      throw new AppError(
        "PAYOUT_ENCRYPTION_KEYS không hợp lệ (thiếu tiền tố phiên bản dạng v2:<khóa>)",
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        ERROR_CODES.PROVIDER_NOT_CONFIGURED
      );
    }

    const version = entry.slice(0, colonIndex).trim();
    const keyMaterial = entry.slice(colonIndex + 1).trim();
    if (!VERSION_PATTERN.test(version) || !keyMaterial) {
      throw new AppError(
        "PAYOUT_ENCRYPTION_KEYS không hợp lệ (tên phiên bản hoặc giá trị khóa sai định dạng)",
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        ERROR_CODES.PROVIDER_NOT_CONFIGURED
      );
    }
    if (keys.has(version)) {
      throw new AppError(
        `PAYOUT_ENCRYPTION_KEYS bị trùng phiên bản khóa: ${version}`,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        ERROR_CODES.PROVIDER_NOT_CONFIGURED
      );
    }

    const parsedKey = parseRawKey(keyMaterial, `PAYOUT_ENCRYPTION_KEYS[${version}]`);
    keys.set(version, parsedKey);
    if (!primaryKey) {
      primaryVersion = version;
      primaryKey = parsedKey;
    }
  }

  if (!primaryKey) {
    throw new AppError(
      "Chưa cấu hình PAYOUT_ENCRYPTION_KEY hoặc PAYOUT_ENCRYPTION_KEYS",
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.PROVIDER_NOT_CONFIGURED
    );
  }

  return { primaryVersion, primaryKey, keys };
};

const loadKeyRing = (override?: string): PayoutKeyRing => {
  if (override !== undefined) {
    const trimmedOverride = override.trim();
    if (!trimmedOverride) {
      throw new AppError(
        "Chưa cấu hình PAYOUT_ENCRYPTION_KEY nên chưa thể lưu hoặc đọc số tài khoản nhận tiền",
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        ERROR_CODES.PROVIDER_NOT_CONFIGURED
      );
    }
    if (isKeyRingSpec(trimmedOverride)) {
      return parseKeyRingSpec(trimmedOverride);
    }
    const singleKey = parseRawKey(trimmedOverride, "PAYOUT_ENCRYPTION_KEY");
    return {
      primaryVersion: "v1",
      primaryKey: singleKey,
      keys: new Map<string, Buffer>([["v1", singleKey]])
    };
  }

  const keysSpec = (env.PAYOUT_ENCRYPTION_KEYS ?? "").trim();
  const legacyRaw = (env.PAYOUT_ENCRYPTION_KEY ?? "").trim();

  if (keysSpec) {
    const ring = parseKeyRingSpec(keysSpec);
    // Nếu đang xoay vòng mà chỉ đưa khóa mới vào PAYOUT_ENCRYPTION_KEYS và giữ nguyên PAYOUT_ENCRYPTION_KEY cũ,
    // tự động bổ sung khóa v1 để vẫn giải mã được bản ghi cũ không gián đoạn.
    if (!ring.keys.has("v1") && legacyRaw) {
      ring.keys.set("v1", parseRawKey(legacyRaw, "PAYOUT_ENCRYPTION_KEY"));
    }
    return ring;
  }

  if (!legacyRaw) {
    throw new AppError(
      "Chưa cấu hình PAYOUT_ENCRYPTION_KEY nên chưa thể lưu hoặc đọc số tài khoản nhận tiền",
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.PROVIDER_NOT_CONFIGURED
    );
  }

  const legacyKey = parseRawKey(legacyRaw, "PAYOUT_ENCRYPTION_KEY");
  return {
    primaryVersion: "v1",
    primaryKey: legacyKey,
    keys: new Map<string, Buffer>([["v1", legacyKey]])
  };
};

export const isPayoutKeyConfigured = (): boolean => {
  try {
    loadKeyRing();
    return true;
  } catch {
    return false;
  }
};

export const encryptAccountNumber = (plain: string, keyOverride?: string): string => {
  const { primaryVersion, primaryKey } = loadKeyRing(keyOverride);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", primaryKey, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${primaryVersion}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
};

export const decryptAccountNumber = (stored: string, keyOverride?: string): string => {
  const parts = stored.split(":");
  if (parts.length !== 4) {
    throw new AppError("Dữ liệu số tài khoản không đúng định dạng", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
  const [version, iv, tag, data] = parts;
  if (!version || !VERSION_PATTERN.test(version) || !iv || !tag || !data) {
    throw new AppError("Dữ liệu số tài khoản không đúng định dạng", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }

  const ring = loadKeyRing(keyOverride);
  const directOverrideSingleKey = keyOverride !== undefined && !isKeyRingSpec(keyOverride.trim());
  const key = ring.keys.get(version) ?? (directOverrideSingleKey ? ring.primaryKey : undefined);
  if (!key) {
    throw new AppError(
      "Không giải mã được số tài khoản (không tìm thấy khóa phù hợp với phiên bản dữ liệu)",
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      ERROR_CODES.INTERNAL_SERVER_ERROR
    );
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  try {
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("Không giải mã được số tài khoản (sai khóa hoặc dữ liệu bị sửa)", HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_SERVER_ERROR);
  }
};

/** Chỉ giữ chữ số; không đủ 6-30 chữ số thì trả null */
export const normalizeAccountNumber = (value: string): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 30 ? digits : null;
};

export const last4Of = (digits: string): string => digits.slice(-4);

/** Che số tài khoản để hiển thị/lưu ở chỗ khác: chỉ còn 4 số cuối */
export const maskAccountNumber = (digits: string): string => `${"•".repeat(Math.max(0, digits.length - 4))}${last4Of(digits)}`;
