import { z } from "zod";

// URL query values are strings: Boolean("false") is true, so use an explicit
// parser instead of z.coerce.boolean() for request filters.
export const queryBooleanSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return value;
}, z.boolean());

export const uuidParamSchema = z.object({
  id: z.string().uuid()
}).strict();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).strict();

export const optionalPaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional()
}).strict();

export const nonEmptyString = z.string().trim().min(1);
export const optionalTrimmedString = z.string().trim().optional();
