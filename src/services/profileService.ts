import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { UpdateProfileBody } from "../schemas/profileSchemas";
import type { Profile } from "../types/domain";
import { AppError } from "../utils/appError";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export const normalizeVietnamesePhone = (value: string): string => {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.startsWith("84") && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }
  if (trimmed.startsWith("+") && !digits.startsWith("84")) {
    return `+${digits}`;
  }
  return digits;
};

export const buildPhoneVariants = (value: string): string[] => {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  const normalized = normalizeVietnamesePhone(trimmed);
  const candidates = new Set<string>([trimmed, digits, normalized]);

  if (digits.startsWith("84") && digits.length >= 11) {
    candidates.add(`+${digits}`);
    candidates.add(`0${digits.slice(2)}`);
  } else if (digits.startsWith("0") && digits.length >= 10) {
    candidates.add(`84${digits.slice(1)}`);
    candidates.add(`+84${digits.slice(1)}`);
  } else if (!trimmed.startsWith("+") && digits.length >= 9) {
    candidates.add(`0${digits}`);
    candidates.add(`84${digits}`);
    candidates.add(`+84${digits}`);
  }

  return Array.from(candidates).filter(Boolean);
};

export const profileService = {
  async getProfile(userId: string): Promise<Profile> {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (error) handleSupabaseError(error, "Failed to load profile");
    return data as Profile;
  },

  async updateProfile(userId: string, body: UpdateProfileBody): Promise<Profile> {
    const payload: UpdateProfileBody = { ...body };

    if (body.phone !== undefined) {
      const normalizedPhone = normalizeVietnamesePhone(body.phone);
      const digitCount = normalizedPhone.replace(/\D/g, "").length;
      if (digitCount < 9 || digitCount > 15) {
        throw new AppError("Số điện thoại không hợp lệ", HTTP_STATUS.BAD_REQUEST, ERROR_CODES.VALIDATION_ERROR);
      }

      const candidates = buildPhoneVariants(body.phone);
      const { data: existing, error: lookupError } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .in("phone", candidates)
        .neq("id", userId)
        .limit(1);

      if (lookupError) handleSupabaseError(lookupError, "Failed to verify phone uniqueness");
      if ((existing ?? []).length > 0) {
        throw new AppError("Số điện thoại này đã được sử dụng bởi tài khoản khác", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
      }

      payload.phone = normalizedPhone;
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update(payload)
      .eq("id", userId)
      .select("*")
      .single();

    if (error) handleSupabaseError(error, "Failed to update profile");
    return data as Profile;
  }
};
