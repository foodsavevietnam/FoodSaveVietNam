// Dữ liệu xem thử (?demo=1) cho màn "Người mua" (hỗ trợ cả endpoint cũ GET /admin/users và Đợt 2 GET/POST /admin/accounts).
const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days) => new Date(Date.now() + days * DAY).toISOString();

const DEMO_ACCOUNTS = [
  { id: 'd1000001-0000-4000-8000-000000000001', role: 'customer', full_name: 'Người mua mẫu A', email: 'mau.a@example.test', phone: '0900000001', status: 'active', provider: 'google', auth_provider: 'google', points: 20, rank: 'Chặn', red_ban_until: ahead(3), created_at: ago(80), last_sign_in_at: ago(1), last_login_at: ago(1), orders_total: 6, orders_completed: 1, orders_cancelled: 4, orders_no_show: 3, suspended_at: null, suspended_reason: null },
  { id: 'd1000002-0000-4000-8000-000000000002', role: 'customer', full_name: 'Người mua mẫu B', email: 'mau.b@example.test', phone: '0900000002', status: 'suspended', provider: 'phone', auth_provider: 'phone', points: 55, rank: 'Hạn chế', red_ban_until: null, created_at: ago(30), last_sign_in_at: ago(12), last_login_at: ago(12), orders_total: 2, orders_completed: 1, orders_cancelled: 1, orders_no_show: 0, suspended_at: ago(2), suspended_reason: 'Vi phạm quy định đặt đơn mẫu' },
  { id: 'd1000003-0000-4000-8000-000000000003', role: 'customer', full_name: 'Người mua mẫu C', email: 'mau.c@example.test', phone: '0900000003', status: 'active', provider: 'email', auth_provider: 'password', points: 92, rank: 'Tin cậy', red_ban_until: null, created_at: ago(2), last_sign_in_at: ago(0), last_login_at: ago(0), orders_total: 1, orders_completed: 1, orders_cancelled: 0, orders_no_show: 0, suspended_at: null, suspended_reason: null },
  { id: 'd1000004-0000-4000-8000-000000000004', role: 'customer', full_name: 'Người mua mẫu D', email: 'mau.d@example.test', phone: '0900000004', status: 'active', provider: 'email', auth_provider: 'password', points: 78, rank: 'Tin cậy', red_ban_until: null, created_at: ago(120), last_sign_in_at: null, last_login_at: null, orders_total: 9, orders_completed: 8, orders_cancelled: 0, orders_no_show: 0, suspended_at: null, suspended_reason: null },
];

export const accounts = DEMO_ACCOUNTS;

export const routes = {
  'GET /admin/users': {
    counts: { customers: 4, partners: 2, charities: 1, volunteers: 1, admins: 1, stores: 2 },
    buyers: DEMO_ACCOUNTS,
  },
};

function paramsOf(rawPath) {
  const qs = String(rawPath || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

export function resolve(method, path, body, rawPath) {
  if (method === 'GET' && path === '/admin/users') return routes['GET /admin/users'];

  if (method === 'GET' && path === '/admin/accounts') {
    const sp = paramsOf(rawPath);
    const role = sp.get('role');
    const status = sp.get('status');
    const redBanned = sp.get('red_banned') === 'true';
    const q = (sp.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
    const now = Date.now();
    const scoped = DEMO_ACCOUNTS.filter((a) => !role || a.role === role);
    const filtered = scoped.filter((a) => {
      if (status && a.status !== status) return false;
      if (redBanned && !(a.red_ban_until && new Date(a.red_ban_until).getTime() > now)) return false;
      if (q && ![a.full_name, a.email, a.phone].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
      counts: {
        total: scoped.length,
        active: scoped.filter((a) => a.status === 'active').length,
        suspended: scoped.filter((a) => a.status === 'suspended').length,
        locked: scoped.filter((a) => a.red_ban_until && new Date(a.red_ban_until).getTime() > now).length,
      },
    };
  }

  const detailMatch = method === 'GET' ? path.match(/^\/admin\/accounts\/([^/]+)$/) : null;
  if (detailMatch) {
    const acc = DEMO_ACCOUNTS.find((a) => a.id === detailMatch[1]);
    if (!acc) return undefined;
    const redBanned = Boolean(acc.red_ban_until && new Date(acc.red_ban_until).getTime() > Date.now());
    return {
      profile: acc,
      trust: { points: acc.points, rank: acc.rank, red_ban_until: redBanned ? acc.red_ban_until : null, red_banned: redBanned, blocked: acc.points < 40, no_show_count: acc.orders_no_show, no_show_limit: 3, window_days: 60 },
      order_stats: { total: acc.orders_total, completed: acc.orders_completed, cancelled: acc.orders_cancelled, no_show: acc.orders_no_show, spent_cents: acc.orders_completed * 55000 },
      recent_orders: acc.orders_total > 0 ? [{ id: 'ord-demo-1', order_number: 'FS-DEMO01', status: 'completed', total_cents: 55000, created_at: ago(2) }] : [],
      location_consents: [{ actor_kind: 'customer', actor_id: acc.id, granted: true, policy_version: 'v1', decided_at: ago(5) }],
      recent_audit: [],
    };
  }

  const statusMatch = method === 'POST' ? path.match(/^\/admin\/accounts\/([^/]+)\/status$/) : null;
  if (statusMatch) {
    const acc = DEMO_ACCOUNTS.find((a) => a.id === statusMatch[1]);
    if (acc && (body?.status === 'active' || body?.status === 'suspended')) {
      acc.status = body.status;
      acc.suspended_at = body.status === 'suspended' ? new Date().toISOString() : null;
      acc.suspended_reason = body.status === 'suspended' ? (body.reason || null) : null;
      return { id: acc.id, status: acc.status, suspended_at: acc.suspended_at, suspended_reason: acc.suspended_reason };
    }
    return { id: statusMatch[1], status: body?.status || 'active' };
  }

  const unlockMatch = method === 'POST' ? path.match(/^\/admin\/customers\/([^/]+)\/unlock$/) : null;
  if (unlockMatch) {
    const acc = DEMO_ACCOUNTS.find((a) => a.id === unlockMatch[1]);
    if (acc) { acc.red_ban_until = null; acc.points = Math.max(acc.points, 40); acc.rank = 'Hạn chế'; }
    return { points: 40, rank: 'Hạn chế' };
  }

  return undefined;
}
