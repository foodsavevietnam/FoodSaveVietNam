// Dữ liệu xem thử (?demo=1) cho màn "Cửa hàng". Tên cửa hàng, chủ cửa hàng, đơn đều là dữ liệu mẫu.
// routes: khóa 'METHOD /đường-dẫn' (không query) → dữ liệu trả về.
// resolve(method, path, body): cho đường dẫn động; trả undefined nếu không khớp.
const S1 = 'e1000001-0000-4000-8000-000000000001';
const S2 = 'e1000002-0000-4000-8000-000000000002';
const P1 = 'e1000003-0000-4000-8000-000000000003';
const store = (o) => ({ owner_id: 'e0000000-0000-4000-8000-000000000001', slug: 'cua-hang-mau', emoji: '🥖', city: 'TP.HCM', district: 'Quận 1', rating: 4.5, is_verified: true, is_open: true, opening_hours: '07:00 - 21:00', status: 'active', service_tier: 'standard', created_at: '2026-10-01T03:00:00.000Z', ...o });

const stores = [
  store({ id: S1, name: 'Tiệm bánh mẫu A', address: '1 Đường Mẫu, Quận 1', rating: 4.8 }),
  store({ id: S2, name: 'Siêu thị mẫu B', address: '2 Đường Mẫu, Quận 3', district: 'Quận 3', rating: 4.1, is_verified: false, created_at: '2026-11-05T03:00:00.000Z' }),
];

export const routes = {
  'GET /catalog/stores': { items: stores, pagination: { page: 1, limit: 100, total: stores.length, has_next_page: false } },
  'GET /admin/pending-partners': [
    { userId: 'e0000000-0000-4000-8000-000000000009', profile: { id: 'e0000000-0000-4000-8000-000000000009', full_name: 'Chủ cửa hàng mẫu C', phone: '0900000009', status: 'pending' }, store: store({ id: P1, name: 'Quán mẫu C (chờ duyệt)', address: '9 Đường Mẫu, Quận 5', district: 'Quận 5', status: 'pending', is_verified: false, created_at: '2026-11-20T03:00:00.000Z' }) },
  ],
};

export function resolve(method, path) {
  if (method !== 'GET') return undefined;
  if (/^\/seller-reputation\/[^/]+$/.test(path)) {
    return { seller_id: S1, trust_score: 92, rating_avg: 4.8, status: 'Active', restricted_until: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z' };
  }
  return undefined;
}
