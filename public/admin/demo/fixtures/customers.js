// Dữ liệu xem thử (?demo=1) cho màn "Người mua". Tên, email, SĐT đều là dữ liệu mẫu.
// routes: khóa 'METHOD /đường-dẫn' (không query) → dữ liệu trả về.
// resolve(method, path, body): cho đường dẫn động; trả undefined nếu không khớp.
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days) => new Date(Date.now() + days * DAY).toISOString();

export const routes = {
  'GET /admin/users': {
    counts: { customers: 4, partners: 2, charities: 1, volunteers: 1, admins: 1, stores: 2 },
    buyers: [
      { id: 'd1000001-0000-4000-8000-000000000001', full_name: 'Người mua mẫu A', email: 'mau.a@example.test', phone: '0900000001', status: 'active', provider: 'google', points: 20, rank: 'Chặn', red_ban_until: ahead(3), created_at: ago(80), last_sign_in_at: ago(1), orders_total: 6, orders_completed: 1, orders_cancelled: 4 },
      { id: 'd1000002-0000-4000-8000-000000000002', full_name: 'Người mua mẫu B', email: 'mau.b@example.test', phone: '0900000002', status: 'suspended', provider: 'phone', points: 55, rank: 'Hạn chế', red_ban_until: null, created_at: ago(30), last_sign_in_at: ago(12), orders_total: 2, orders_completed: 1, orders_cancelled: 1 },
      { id: 'd1000003-0000-4000-8000-000000000003', full_name: 'Người mua mẫu C', email: 'mau.c@example.test', phone: '0900000003', status: 'active', provider: 'email', points: 92, rank: 'Tin cậy', red_ban_until: null, created_at: ago(2), last_sign_in_at: ago(0), orders_total: 1, orders_completed: 1, orders_cancelled: 0 },
      { id: 'd1000004-0000-4000-8000-000000000004', full_name: 'Người mua mẫu D', email: 'mau.d@example.test', phone: '0900000004', status: 'active', provider: 'email', points: 78, rank: 'Tin cậy', red_ban_until: null, created_at: ago(120), last_sign_in_at: null, orders_total: 9, orders_completed: 8, orders_cancelled: 0 },
    ],
  },
};

// GET /admin/users cũng được trả ở đây: resolve chạy trước ROUTES nên không bị fixture settings (cùng khóa, buyers rỗng) ghi đè.
export function resolve(method, path) {
  if (method === 'GET' && path === '/admin/users') return routes['GET /admin/users'];
  if (method === 'POST' && /^\/admin\/customers\/[^/]+\/unlock$/.test(path)) return { points: 40, rank: 'Hạn chế' };
  return undefined;
}
