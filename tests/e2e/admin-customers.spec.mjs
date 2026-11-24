import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import * as demo from '../../public/admin/demo/fixtures/customers.js';

// Màn "Người mua" (Wave 4A Đợt 2): GET /admin/accounts?role=customer, GET /admin/accounts/:id,
// POST /admin/accounts/:id/status, POST /admin/customers/:id/unlock. Auth Supabase và API đều được stub.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const DAY = 86400000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const C1 = '11111111-aaaa-4aaa-8aaa-000000000001';
const C2 = '22222222-aaaa-4aaa-8aaa-000000000002';
const C3 = '33333333-aaaa-4aaa-8aaa-000000000003';

const seedAccounts = () => [
  { id: C1, role: 'customer', full_name: 'Lê Thị Khóa', email: 'khoa@example.test', phone: '0901234567', status: 'active', auth_provider: 'google', points: 20, rank: 'Chặn', red_ban_until: iso(3 * DAY), created_at: iso(-90 * DAY), last_login_at: iso(-1 * DAY), orders_total: 5, orders_completed: 1, orders_cancelled: 3, orders_no_show: 3, suspended_at: null, suspended_reason: null },
  { id: C2, role: 'customer', full_name: 'Trần Văn Tạm', email: 'tam@example.test', phone: '0912345678', status: 'suspended', auth_provider: 'phone', points: 60, rank: 'Hạn chế', red_ban_until: null, created_at: iso(-2 * DAY), last_login_at: null, orders_total: 0, orders_completed: 0, orders_cancelled: 0, orders_no_show: 0, suspended_at: iso(-1 * DAY), suspended_reason: 'Vi phạm quy định đặt đơn' },
  { id: C3, role: 'customer', full_name: 'Phạm Thu Hà', email: 'ha@example.test', phone: '0987654321', status: 'active', auth_provider: 'password', points: 90, rank: 'Tin cậy', red_ban_until: null, created_at: iso(-60 * DAY), last_login_at: iso(-5 * DAY), orders_total: 12, orders_completed: 11, orders_cancelled: 0, orders_no_show: 0, suspended_at: null, suspended_reason: null },
];

async function setup(page, { accountsMode = 'ok', detailMode = 'ok', unlock = 'ok', statusMode = 'ok', customRows = null, ignoreStatuses = [] } = {}) {
  const rows = customRows ? customRows.map((r) => ({ ...r })) : seedAccounts();
  const state = { accountsMode, detailMode, unlock, statusMode, listCalls: 0, workCalls: 0, rows };
  const api = async (route, { path, method }) => {
    const bare = path.split('?')[0];
    const sp = new URLSearchParams(path.split('?')[1] || '');
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') { state.workCalls += 1; return route.fulfill(ok({})); }

    if (bare === '/admin/accounts' && method === 'GET') {
      state.listCalls += 1;
      if (state.accountsMode === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const now = Date.now();
      const status = sp.get('status');
      const redBanned = sp.get('red_banned') === 'true';
      const q = (sp.get('q') || '').trim().toLowerCase();
      const pageNum = Math.max(1, Number(sp.get('page')) || 1);
      const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
      const filtered = state.rows.filter((a) => {
        if (status && a.status !== status) return false;
        if (redBanned && !(a.red_ban_until && new Date(a.red_ban_until).getTime() > now)) return false;
        if (q && ![a.full_name, a.email, a.phone].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      const start = (pageNum - 1) * limit;
      return route.fulfill(ok({
        items: filtered.slice(start, start + limit),
        total: filtered.length,
        page: pageNum,
        limit,
        counts: {
          total: state.rows.length,
          active: state.rows.filter((a) => a.status === 'active').length,
          suspended: state.rows.filter((a) => a.status === 'suspended').length,
          locked: state.rows.filter((a) => a.red_ban_until && new Date(a.red_ban_until).getTime() > now).length,
        },
      }));
    }

    const detailMatch = method === 'GET' ? bare.match(/^\/admin\/accounts\/([^/]+)$/) : null;
    if (detailMatch) {
      if (state.detailMode === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const acc = state.rows.find((r) => r.id === detailMatch[1]);
      if (!acc) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy tài khoản'));
      const redBanned = Boolean(acc.red_ban_until && new Date(acc.red_ban_until).getTime() > Date.now());
      return route.fulfill(ok({
        profile: acc,
        trust: { points: acc.points, rank: acc.rank, red_ban_until: redBanned ? acc.red_ban_until : null, red_banned: redBanned, blocked: acc.points < 40, no_show_count: acc.orders_no_show, no_show_limit: 3, window_days: 60 },
        order_stats: { total: acc.orders_total, completed: acc.orders_completed, cancelled: acc.orders_cancelled, no_show: acc.orders_no_show, spent_cents: acc.orders_completed * 50000 },
        recent_orders: acc.orders_total > 0 ? [{ id: 'o1', order_number: 'FS-9001', status: 'completed', total_cents: 50000, created_at: iso(-2 * DAY) }] : [],
        location_consents: [{ actor_kind: 'customer', actor_id: acc.id, granted: true, policy_version: 'v1', decided_at: iso(-3 * DAY) }],
        recent_audit: [{ id: 'au1', actor_name: 'Admin Thử', action: 'account.suspend', detail: { reason: acc.suspended_reason }, created_at: iso(-1 * DAY) }],
      }));
    }

    const statusMatch = method === 'POST' ? bare.match(/^\/admin\/accounts\/([^/]+)\/status$/) : null;
    if (statusMatch) {
      if (state.statusMode === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const body = route.request().postDataJSON?.() || {};
      const acc = state.rows.find((r) => r.id === statusMatch[1]);
      if (acc) {
        acc.status = body.status;
        acc.suspended_reason = body.status === 'suspended' ? (body.reason || null) : null;
      }
      return route.fulfill(ok({ id: statusMatch[1], status: body.status }));
    }

    const unlockMatch = method === 'POST' ? bare.match(/^\/admin\/customers\/([^/]+)\/unlock$/) : null;
    if (unlockMatch) {
      if (state.unlock === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const acc = state.rows.find((r) => r.id === unlockMatch[1]);
      if (acc) { acc.red_ban_until = null; acc.points = Math.max(acc.points, 40); acc.rank = 'Hạn chế'; }
      return route.fulfill(ok({ points: 40, rank: 'Hạn chế' }));
    }

    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có'));
  };
  const stub = await stubAdmin(page, { api, ignoreStatuses });
  return { state, ...stub };
}

const screen = (page) => page.locator('[data-screen="customers"]');
const openRow = (page, id) => screen(page).locator(`[data-act="open"][data-id="${id}"]`);
const unlockCalls = (calls) => calls.filter((c) => c.method === 'POST' && /\/unlock$/.test(c.path));
const statusCalls = (calls) => calls.filter((c) => c.method === 'POST' && /^\/admin\/accounts\/[^/]+\/status$/.test(c.path));

test('customers: tải từ /admin/accounts, ô số KPI, bảng, SĐT che, nhãn Việt, không mã thô', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(3);
  await expect(screen(page).locator('[data-kpi="total"]')).toContainText('3');
  await expect(screen(page).locator('[data-kpi="active"]')).toContainText('2');
  await expect(screen(page).locator('[data-kpi="locked"]')).toContainText('1');
  await expect(screen(page).locator('[data-kpi="suspended"]')).toContainText('1');
  const text = await screen(page).innerText();
  expect(text).toContain('Lê Thị Khóa');
  expect(text).toContain('khoa@example.test');
  expect(text).toContain('090***567');
  expect(text).not.toContain('0901234567');
  expect(text).toContain('Google');
  expect(text).toContain('Tin cậy');
  expect(text).not.toContain('Sắp có');
  expect(text).not.toMatch(/suspended|\bgoogle\b|\bphone\b|\bactive\b|undefined|null/);
  expect(calls.some((c) => c.path.startsWith('/admin/accounts?') && c.path.includes('role=customer'))).toBe(true);
  expect(errors).toEqual([]);
});

test('customers: tab lọc qua hash và tìm kiếm phía server', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(3);
  await page.click('[data-act="tab"][data-tab="locked"]');
  await expect(page).toHaveURL(/#\/customers\?tab=locked/);
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Lê Thị Khóa');
  expect(calls.some((c) => c.path.includes('red_banned=true'))).toBe(true);

  await page.click('[data-act="tab"][data-tab="suspended"]');
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Trần Văn Tạm');
  expect(calls.some((c) => c.path.includes('status=suspended'))).toBe(true);

  await page.click('[data-act="tab"][data-tab="all"]');
  await expect(screen(page).locator('tbody tr')).toHaveCount(3);
  await screen(page).locator('[data-role="search"]').fill('ha@example');
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Phạm Thu Hà');
  await screen(page).locator('[data-role="search"]').fill('không có ai tên này');
  await expect(screen(page)).toContainText('Không có người mua phù hợp');
  expect(errors).toEqual([]);
});

test('customers: drawer 360° + mở khóa nhãn đỏ + tạm khóa/mở khóa tài khoản yêu cầu lý do ≥ 3 ký tự', async ({ page }) => {
  const { state, calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  await openRow(page, C1).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Lê Thị Khóa');
  await expect(drawer).toContainText('0901234567');
  await expect(drawer).toContainText('FS-9001');
  await expect(drawer).toContainText('10 đơn gần nhất');

  // Tạm khóa tài khoản: thiếu lý do (<3 ký tự) bị chặn
  await drawer.locator('[data-act="account-status"][data-status="suspended"]').click();
  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('ab');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('Gian lận đơn lặp lại');
  await expect(modal.locator('[data-role="ok"]')).toBeEnabled();
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã tạm khóa tài khoản');
  expect(statusCalls(calls)[0]).toMatchObject({ method: 'POST', path: `/admin/accounts/${C1}/status`, body: { status: 'suspended', reason: 'Gian lận đơn lặp lại' } });

  // Mở khóa tài khoản lại
  await expect(drawer.locator('[data-act="account-status"][data-status="active"]')).toBeVisible();
  await drawer.locator('[data-act="account-status"][data-status="active"]').click();
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã mở khóa tài khoản');
  expect(statusCalls(calls)[1]).toMatchObject({ method: 'POST', path: `/admin/accounts/${C1}/status`, body: { status: 'active' } });

  // Mở khóa nhãn đỏ
  const before = state.listCalls;
  const workBefore = state.workCalls;
  await drawer.locator('[data-act="unlock"]').click();
  await modal.locator('[data-role="reason"]').fill('Khách đã giải trình');
  await modal.locator('[data-role="ok"]').click();
  await expect.poll(() => unlockCalls(calls).length).toBe(1);
  expect(unlockCalls(calls)[0]).toMatchObject({ method: 'POST', path: `/admin/customers/${C1}/unlock`, body: { note: 'Khách đã giải trình' } });
  await expect(page.locator('#toasts')).toContainText('Đã mở khóa nhãn đỏ');
  await expect.poll(() => state.listCalls).toBeGreaterThan(before);
  await expect.poll(() => state.workCalls).toBeGreaterThan(workBefore);
  expect(errors).toEqual([]);
});

test('customers: hủy confirm thì không gọi API; mở khóa lỗi 500 → toast lỗi', async ({ page }) => {
  const { calls, errors } = await setup(page, { unlock: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/customers`);
  await openRow(page, C1).click();
  await page.locator('#drawer [data-act="unlock"]').click();
  await page.locator('#modal [data-role="cancel"]').click();
  expect(unlockCalls(calls)).toHaveLength(0);
  await page.locator('#drawer [data-act="unlock"]').click();
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Lỗi máy chủ');
  expect(unlockCalls(calls)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('customers: API lỗi 500 → hiện lỗi có nút Thử lại; dữ liệu độc được escape (XSS)', async ({ page }) => {
  const { state, errors } = await setup(page, { accountsMode: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/customers`);
  await expect(page.locator('[data-role="retry"]').first()).toBeVisible();
  state.accountsMode = 'ok';
  state.rows[2].full_name = '<img src=x onerror="window.__xss=1">';
  await page.locator('[data-role="retry"]').first().click();
  await expect(screen(page).locator('tbody tr')).toHaveCount(3);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('customers: #/customers?id=<id> mở thẳng hồ sơ; id lạ → thông báo', async ({ page }) => {
  const { errors } = await setup(page, { ignoreStatuses: [404] });
  await page.goto(`${PAGE}#/customers?id=${C1}`);
  await expect(page.locator('#drawer')).toContainText('Lê Thị Khóa');
  await expect(page.locator('#drawer [data-act="unlock"]')).toBeVisible();
  await page.goto(`${PAGE}#/customers?id=99999999-aaaa-4aaa-8aaa-000000000009`);
  await expect(screen(page).locator('[data-role="notice"]')).toContainText('Không tìm thấy tài khoản người mua này.');
  expect(errors).toEqual([]);
});

test('customers: ?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.addInitScript(() => { window.__FAKE_SB = { noSession: true }; });
  await page.goto(`${PAGE}?demo=1#/customers`);
  await expect(page.locator('.v2demo')).toBeVisible();
  await expect(screen(page).locator('tbody tr').first()).toBeVisible();
  expect(demo.accounts.length).toBeGreaterThan(0);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
