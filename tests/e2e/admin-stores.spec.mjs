import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import * as demo from '../../public/admin/demo/fixtures/stores.js';

// Màn "Cửa hàng" (Wave 4A Đợt 2): GET /admin/stores, GET /admin/stores/:id, POST /admin/stores/:id/status.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };

const S1 = '51111111-bbbb-4bbb-8bbb-000000000001';
const S2 = '52222222-bbbb-4bbb-8bbb-000000000002';
const P1 = '53333333-bbbb-4bbb-8bbb-000000000003';
const S3 = '54444444-bbbb-4bbb-8bbb-000000000004';

const mkStore = (o) => ({
  owner_id: 'o1', owner_name: 'Chủ Tiệm', owner_phone: '090••••001', slug: 'x', city: 'TP.HCM', district: 'Quận 1',
  rating: 4.5, is_verified: true, is_open: true, opening_hours: '07:00 - 21:00', status: 'active',
  suspended_at: null, suspended_reason: null, created_at: '2026-10-01T03:00:00.000Z', ...o,
});

const seedStores = () => [
  mkStore({ id: S1, name: 'Tiệm Bánh Mẫu', address: '1 Lê Lợi', rating: 4.8 }),
  mkStore({ id: S2, name: 'Siêu Thị Thử', address: '2 Nguyễn Huệ', district: null, is_verified: false, rating: 3.9 }),
  mkStore({ id: P1, name: 'Quán Chờ Duyệt', address: '9 Hai Bà Trưng', owner_name: 'Chủ Chờ Duyệt', status: 'pending', is_verified: false }),
  mkStore({ id: S3, name: 'Bếp Tạm Ngưng', address: '12 Võ Văn Tần', status: 'suspended', is_verified: true, suspended_reason: 'Kiểm tra vệ sinh' }),
];

async function setup(page, { listMode = 'ok', statusMode = 'ok', ignoreStatuses = [] } = {}) {
  const rows = seedStores();
  const state = { listMode, statusMode, rows };
  const api = async (route, { path, method }) => {
    const bare = path.split('?')[0];
    const sp = new URLSearchParams(path.split('?')[1] || '');
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok({}));

    if (bare === '/admin/stores' && method === 'GET') {
      if (state.listMode === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const st = sp.get('status');
      const q = (sp.get('q') || '').trim().toLowerCase();
      const filtered = state.rows.filter((s) => {
        if (st && s.status !== st) return false;
        if (q && ![s.name, s.address, s.district].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      return route.fulfill(ok({
        items: filtered,
        total: filtered.length,
        page: 1,
        limit: 20,
        counts: {
          active: state.rows.filter((s) => s.status === 'active').length,
          pending: state.rows.filter((s) => s.status === 'pending').length,
          suspended: state.rows.filter((s) => s.status === 'suspended').length,
          rejected: 0,
          total: state.rows.length,
        },
      }));
    }

    const detailMatch = method === 'GET' ? bare.match(/^\/admin\/stores\/([^/]+)$/) : null;
    if (detailMatch) {
      const s = state.rows.find((x) => x.id === detailMatch[1]);
      if (!s) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy cửa hàng'));
      return route.fulfill(ok({
        store: s,
        owner: { id: s.owner_id, full_name: s.owner_name, email: 'chu@example.test', phone: s.owner_phone, status: 'active' },
        partner_profile: { profile_id: s.owner_id, store_id: s.id, legal_name: 'HKD Mẫu', tax_code: '••••••5678', cccd_number: '••••••••3456' },
        payout_accounts: { current: { id: 'pa1', bank_name: 'Vietcombank', account_holder_name: 'HKD MAU', account_last4: '4321', status: 'verified' }, history: [] },
        wallet: { balance: 1500000, pending_withdrawals: 200000, available: 1300000, held: 300000, withdrawn: 5000000, held_orders: 2 },
        reputation: { seller_id: s.id, trust_score: 87, rating_avg: 4.8, status: 'Restricted', restricted_until: null },
        product_summary: { total: 10, active: 8, out_of_stock: 1, by_label: { green: 4, yellow: 4, red: 2 } },
        recent_orders: [
          { id: 'o1', order_number: 'FS-1001', status: 'completed', total_cents: 125000, created_at: '2026-11-22T05:00:00.000Z' },
          { id: 'o2', order_number: 'FS-1002', status: 'no_show', total_cents: 40000, created_at: '2026-11-21T05:00:00.000Z' },
        ],
        recent_complaints: [],
        recent_donations: [],
        recent_audit: [],
      }));
    }

    const statusMatch = method === 'POST' ? bare.match(/^\/admin\/stores\/([^/]+)\/status$/) : null;
    if (statusMatch) {
      if (state.statusMode === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const body = route.request().postDataJSON?.() || {};
      const s = state.rows.find((x) => x.id === statusMatch[1]);
      if (s) {
        s.status = body.status;
        s.suspended_reason = body.status === 'suspended' ? (body.reason || null) : null;
      }
      return route.fulfill(ok({ id: statusMatch[1], status: body.status }));
    }

    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có'));
  };
  const stub = await stubAdmin(page, { api, ignoreStatuses });
  return { state, ...stub };
}

const screen = (page) => page.locator('[data-screen="stores"]');
const statusCalls = (calls) => calls.filter((c) => c.method === 'POST' && /^\/admin\/stores\/[^/]+\/status$/.test(c.path));

test('stores: tải từ /admin/stores, ô số KPI, bảng, nhãn Việt, không mã thô', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/stores`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(2);
  await expect(screen(page).locator('[data-kpi="active"]')).toContainText('2');
  await expect(screen(page).locator('[data-kpi="pending"]')).toContainText('1');
  await expect(screen(page).locator('[data-kpi="suspended"]')).toContainText('1');
  const text = await screen(page).innerText();
  expect(text).toContain('Tiệm Bánh Mẫu');
  expect(text).toContain('Quận 1');
  expect(text).toContain('4.8');
  expect(text).not.toContain('Sắp có');
  expect(text).not.toMatch(/undefined|null|\btrue\b|\bfalse\b|\bactive\b/);
  expect(calls.some((c) => c.path.startsWith('/admin/stores?') && c.path.includes('status=active'))).toBe(true);
  expect(errors).toEqual([]);
});

test('stores: tab chờ duyệt, tab tạm ngưng, tìm kiếm server, nút sang Duyệt hồ sơ', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/stores`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(2);
  await screen(page).locator('[data-role="search"]').fill('siêu thị');
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Siêu Thị Thử');
  await screen(page).locator('[data-role="search"]').fill('');
  await expect(screen(page).locator('tbody tr')).toHaveCount(2);

  await page.click('[data-act="tab"][data-tab="suspended"]');
  await expect(page).toHaveURL(/#\/stores\?tab=suspended/);
  await expect(screen(page)).toContainText('Bếp Tạm Ngưng');

  await page.click('[data-act="tab"][data-tab="pending"]');
  await expect(page).toHaveURL(/#\/stores\?tab=pending/);
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Quán Chờ Duyệt');
  await screen(page).locator('[data-act="go-verify"]').click();
  await expect(page).toHaveURL(/#\/verify/);
  expect(errors).toEqual([]);
});

test('stores: drawer 360° gồm ví, giấy tờ đã che, uy tín, đơn gần nhất + tạm ngưng/mở bán lại', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/stores`);
  await screen(page).locator(`[data-act="open"][data-id="${S1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Tiệm Bánh Mẫu');
  await expect(drawer).toContainText('1 Lê Lợi');
  await expect(drawer).toContainText('1.300.000đ');
  await expect(drawer).toContainText('••••••5678');
  await expect(drawer).toContainText('87');
  await expect(drawer).toContainText('Bị hạn chế');
  await expect(drawer).toContainText('FS-1001');
  await expect(drawer).toContainText('Hoàn thành');
  await expect(drawer).toContainText('125.000đ');
  await expect(drawer).toContainText('Khách vắng mặt');
  const dtext = await drawer.innerText();
  expect(dtext).not.toMatch(/Restricted|no_show|completed|undefined|null/);

  // Tạm ngưng bán: yêu cầu lý do ≥ 3 ký tự
  await drawer.locator('[data-act="store-status"][data-status="suspended"]').click();
  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('Vi phạm đóng gói');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã tạm ngưng cửa hàng');
  expect(statusCalls(calls)[0]).toMatchObject({ method: 'POST', path: `/admin/stores/${S1}/status`, body: { status: 'suspended', reason: 'Vi phạm đóng gói' } });

  // Mở bán lại (vì is_verified = true)
  await expect(drawer.locator('[data-act="store-status"][data-status="active"]')).toBeVisible();
  await drawer.locator('[data-act="store-status"][data-status="active"]').click();
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã mở bán lại cửa hàng');
  expect(statusCalls(calls)[1]).toMatchObject({ method: 'POST', path: `/admin/stores/${S1}/status`, body: { status: 'active' } });
  expect(errors).toEqual([]);
});

test('stores: API lỗi 500 → hiện lỗi có nút Thử lại; dữ liệu độc được escape (XSS); deep-link #/stores?id=', async ({ page }) => {
  const { state, errors } = await setup(page, { listMode: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/stores`);
  await expect(page.locator('[data-role="retry"]').first()).toBeVisible();
  state.listMode = 'ok';
  state.rows[0].name = '<img src=x onerror="window.__xss=1">';
  await page.locator('[data-role="retry"]').first().click();
  await expect(screen(page).locator('tbody tr')).toHaveCount(2);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  await page.goto(`${PAGE}#/stores?id=${S3}`);
  await expect(page.locator('#drawer [data-role="store"]')).toContainText('Bếp Tạm Ngưng');
  expect(errors).toEqual([]);
});

test('stores: ?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.addInitScript(() => { window.__FAKE_SB = { noSession: true }; });
  await page.goto(`${PAGE}?demo=1#/stores`);
  await expect(page.locator('.v2demo')).toBeVisible();
  await expect(screen(page).locator('tbody tr').first()).toBeVisible();
  expect(demo.stores.length).toBeGreaterThan(0);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
