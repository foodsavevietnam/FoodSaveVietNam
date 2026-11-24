// Lớp API xem thử (?demo=1): cùng giao diện createApi, dữ liệu mẫu trong bộ nhớ, không gọi mạng.
import { ApiError } from '../core/api.js';
import work from './fixtures/work.js';
import audit from './fixtures/audit.js';
import finance from './fixtures/finance.js';
import labels from './fixtures/labels.js';
import esg from './fixtures/esg.js';
import automation from './fixtures/automation.js';
import policy from './fixtures/policy.js';
import complaints, { messages as complaintMessages } from './fixtures/complaints.js';
import payouts, { REVEAL_SAMPLE } from './fixtures/payouts.js';
import verify, { accounts as payoutAccounts } from './fixtures/verify.js';
import alerts from './fixtures/alerts.js';
import vouchers from './fixtures/vouchers.js';
import * as fx_customers from './fixtures/customers.js';
import * as fx_stores from './fixtures/stores.js';
import * as fx_charities from './fixtures/charities.js';
import * as fx_orders from './fixtures/orders.js';
import * as fx_donations from './fixtures/donations.js';
import * as fx_tracking from './fixtures/tracking.js';
import * as fx_inventory from './fixtures/inventory.js';
import * as fx_ledger from './fixtures/ledger.js';
import * as fx_marketing from './fixtures/marketing.js';
import * as fx_settings from './fixtures/settings.js';

// Màn Đợt 2 tạm: mỗi file fixture tự khai báo routes (đường dẫn cố định) và resolve (đường dẫn động).
const SCREEN_FIXTURES = [fx_customers, fx_stores, fx_charities, fx_orders, fx_donations, fx_tracking, fx_inventory, fx_ledger, fx_marketing, fx_settings];

const ROUTES = {
  'GET /admin/dashboard/work': work,
  'GET /admin/audit-log': audit,
  'GET /admin/finance/summary': finance,
  'GET /admin/labels': labels,
  'GET /admin/esg': esg,
  'GET /admin/automation': automation,
  'GET /admin/order-policy': policy,
  'GET /admin/complaints': complaints,
  'GET /admin/verification': verify,
  'GET /admin/payout-accounts': payoutAccounts,
  'GET /admin/withdrawals': payouts,
  'GET /admin/fraud-alerts': alerts,
  'GET /admin/vouchers': vouchers,
};
for (const fx of SCREEN_FIXTURES) Object.assign(ROUTES, fx.routes || {});

export function createDemoApi() {
  const saved = new Map(); // 'METHOD path' → body ghi gần nhất (chỉ giữ trong bộ nhớ)

  async function request(method, rawPath, body) {
    const path = String(rawPath).split('?')[0];
    const key = `${method} ${path}`;
    for (const fx of SCREEN_FIXTURES) {
      const hit = typeof fx.resolve === 'function' ? fx.resolve(method, path, body, String(rawPath)) : undefined;
      if (hit !== undefined) return structuredClone(hit);
    }
    if (method === 'GET') {
      if (path === '/admin/search') {
        const q = (new URLSearchParams(String(rawPath).split('?')[1] || '').get('q') || '').trim().toLowerCase();
        const hit = (vals) => q.length >= 2 && vals.some((v) => String(v || '').toLowerCase().includes(q));
        const mask = (p) => (p && String(p).length >= 7 ? `${String(p).slice(0, 3)}***${String(p).slice(-3)}` : '');
        return structuredClone({
          query: q,
          accounts: (fx_customers.accounts || []).filter((a) => hit([a.full_name, a.email, a.phone])).slice(0, 5).map((a) => ({ id: a.id, full_name: a.full_name, role: a.role, status: a.status, email: a.email, phone: mask(a.phone) })),
          stores: (fx_stores.stores || []).filter((s) => hit([s.name, s.address])).slice(0, 5).map((s) => ({ id: s.id, name: s.name, district: s.district, city: s.city, status: s.status, is_verified: s.is_verified })),
          charities: (fx_charities.charities || []).filter((c) => hit([c.name, c.address, c.phone])).slice(0, 5).map((c) => ({ id: c.id, name: c.name, district: c.district, city: c.city, status: c.status, phone: mask(c.phone) })),
          orders: [],
          complaints: (Array.isArray(complaints) ? complaints : []).filter((c) => hit([c.issue, c.order_number])).slice(0, 5).map((c) => ({ id: c.id, order_id: c.order_id, status: c.status, priority: c.priority, issue: c.issue })),
        });
      }
      if (/^\/orders\/[^/]+\/messages$/.test(path)) return structuredClone({ messages: complaintMessages, can_send: false });
      if (!(key in ROUTES)) throw new ApiError('RESOURCE_NOT_FOUND', `Chưa có dữ liệu mẫu cho ${path}`, 404);
      return structuredClone(ROUTES[key]);
    }
    if (method === 'DELETE') { saved.delete(key); return { ok: true }; }
    if (method === 'POST' && /^\/admin\/withdrawals\/[^/]+\/reveal-account$/.test(path)) return { ...REVEAL_SAMPLE };
    saved.set(key, structuredClone(body ?? null));
    return { ok: true };
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body),
    del: (path) => request('DELETE', path),
  };
}
