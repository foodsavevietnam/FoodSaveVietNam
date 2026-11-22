import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import * as demo from '../../public/admin/demo/fixtures/customers.js';

// Màn "Người mua" của cổng quản trị mới. Auth Supabase và API đều được stub.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };
const DAY = 86400000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

const C1 = '11111111-aaaa-4aaa-8aaa-000000000001';
const C2 = '22222222-aaaa-4aaa-8aaa-000000000002';
const C3 = '33333333-aaaa-4aaa-8aaa-000000000003';
const buyers = () => [
  { id: C1, full_name: 'Lê Thị Khóa', email: 'khoa@example.test', phone: '0901234567', status: 'active', provider: 'google', points: 20, rank: 'Chặn', red_ban_until: iso(3 * DAY), created_at: iso(-90 * DAY), last_sign_in_at: iso(-1 * DAY), orders_total: 5, orders_completed: 1, orders_cancelled: 3 },
  { id: C2, full_name: 'Trần Văn Tạm', email: 'tam@example.test', phone: '0912345678', status: 'suspended', provider: 'phone', points: 60, rank: 'Hạn chế', red_ban_until: null, created_at: iso(-2 * DAY), last_sign_in_at: null, orders_total: 0, orders_completed: 0, orders_cancelled: 0 },
  { id: C3, full_name: 'Phạm Thu Hà', email: 'ha@example.test', phone: '0987654321', status: 'active', provider: 'email', points: 90, rank: 'Tin cậy', red_ban_until: null, created_at: iso(-60 * DAY), last_sign_in_at: iso(-5 * DAY), orders_total: 12, orders_completed: 11, orders_cancelled: 0 },
];

async function setup(page, { users = 'ok', unlock = 'ok', ignoreStatuses = [] } = {}) {
  const state = { users, unlock, unlocked: false, usersCalls: 0, workCalls: 0 };
  const api = async (route, { path }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') { state.workCalls += 1; return route.fulfill(ok({})); }
    if (bare === '/admin/users') {
      state.usersCalls += 1;
      if (state.users === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const list = buyers().map((b) => (b.id === C1 && state.unlocked ? { ...b, red_ban_until: null } : b));
      return route.fulfill(ok({ counts: { customers: 3, partners: 1, charities: 0, volunteers: 0, admins: 1, stores: 1 }, buyers: list }));
    }
    if (/^\/admin\/customers\/[^/]+\/unlock$/.test(bare)) {
      if (state.unlock === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      state.unlocked = true;
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

test('customers: tải dữ liệu thật, ô số, bảng, SĐT che, nhãn Việt, không mã thô', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(3);
  await expect(screen(page).locator('[data-kpi="total"]')).toContainText('3');
  await expect(screen(page).locator('[data-kpi="locked"]')).toContainText('1');
  await expect(screen(page).locator('[data-kpi="suspended"]')).toContainText('1');
  await expect(screen(page).locator('[data-kpi="new7"]')).toContainText('1');
  const text = await screen(page).innerText();
  expect(text).toContain('Lê Thị Khóa');
  expect(text).toContain('khoa@example.test');
  expect(text).toContain('090***567');
  expect(text).not.toContain('0901234567');
  expect(text).toContain('Google');
  expect(text).toContain('Tin cậy');
  expect(text).not.toMatch(/suspended|\bgoogle\b|\bphone\b|\bactive\b|undefined|null/);
  expect(errors).toEqual([]);
});

test('customers: tab lọc qua hash và ô tìm kiếm', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(3);
  await page.click('[data-act="tab"][data-tab="locked"]');
  await expect(page).toHaveURL(/#\/customers\?tab=locked/);
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Lê Thị Khóa');
  await page.click('[data-act="tab"][data-tab="suspended"]');
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Trần Văn Tạm');
  await page.click('[data-act="tab"][data-tab="all"]');
  await expect(screen(page).locator('tbody tr')).toHaveCount(3);
  await screen(page).locator('[data-role="search"]').fill('ha@example');
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  await expect(screen(page)).toContainText('Phạm Thu Hà');
  await screen(page).locator('[data-role="search"]').fill('0912345');
  await expect(screen(page)).toContainText('Trần Văn Tạm');
  await screen(page).locator('[data-role="search"]').fill('không có ai tên này');
  await expect(screen(page)).toContainText('Không có người mua phù hợp');
  expect(errors).toEqual([]);
});

test('customers: drawer hồ sơ + mở khóa nhãn đỏ gửi đúng POST sau confirm', async ({ page }) => {
  const { state, calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  await openRow(page, C1).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Lê Thị Khóa');
  await expect(drawer).toContainText('0901234567');
  await expect(drawer).toContainText('Khóa nhãn đỏ');
  await expect(drawer).toContainText('Đơn hoàn thành');
  await expect(drawer.locator('button:disabled', { hasText: 'Khóa / mở tài khoản' })).toBeVisible();
  const before = state.usersCalls;
  const workBefore = state.workCalls;
  await drawer.locator('[data-act="unlock"]').click();
  await expect(page.locator('#modal [data-role="reason"]')).toBeVisible();
  await page.locator('#modal [data-role="reason"]').fill('Khách đã giải trình');
  await page.locator('#modal [data-role="ok"]').click();
  await expect.poll(() => unlockCalls(calls).length).toBe(1);
  expect(unlockCalls(calls)[0]).toMatchObject({ method: 'POST', path: `/admin/customers/${C1}/unlock`, body: { note: 'Khách đã giải trình' } });
  await expect(page.locator('#toasts')).toContainText('Đã mở khóa');
  await expect.poll(() => state.usersCalls).toBeGreaterThan(before);
  await expect.poll(() => state.workCalls).toBeGreaterThan(workBefore);
  await expect(screen(page).locator('[data-kpi="locked"]')).toContainText('0');
  expect(errors).toEqual([]);
});

test('customers: hủy confirm thì không gọi API; người không bị khóa không có nút mở khóa', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  await openRow(page, C1).click();
  await page.locator('#drawer [data-act="unlock"]').click();
  await page.locator('#modal [data-role="cancel"]').click();
  expect(unlockCalls(calls)).toHaveLength(0);
  await page.locator('#drawer [data-role="drawer-close"]').click();
  await openRow(page, C3).click();
  await expect(page.locator('#drawer')).toContainText('Phạm Thu Hà');
  await expect(page.locator('#drawer [data-act="unlock"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('customers: mở khóa lỗi 500 → toast lỗi', async ({ page }) => {
  const { calls, errors } = await setup(page, { unlock: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/customers`);
  await openRow(page, C1).click();
  await page.locator('#drawer [data-act="unlock"]').click();
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Lỗi máy chủ');
  expect(unlockCalls(calls)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('customers: API lỗi 500 → hiện lỗi có nút Thử lại', async ({ page }) => {
  const { state, errors } = await setup(page, { users: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/customers`);
  await expect(page.locator('[data-role="retry"]').first()).toBeVisible();
  state.users = 'ok';
  await page.locator('[data-role="retry"]').first().click();
  await expect(screen(page).locator('tbody tr')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('customers: dữ liệu độc không chạy script (escape)', async ({ page }) => {
  const { errors } = await setup(page);
  await page.route('**/api/v1/admin/users', (route) => route.fulfill(ok({ counts: {}, buyers: [{ ...buyers()[2], full_name: '<img src=x onerror="window.__xss=1">' }] })));
  await page.goto(`${PAGE}#/customers`);
  await expect(screen(page).locator('tbody tr')).toHaveCount(1);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('customers: ?demo=1 mở được màn, không gọi /api/v1', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.addInitScript(() => { window.__FAKE_SB = { noSession: true }; });
  await page.goto(`${PAGE}?demo=1#/customers`);
  await expect(page.locator('.v2demo')).toBeVisible();
  await expect(screen(page).locator('tbody tr').first()).toBeVisible();
  expect(demo.routes['GET /admin/users'].buyers.length).toBeGreaterThan(0);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('customers: #/customers?id=<id> mở thẳng hồ sơ; id lạ → thông báo', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/customers?id=${C1}`);
  await expect(page.locator('#drawer')).toContainText('Lê Thị Khóa');
  await expect(page.locator('#drawer [data-act="unlock"]')).toBeVisible();
  await page.goto(`${PAGE}#/customers?id=99999999-aaaa-4aaa-8aaa-000000000009`);
  await expect(screen(page).locator('[data-role="notice"]')).toContainText('Không tìm thấy người mua này trong 500 tài khoản mới nhất');
  await expect(page.locator('#drawer [data-role="profile"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('customers: mở drawer nhiều lần rồi Mở khóa → đúng 1 POST', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  for (const id of [C1, C3, C1]) {
    await openRow(page, id).click();
    await page.locator('#drawer [data-role="drawer-close"]').click();
  }
  await openRow(page, C1).click();
  await page.locator('#drawer [data-act="unlock"]').click();
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã mở khóa');
  expect(unlockCalls(calls)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('customers: đổi tab rồi Mở khóa → đúng 1 POST', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/customers`);
  await page.click('[data-act="tab"][data-tab="suspended"]');
  await page.click('[data-act="tab"][data-tab="locked"]');
  await openRow(page, C1).click();
  await page.locator('#drawer [data-act="unlock"]').click();
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã mở khóa');
  expect(unlockCalls(calls)).toHaveLength(1);
  expect(errors).toEqual([]);
});
