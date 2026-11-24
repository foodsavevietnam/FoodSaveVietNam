import { randomInt } from "crypto";
import type { PostgrestError } from "@supabase/supabase-js";
import { supabaseAdmin, supabaseAuth } from "../config/supabase";
import { ERROR_CODES } from "../constants/errors";
import { HTTP_STATUS } from "../constants/http";
import type { UserRole } from "../types/domain";
import { AppError } from "../utils/appError";

export { supabaseAdmin, supabaseAuth };

export interface PaginationInput {
  page: number;
  limit: number;
}

export const getRange = ({ page, limit }: PaginationInput): { from: number; to: number } => {
  const from = (page - 1) * limit;
  return {
    from,
    to: from + limit - 1
  };
};

export const toPagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  has_next_page: page * limit < total
});

export const handleSupabaseError = (error: PostgrestError, fallbackMessage = "Database operation failed"): never => {
  if (error.code === "PGRST116") {
    throw new AppError("Resource was not found", HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  if (error.code === "23505") {
    throw new AppError("Resource already exists", HTTP_STATUS.CONFLICT, ERROR_CODES.RESOURCE_CONFLICT);
  }

  throw new AppError(fallbackMessage, HTTP_STATUS.INTERNAL_SERVER_ERROR, ERROR_CODES.SUPABASE_ERROR, {
    code: error.code,
    hint: error.hint,
    details: error.details
  });
};

export const requireRecord = <T>(value: T | null | undefined, message = "Resource was not found"): T => {
  if (!value) {
    throw new AppError(message, HTTP_STATUS.NOT_FOUND, ERROR_CODES.RESOURCE_NOT_FOUND);
  }

  return value;
};

export const assertOwnerOrAdmin = (ownerId: string, actorId: string, actorRole: UserRole, message = "You do not have permission to access this resource"): void => {
  if (actorRole !== "admin" && ownerId !== actorId) {
    throw new AppError(message, HTTP_STATUS.FORBIDDEN, ERROR_CODES.AUTH_FORBIDDEN);
  }
};

const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const generateCode = (prefix: string, randomLength = 5): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  let random = "";
  for (let i = 0; i < randomLength; i += 1) {
    random += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return `${prefix}-${timestamp}-${random}`;
};
