/**
 * Tiện ích dùng chung cho các danh sách của cổng quản trị: phân trang { items, total, page, limit },
 * tìm kiếm không phân biệt hoa thường và nạp theo danh sách id.
 */
import { sanitizeSearch } from "../schemas/adminSchemas";
import { handleSupabaseError, supabaseAdmin } from "./supabaseService";

export { maskPhone } from "./partnerOpsService";

type Row = Record<string, any>;

export interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** `query` phải đã `select(cols, { count: "exact" })`; `total` là số dòng khớp trước khi phân trang. */
export async function paginate<T = Row>(query: any, { page, limit }: { page: number; limit: number }): Promise<ListResult<T>> {
  const { data, error, count } = await query.range((page - 1) * limit, page * limit - 1);
  if (error) handleSupabaseError(error, "Failed to load list");
  return { items: (data ?? []) as T[], total: count ?? 0, page, limit };
}

/** Thêm điều kiện ilike trên nhiều cột (OR). `q` rỗng hoặc chỉ còn ký tự bị lọc thì không lọc. */
export function applySearch<Q extends { or: (expr: string) => Q }>(query: Q, q: string | undefined, columns: string[]): Q {
  const term = q ? sanitizeSearch(q) : "";
  if (!term) return query;
  return query.or(columns.map((c) => `${c}.ilike.%${term}%`).join(","));
}

export const loadByIds = async (table: string, ids: string[], columns: string): Promise<Map<string, Row>> => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabaseAdmin.from(table).select(columns).in("id", unique);
  if (error) handleSupabaseError(error, `Failed to load ${table}`);
  return new Map(((data ?? []) as unknown as Row[]).map((row) => [String(row.id), row]));
};
