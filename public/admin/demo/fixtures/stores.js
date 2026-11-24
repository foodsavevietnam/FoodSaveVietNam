// Dữ liệu xem thử (?demo=1) cho màn "Cửa hàng" (hỗ trợ cả endpoint cũ và Đợt 2 /admin/stores).
const S1 = 'e1000001-0000-4000-8000-000000000001';
const S2 = 'e1000002-0000-4000-8000-000000000002';
const P1 = 'e1000003-0000-4000-8000-000000000003';
const S3 = 'e1000004-0000-4000-8000-000000000004';

const mkStore = (o) => ({
  owner_id: 'e0000000-0000-4000-8000-000000000001',
  owner_name: 'Chủ cửa hàng mẫu',
  owner_phone: '090••••001',
  slug: 'cua-hang-mau',
  emoji: '🥖',
  city: 'TP.HCM',
  district: 'Quận 1',
  rating: 4.5,
  is_verified: true,
  is_open: true,
  opening_hours: '07:00 - 21:00',
  status: 'active',
  service_tier: 'Starter',
  suspended_at: null,
  suspended_reason: null,
  created_at: '2026-10-01T03:00:00.000Z',
  ...o,
});

const DEMO_STORES = [
  mkStore({ id: S1, name: 'Tiệm bánh mẫu A', address: '1 Đường Mẫu, Quận 1', rating: 4.8 }),
  mkStore({ id: S2, name: 'Siêu thị mẫu B', address: '2 Đường Mẫu, Quận 3', district: 'Quận 3', rating: 4.1, is_verified: true, created_at: '2026-11-05T03:00:00.000Z' }),
  mkStore({ id: P1, name: 'Quán mẫu C (chờ duyệt)', address: '9 Đường Mẫu, Quận 5', district: 'Quận 5', status: 'pending', is_verified: false, owner_name: 'Chủ cửa hàng mẫu C', owner_phone: '090••••009', created_at: '2026-11-20T03:00:00.000Z' }),
  mkStore({ id: S3, name: 'Bếp mẫu D (tạm ngưng)', address: '12 Đường Mẫu, Quận 7', district: 'Quận 7', status: 'suspended', is_verified: true, suspended_at: '2026-11-21T03:00:00.000Z', suspended_reason: 'Tạm ngưng kiểm tra chất lượng', created_at: '2026-09-15T03:00:00.000Z' }),
];

export const stores = DEMO_STORES;

export const routes = {
  'GET /catalog/stores': {
    items: DEMO_STORES.filter((s) => s.status === 'active'),
    pagination: { page: 1, limit: 100, total: 2, has_next_page: false },
  },
  'GET /admin/pending-partners': [
    { userId: 'e0000000-0000-4000-8000-000000000009', profile: { id: 'e0000000-0000-4000-8000-000000000009', full_name: 'Chủ cửa hàng mẫu C', phone: '0900000009', status: 'pending' }, store: DEMO_STORES[2] },
  ],
};

function paramsOf(rawPath) {
  const qs = String(rawPath || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

export function resolve(method, path, body, rawPath) {
  if (method === 'GET' && path === '/admin/stores') {
    const sp = paramsOf(rawPath);
    const status = sp.get('status');
    const q = (sp.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
    const filtered = DEMO_STORES.filter((s) => {
      if (status && s.status !== status) return false;
      if (q && ![s.name, s.address, s.district].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
      counts: {
        active: DEMO_STORES.filter((s) => s.status === 'active').length,
        pending: DEMO_STORES.filter((s) => s.status === 'pending').length,
        suspended: DEMO_STORES.filter((s) => s.status === 'suspended').length,
        rejected: DEMO_STORES.filter((s) => s.status === 'rejected').length,
        total: DEMO_STORES.length,
      },
    };
  }

  const detailMatch = method === 'GET' ? path.match(/^\/admin\/stores\/([^/]+)$/) : null;
  if (detailMatch) {
    const s = DEMO_STORES.find((x) => x.id === detailMatch[1]);
    if (!s) return undefined;
    return {
      store: s,
      owner: { id: s.owner_id, full_name: s.owner_name, email: 'partner@example.test', phone: s.owner_phone, status: 'active' },
      partner_profile: { profile_id: s.owner_id, store_id: s.id, legal_name: `HKD ${s.name}`, tax_code: '••••••1234', cccd_number: '••••••••5678', business_type: 'bakery' },
      payout_accounts: { current: { id: 'pa-demo-1', store_id: s.id, bank_name: 'Vietcombank', account_holder_name: 'NGUYEN VAN A', account_last4: '4321', status: 'verified' }, history: [] },
      wallet: { balance: 1850000, pending_withdrawals: 300000, available: 1550000, held: 240000, withdrawn: 4200000, held_orders: 3 },
      reputation: { seller_id: s.id, trust_score: 92, rating_avg: s.rating, status: 'Active', restricted_until: null },
      product_summary: { total: 14, active: 10, out_of_stock: 2, by_label: { green: 6, yellow: 5, red: 3 } },
      recent_orders: [
        { id: 'ord-s1', order_number: 'FS-1001', status: 'completed', total_cents: 125000, created_at: '2026-11-22T05:00:00.000Z' },
        { id: 'ord-s2', order_number: 'FS-1002', status: 'no_show', total_cents: 40000, created_at: '2026-11-21T05:00:00.000Z' },
      ],
      recent_complaints: [],
      recent_donations: [],
      recent_audit: [],
    };
  }

  const productsMatch = method === 'GET' ? path.match(/^\/admin\/stores\/([^/]+)\/products$/) : null;
  if (productsMatch) {
    return {
      items: [
        { id: 'pr-demo-1', store_id: productsMatch[1], name: 'Bánh mì tươi mẫu', category: 'bakery', label: 'yellow', price_cents: 25000, original_price_cents: 50000, stock_quantity: 8, is_active: true, expires_at: '2026-11-25T10:00:00.000Z' },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };
  }

  const statusMatch = method === 'POST' ? path.match(/^\/admin\/stores\/([^/]+)\/status$/) : null;
  if (statusMatch) {
    const s = DEMO_STORES.find((x) => x.id === statusMatch[1]);
    if (s && (body?.status === 'active' || body?.status === 'suspended')) {
      s.status = body.status;
      s.suspended_at = body.status === 'suspended' ? new Date().toISOString() : null;
      s.suspended_reason = body.status === 'suspended' ? (body.reason || null) : null;
      return { id: s.id, status: s.status, suspended_at: s.suspended_at, suspended_reason: s.suspended_reason };
    }
    return { id: statusMatch[1], status: body?.status || 'active' };
  }

  if (method === 'GET' && /^\/seller-reputation\/[^/]+$/.test(path)) {
    return { seller_id: S1, trust_score: 92, rating_avg: 4.8, status: 'Active', restricted_until: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-11-20T00:00:00.000Z' };
  }
  return undefined;
}
