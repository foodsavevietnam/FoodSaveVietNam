// Dữ liệu xem thử (?demo=1) cho màn "Cài đặt".
// routes: khóa 'METHOD /đường-dẫn' (không query) → dữ liệu trả về.
// resolve(method, path, body): cho đường dẫn động (ví dụ /orders/:id); trả undefined nếu không khớp.
export const routes = {
  'GET /health': { service: 'foodsave-backend', environment: 'production', uptime_seconds: 93784, checked_at: '2026-11-23T08:00:00.000Z' },
  // /admin/users (customers) và /marketing/admin/overview (marketing) thuộc fixture khác.
};

export function resolve() {
  return undefined;
}
