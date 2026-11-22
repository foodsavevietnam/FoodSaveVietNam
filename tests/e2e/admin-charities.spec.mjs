import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import verify from '../../public/admin/demo/fixtures/verify.js';

// Màn "Tổ chức & tình nguyện viên" (#/charities): chỉ đọc. Auth Supabase và API đều được stub.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const CH1 = 'aaaa1111-0000-4000-8000-000000000001';
const CH2 = 'bbbb2222-0000-4000-8000-000000000002';
const DONATIONS = {
  items: [
    { id: 'd1', status: 'completed', charity_id: CH1, pickup_code: 'MA-BI-MAT-99', created_at: '2026-11-22T03:00:00.000Z', charity_profiles: { id: CH1, name: 'Quỹ Bếp Thử Một' } },
    { id: 'd2', status: 'in_route', charity_id: CH1, pickup_code: 'MA-BI-MAT-98', created_at: '2026-11-23T03:00:00.000Z', charity_profiles: { id: CH1, name: 'Quỹ Bếp Thử Một' } },
    { id: 'd3', status: 'accepted', charity_id: CH2, pickup_code: null, created_at: '2026-11-21T03:00:00.000Z', charity_profiles: { id: CH2, name: 'Nhóm Thiện Nguyện Hai' } },
    { id: 'd4', status: 'open', charity_id: null, pickup_code: null, created_at: '2026-11-23T04:00:00.000Z', charity_profiles: null },
  ],
  pagination: { page: 1, limit: 100, total: 4 },
};
const VOLUNTEERS = [
  { id: 'v1', charity_id: CH1, full_name: 'Lê Tình Nguyện', phone: '0987654321', role: 'Tinh nguyen vien', duty_role: 'pickup', status: 'active', runs: 7, kg_collected: '42.50' },
  { id: 'v2', charity_id: CH1, full_name: 'Phạm Nghỉ Phép', phone: '0911222333', role: 'Tinh nguyen vien', duty_role: 'both', status: 'inactive', runs: 0, kg_collected: '0' },
];
const LIVE = [
  { actor_kind: 'volunteer', actor_id: 'v1', name: 'Lê Tình Nguyện', context_kind: 'donation', context_id: 'd2', context_code: 'DN-0002', lat: 10.77, lng: 106.69, accuracy_m: 12, updated_at: '2026-11-23T08:00:00.000Z', destination: null, directions_url: 'https://www.google.com/maps/dir/?api=1&destination=10.7,106.6' },
  { actor_kind: 'volunteer', actor_id: 'v9', name: 'Link Xấu', context_kind: 'donation', context_id: 'd9', context_code: 'DN-0009', lat: 10, lng: 106, accuracy_m: null, updated_at: '2026-11-23T08:01:00.000Z', destination: null, directions_url: 'javascript:alert(1)' },
];

function makeApi(state = {}) {
  return async (route, { path }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok({}));
    if (bare === '/admin/verification') {
      if (state.verification === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok(verify));
    }
    if (bare === '/donations') return route.fulfill(ok(DONATIONS));
    if (/^\/charity\/profiles\/[^/]+\/volunteers$/.test(bare)) {
      if (state.volunteers === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok(state.volunteers === 'empty' ? [] : VOLUNTEERS));
    }
    if (bare === '/admin/live-locations') return route.fulfill(ok(LIVE));
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có ' + bare));
  };
}
async function setup(page, state = {}, opt = {}) {
  return stubAdmin(page, { api: makeApi(state), ...opt });
}

test('tab đang hoạt động: suy ra tổ chức từ lô tặng, không lộ mã nhận hàng, không mã thô', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/charities`);
  const table = page.locator('[data-screen="charities"] [data-role="active-table"]');
  await expect(table).toContainText('Quỹ Bếp Thử Một');
  await expect(table).toContainText('Nhóm Thiện Nguyện Hai');
  const row = table.locator('tr', { hasText: 'Quỹ Bếp Thử Một' });
  await expect(row.locator('td').nth(1)).toHaveText('2');
  await expect(row.locator('td').nth(2)).toHaveText('1');
  await expect(page.locator('[data-screen="charities"]')).toContainText('tối đa 100 lô');
  const text = await page.locator('[data-screen="charities"]').innerText();
  expect(text).not.toContain('MA-BI-MAT');
  expect(text).not.toContain(CH1);
  expect(text).not.toMatch(/\b(completed|in_route|accepted)\b/);
  expect(calls.some((c) => c.path === '/donations?limit=100')).toBe(true);
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
  expect(errors).toEqual([]);
});

test('tab chờ duyệt: danh sách + nút dẫn #/verify', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/charities?tab=pending`);
  await expect(page.locator('[data-role="pending-table"]')).toContainText('Quỹ Bếp Yêu Thương');
  await page.locator('[data-act="to-verify"]').click();
  expect(await page.evaluate(() => location.hash)).toContain('#/verify');
  expect(errors).toEqual([]);
});

test('drawer tổ chức: liệt kê TNV với SĐT che', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/charities`);
  await page.locator(`[data-act="open"][data-id="${CH1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Lê Tình Nguyện');
  await expect(drawer).toContainText('098***321');
  await expect(drawer).not.toContainText('0987654321');
  await expect(drawer).toContainText('Lấy hàng');
  await expect(drawer).toContainText('Đang hoạt động');
  await expect(drawer).not.toContainText('inactive');
  expect(calls.some((c) => c.path === `/charity/profiles/${CH1}/volunteers`)).toBe(true);
  expect(errors).toEqual([]);
});

test('tab TNV đang làm nhiệm vụ: chỉ link https, có link bản đồ', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/charities?tab=volunteers`);
  const table = page.locator('[data-role="live-table"]');
  await expect(table).toContainText('DN-0002');
  await expect(table.locator('a[href^="https://"]')).toHaveCount(1);
  await expect(table.locator('a[href^="javascript"]')).toHaveCount(0);
  await expect(page.locator('[data-screen="charities"] a[href="#/tracking"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('API lỗi 500 → thông báo lỗi có nút Thử lại', async ({ page }) => {
  const state = { verification: 'error' };
  const { errors } = await setup(page, state, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/charities`);
  await expect(page.locator('[data-screen="charities"] [data-role="retry"]')).toBeVisible();
  state.verification = 'ok';
  await page.locator('[data-screen="charities"] [data-role="retry"]').click();
  await expect(page.locator('[data-role="active-table"]')).toContainText('Quỹ Bếp Thử Một');
  expect(errors).toEqual([]);
});

test('màn không có hành động ghi, có nhãn "Sắp có"', async ({ page }) => {
  const { errors, calls } = await setup(page);
  await page.goto(`${PAGE}#/charities`);
  await expect(page.locator('[data-role="active-table"]')).toBeVisible();
  await expect(page.locator('[data-screen="charities"]')).toContainText('Sắp có');
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  expect(errors).toEqual([]);
});

test('drawer tổ chức không có TNV → hiện câu trạng thái rỗng', async ({ page }) => {
  const { errors } = await setup(page, { volunteers: 'empty' });
  await page.goto(`${PAGE}#/charities`);
  await page.locator(`[data-act="open"][data-id="${CH1}"]`).click();
  await expect(page.locator('#drawer')).toContainText('Tổ chức này chưa có tình nguyện viên.');
  expect(errors).toEqual([]);
});

test('drawer tổ chức lỗi 500 → hiện thông báo lỗi', async ({ page }) => {
  const { errors } = await setup(page, { volunteers: 'error' }, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/charities`);
  await page.locator(`[data-act="open"][data-id="${CH1}"]`).click();
  await expect(page.locator('#drawer [role="alert"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page, {}, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/charities`);
  await expect(page.locator('[data-role="active-table"]')).toBeVisible();
  await expect(page.locator('[data-role="active-table"] tbody tr').first()).toBeVisible();
  await page.goto(`${PAGE}?demo=1#/charities?tab=volunteers`);
  await expect(page.locator('[data-role="live-table"]')).toBeVisible();
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
