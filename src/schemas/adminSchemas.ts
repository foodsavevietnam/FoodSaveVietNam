import { z } from "zod";
import { paginationQuerySchema, sanitizeSearch } from "./commonSchemas";

export { sanitizeSearch };

/** Schema query chuẩn cho mọi danh sách của cổng quản trị: page, limit (≤ 100), q, status, sort + trường riêng. */
export const adminListQuerySchema = <S extends readonly [string, ...string[]]>(opts: {
  sortKeys: S;
  statusEnum?: z.ZodEnum<any>;
  extra?: z.ZodRawShape;
}) => paginationQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  ...(opts.statusEnum ? { status: opts.statusEnum.optional() } : {}),
  sort: z.enum(opts.sortKeys).optional(),
  ...opts.extra
}).strict();
