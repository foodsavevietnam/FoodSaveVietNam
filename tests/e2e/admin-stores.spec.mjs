import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import * as demo from '../../public/admin/demo/fixtures/stores.js';

// Màn "Cửa hàng" của cổng quản trị mới. Auth Supabase và API đều được stub.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };

const S1 = '51111111-bbbb-4bbb-8bbb-000000000001';
const S2 = '52222222-bbbb-4bbb-8bbb-000000000002';
const P1 = '53333333-bbbb-4bbb-8bbb-000000000003';
const store = (o) => ({ owner_id: 'o1', slug: 'x', emoji: '🥖', city: 'TP.HCM', district: 'Quận 1', rating: 4.5, is_verified: true, is_open: true, opening_hours: '07:00 - 21:00', status: 'active', created_at: '2026-10-01T03:00:00.000Z', service_tier: 'standard', ...o });
const stores = [
  store({ id: S1, name: 'Tiệm Bánh Mẫu', address: '1 Lê Lợi', rating: 4.8 }),
  store({ id: S2, name: 'Siêu Thị Thử', address: '2 Nguyễn Huệ', district: null, is_verified: false, rating: 3.9 }),
];
const pending = [{ userId: 'o9', profile: { id: 'o9', full_name: 'Chủ Chờ Duyệt', phone: '0900000001', status: 'pending' }, store: store({ id: P1, name: 'Quán Chờ Duyệt', address: '9 Hai Bà Trưng', status: 'pending', is_verified: false }) }];
const orders = [
  { id: 'abcdef12-0000-4000-8000-000000000001', order_number: 'FS-1001', status: 'completed', total_cents: 125000, created_at: '2026-11-22T05:00:00.000Z' },
  { id: 'abcdef12-0000-4000-8000-000000000002', order_number: 'FS-1002', status: 'no_show', total_cents: 40000, created_at: '2026-11-21T05:00:00.000Z' },
];

async function setup(page, { list = 'ok', rep = 'ok', ordersMode = 'ok', ignoreStatuses = [] } = {}) {
  const state = { list, rep, ordersMode };
  const api = async (route, { path }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok({}));
    if (bare === '/catalog/stores') {
      if (state.list === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok({ items: stores, pagination: { page: 1, limit: 100, total: stores.length, has_next_page: false } }));
    }
    if (bare === '/admin/pending-partners') {
      if (state.list === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok(pending));
    }
    if (/^\/seller-reputation\/[^/]+$/.test(bare)) {
      if (state.rep === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok({ seller_id: S1, trust_score: 87, rating_avg: 4.8, status: 'Restricted', restricted_until: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z' }));
    }
    if (bare === '/orders') {
      if (state.ordersMode === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok({ items: orders, pagination: { page: 1, limit: 10, total: 2, has_next_page: false } }));
    }
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có'));
  };
  const stub = await stubAdmin(page, { api, ignoreStatuses });
  return { state, ...stub };
}

const screen = (page) => page.locator('[data-screen="stores"]');

test('stores: tải dữ liệu thật, ô số, bảng, nhãn Việt, không mã thô', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/stores`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(2);
  await expect(screen(page).locator('[data-kpi="active"]')).toContainText('2');
  await expect(screen(page).locator('[data-kpi="pending"]')).toContainText('1');
  const text = await screen(page).innerText();
  expect(text).toContain('Tiệm Bánh Mẫu');
  expect(text).toContain('Quận 1');
  expect(text).toContain('4.8');
  expect(text).not.toMatch(/undefined|null|\btrue\b|\bfalse\b|\bactive\b/);
  expect(calls.some((c) => c.path === '/catalog/stores?limit=100')).toBe(true);
  expect(errors).toEqual([]);
});

test('stores: tab chờ duyệt, tìm kiếm, nút sang Duyệt hồ sơ', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/stores`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(2);
  await screen(page).locator('[data-role="search"]').fill('siêu thị');
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await screen(page).locator('[data-role="search"]').fill('lê lợi');
  await expect(screen(page)).toContainText('Tiệm Bánh Mẫu');
  await screen(page).locator('[data-role="search"]').fill('');
  await page.click('[data-act="tab"][data-tab="pending"]');
  await expect(page).toHaveURL(/#\/stores\?tab=pending/);
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Quán Chờ Duyệt');
  await expect(screen(page)).toContainText('Chủ Chờ Duyệt');
  await screen(page).locator('[data-act="go-verify"]').click();
  await expect(page).toHaveURL(/#\/verify/);
  expect(errors).toEqual([]);
});

test('stores: drawer chi tiết gồm uy tín và đơn gần nhất, không có nút ghi', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/stores`);
  await screen(page).locator(`[data-act="open"][data-id="${S1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Tiệm Bánh Mẫu');
  await expect(drawer).toContainText('1 Lê Lợi');
  await expect(drawer).toContainText('87');
  await expect(drawer).toContainText('Bị hạn chế');
  await expect(drawer).toContainText('FS-1001');
  await expect(drawer).toContainText('Hoàn thành');
  await expect(drawer).toContainText('125.000đ');
  await expect(drawer).toContainText('Khách vắng mặt');
  const dtext = await drawer.innerText();
  expect(dtext).not.toMatch(/Restricted|no_show|completed|undefined|null/);
  await expect(drawer.locator('button:disabled', { hasText: 'Tạm ngưng bán' })).toBeVisible();
  expect(calls.some((c) => c.path === `/seller-reputation/${S1}`)).toBe(true);
  expect(calls.some((c) => c.path.startsWith('/orders?') && c.path.includes('limit=10') && c.path.includes(`store_id=${S1}`))).toBe(true);
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  expect(errors).toEqual([]);
});

test('stores: uy tín và đơn lỗi → drawer vẫn mở, hiện "—"', async ({ page }) => {
  const { errors } = await setup(page, { rep: 'error', ordersMode: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/stores`);
  await screen(page).locator(`[data-act="open"][data-id="${S1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Tiệm Bánh Mẫu');
  await expect(drawer.locator('[data-role="reputation"]')).toContainText('—');
  await expect(drawer.locator('[data-role="orders"]')).toContainText('Không tải được');
  expect(errors).toEqual([]);
});

test('stores: API lỗi 500 → hiện lỗi có nút Thử lại', async ({ page }) => {
  const { state, errors } = await setup(page, { list: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/stores`);
  await expect(page.locator('[data-role="retry"]').first()).toBeVisible();
  state.list = 'ok';
  await page.locator('[data-role="retry"]').first().click();
  await expect(screen(page).locator('tbody tr')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('stores: ?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.addInitScript(() => { window.__FAKE_SB = { noSession: true }; });
  await page.goto(`${PAGE}?demo=1#/stores`);
  await expect(page.locator('.v2demo')).toBeVisible();
  await expect(screen(page).locator('tbody tr').first()).toBeVisible();
  expect(demo.routes['GET /catalog/stores'].items.length).toBeGreaterThan(0);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
