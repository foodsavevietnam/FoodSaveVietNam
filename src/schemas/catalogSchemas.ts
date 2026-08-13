import { z } from "zod";

// NOTE: productListQuerySchema/voucherListQuerySchema and the create/update product and
// voucher schemas were removed along with public.products/public.vouchers in the 014
// migration (no more customer-facing marketplace). Only the store catalog remains.

export const storeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(120).optional(),
  ward: z.string().trim().min(1).max(80).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().positive().max(50).default(5),
  verified: z.coerce.boolean().optional(),
  open: z.coerce.boolean().optional()
}).strict();

export const createStoreBodySchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(180),
  avatar_url: z.string().url().nullable().optional(),
  cover_url: z.string().url().nullable().optional(),
  street: z.string().trim().min(4).max(240),
  ward: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().min(2).max(80),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  opening_hours: z.string().trim().max(120).nullable().optional()
}).strict();

export const updateStoreBodySchema = createStoreBodySchema.partial().extend({
  is_open: z.boolean().optional(),
  status: z.enum(["active", "pending", "suspended", "rejected"]).optional()
}).strict();

export type StoreListQuery = z.infer<typeof storeListQuerySchema>;
export type CreateStoreBody = z.infer<typeof createStoreBodySchema>;
export type UpdateStoreBody = z.infer<typeof updateStoreBodySchema>;
