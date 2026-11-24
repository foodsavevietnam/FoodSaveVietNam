// Dữ liệu xem thử (?demo=1) cho màn "Hàng đang bán" (GET /admin/products và POST /admin/products/:id/visibility).
const PRODUCTS = [
  {
    id: 'p-1',
    name: 'Bánh mì que pate',
    store_name: 'Tiệm Bánh Nắng',
    label: 'red',
    stock_quantity: 6,
    expires_at: '2026-11-23T14:00:00.000Z',
    effective_deadline_at: '2026-11-23T13:30:00.000Z',
    price_cents: 8000,
    original_price_cents: 16000,
    label_changed_at: '2026-11-23T06:00:00.000Z',
    is_active: true,
    admin_hidden_at: null,
    admin_hidden_reason: null,
  },
  {
    id: 'p-2',
    name: 'Sữa chua nếp cẩm',
    store_name: 'Cửa hàng An Lành',
    label: 'yellow',
    stock_quantity: 14,
    expires_at: '2026-11-24T09:00:00.000Z',
    effective_deadline_at: null,
    price_cents: 12000,
    original_price_cents: 18000,
    label_changed_at: null,
    is_active: true,
    admin_hidden_at: null,
    admin_hidden_reason: null,
  },
  {
    id: 'p-3',
    name: 'Rau cải thìa hữu cơ',
    store_name: 'Cửa hàng An Lành',
    label: 'green',
    stock_quantity: 30,
    expires_at: '2026-11-26T09:00:00.000Z',
    effective_deadline_at: null,
    price_cents: 25000,
    original_price_cents: 30000,
    label_changed_at: null,
    is_active: true,
    admin_hidden_at: null,
    admin_hidden_reason: null,
  },
  {
    id: 'p-4',
    name: 'Chả lụa đóng gói lỗi nhãn (mẫu)',
    store_name: 'Tiệm Bánh Nắng',
    label: 'yellow',
    stock_quantity: 4,
    expires_at: '2026-11-24T12:00:00.000Z',
    effective_deadline_at: null,
    price_cents: 35000,
    original_price_cents: 70000,
    label_changed_at: null,
    is_active: false,
    admin_hidden_at: '2026-11-23T05:00:00.000Z',
    admin_hidden_reason: 'Thiếu thông tin hạn dùng trên bao bì',
  },
];

export const products = PRODUCTS;
export const routes = {};

function paramsOf(rawPath) {
  const qs = String(rawPath || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

export function resolve(method, path, body, rawPath) {
  if (method === 'GET' && path === '/admin/products') {
    const sp = paramsOf(rawPath);
    const label = sp.get('label');
    const vis = sp.get('visibility');
    const q = (sp.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 50));

    const filtered = PRODUCTS.filter((p) => {
      if (label && p.label !== label) return false;
      if (vis === 'visible' && p.admin_hidden_at) return false;
      if (vis === 'hidden' && !p.admin_hidden_at) return false;
      if (q && ![p.name, p.store_name].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });

    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
    };
  }

  const visMatch = method === 'POST' ? /^\/admin\/products\/([^/]+)\/visibility$/.exec(path) : null;
  if (visMatch) {
    const prod = PRODUCTS.find((p) => p.id === visMatch[1]);
    if (!prod) return undefined;
    if (body?.action === 'hide') {
      prod.is_active = false;
      prod.admin_hidden_at = new Date().toISOString();
      prod.admin_hidden_reason = body?.reason || '';
    } else if (body?.action === 'unhide') {
      prod.is_active = true;
      prod.admin_hidden_at = null;
      prod.admin_hidden_reason = null;
    }
    return { id: prod.id, is_active: prod.is_active, admin_hidden_at: prod.admin_hidden_at, admin_hidden_reason: prod.admin_hidden_reason };
  }

  return undefined;
}
