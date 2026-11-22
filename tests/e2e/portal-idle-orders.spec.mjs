import { expect, test } from '@playwright/test';

// Cửa hàng để tab hiện nhưng không thao tác > 15 phút: vẫn kiểm tra đơn mỗi 5 phút (chỉ endpoint đơn) và báo đơn mới qua tiêu đề tab.
const MIN = 60000;
const ok = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const order = (n, status = 'pending') => ({
  id: `22222222-2222-4222-8222-22222222222${n}`, order_number: `MIO-100${n}`, status, payment_status: 'paid',
  created_at: '2026-11-22T01:00:00Z', store_id: 's1', stores: { name: 'Tiệm thử', latitude: 10.78, longitude: 106.69 },
  order_items: [], total_cents: 5000000,
});

async function setup(page, orders) {
  await page.addInitScript(() => {
    localStorage.setItem('foodsave.auth.session.partner', JSON.stringify({ role: 'partner', accessToken: 'test-token', profile: { id: 'p1', full_name: 'Chủ quán' }, context: { store: { id: 's1', name: 'Tiệm thử' } } }));
  });
  const calls = [];
  const ctl = { failOrders: false };
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
    calls.push(path);
    if (path === '/orders' && ctl.failOrders) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false}' });
    if (path === '/orders') return route.fulfill(ok({ items: orders }));
    if (path === '/partner/products') return route.fulfill(ok({ products: [] }));
    return route.fulfill(ok({ items: [] }));
  });
  await page.clock.install();
  await page.goto('/FOODSAVE_PARTNER.html');
  await expect.poll(() => calls.filter(p => p === '/orders').length).toBeGreaterThan(0);
  await page.keyboard.press("Shift");
  await page.clock.runFor(10000);
  await page.waitForTimeout(300);
  calls.ctl = ctl;
  return calls;
}

const settle = page => page.waitForTimeout(80);
async function run(page, ms, step = MIN) {
  for (let t = 0; t < ms; t += step) { await page.clock.runFor(step); await settle(page); }
}
async function setVisibility(page, state) {
  await page.evaluate(s => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s !== 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

test('cửa hàng rảnh, tab hiện: chỉ gọi /orders ~5 phút/lần sau mốc 15 phút', async ({ page }) => {
  const calls = await setup(page, []);
  await run(page, 16 * MIN);
  const start = calls.length;
  await run(page, 20 * MIN);
  const added = calls.slice(start);
  expect(added.filter(p => p !== "/orders")).toEqual([]);
  expect(added.length).toBeGreaterThanOrEqual(3);
  expect(added.length).toBeLessThanOrEqual(4);
});

test('đơn mới lúc rảnh: tiêu đề "(1) Đơn mới – ", thao tác thì khôi phục', async ({ page }) => {
  const orders = [];
  const calls = await setup(page, orders);
  const original = await page.title();
  await run(page, 16 * MIN);
  orders.push(order(1));
  await run(page, 6 * MIN);
  await expect.poll(() => page.title()).toMatch(/^\(1\) Đơn mới – /);
  expect(await page.title()).toBe('(1) Đơn mới – ' + original);
  await page.keyboard.press('Shift');
  await expect.poll(() => page.title()).toBe(original);
});

test('tab ẩn: không gọi API', async ({ page }) => {
  const calls = await setup(page, []);
  await setVisibility(page, 'hidden');
  await settle(page);
  const start = calls.length;
  await run(page, 30 * MIN);
  expect(calls.length).toBe(start);
});

const toastCount = page => page.evaluate(() => window.__toasts || 0);
async function countToasts(page) {
  await page.evaluate(() => { window.__toasts = 0; const o = window.tst; window.tst = function (t) { if (/Có đơn hàng mới/.test(t)) window.__toasts++; return o.apply(this, arguments); }; });
}

test('lần tải đầu đã có đơn mới: không báo, tiêu đề giữ nguyên', async ({ page }) => {
  await setup(page, [order(1)]);
  expect(await page.title()).not.toMatch(/Đơn mới/);
});

test('đơn tăng 1 → 2: không lặp tiền tố; về 0 đơn mới thì khôi phục tiêu đề', async ({ page }) => {
  const orders = [order(1)];
  await setup(page, orders);
  const original = await page.title();
  await run(page, 16 * MIN);
  orders.unshift(order(2));
  await run(page, 5 * MIN);
  await expect.poll(() => page.title()).toBe('(2) Đơn mới – ' + original);
  orders.unshift(order(3));
  await run(page, 5 * MIN);
  await expect.poll(() => page.title()).toBe('(3) Đơn mới – ' + original);
  orders.length = 0;
  await run(page, 5 * MIN);
  await expect.poll(() => page.title()).toBe(original);
});

test('lỗi mạng khi kiểm tra rảnh: giữ tiêu đề, không báo giả khi dữ liệu trở lại', async ({ page }) => {
  const orders = [];
  const calls = await setup(page, orders);
  await countToasts(page);
  const original = await page.title();
  await run(page, 16 * MIN);
  orders.push(order(1));
  await run(page, 5 * MIN);
  await expect.poll(() => page.title()).toBe('(1) Đơn mới – ' + original);
  expect(await toastCount(page)).toBe(1);
  calls.ctl.failOrders = true;
  await run(page, 5 * MIN);
  expect(await page.title()).toBe('(1) Đơn mới – ' + original);
  calls.ctl.failOrders = false;
  await run(page, 5 * MIN);
  expect(await page.title()).toBe('(1) Đơn mới – ' + original);
  expect(await toastCount(page)).toBe(1);
});

test('đăng xuất / đổi cửa hàng: mốc đếm đơn được đặt lại', async ({ page }) => {
  const orders = [order(1)];
  await setup(page, orders);
  await page.evaluate(() => { window.goView('landing'); });
  expect(await page.evaluate(() => lastNewOrderCount)).toBeNull();
  // đổi cửa hàng (store_id khác) → coi như lần tải đầu, không báo
  await page.evaluate(() => { goView('portal'); });
  await countToasts(page);
  await page.evaluate(() => {
    const mk = (n, sid) => ({ id: 'x' + n, order_number: 'N' + n, status: 'pending', payment_status: 'paid', created_at: '2026-11-22T01:00:00Z', store_id: sid, stores: {}, order_items: [], total_cents: 1 });
    window.foodsaveOrdersIdleCheck([mk(1, 's1')]);
    window.foodsaveOrdersIdleCheck([mk(1, 's2'), mk(2, 's2')]);
  });
  expect(await toastCount(page)).toBe(0);
});

test('rảnh có đơn mới chèn lên đầu: bấm dòng đầu vẫn mở đúng đơn đang thấy', async ({ page }) => {
  const orders = [order(1)];
  await setup(page, orders);
  await page.evaluate(() => { goView('portal'); pg = 'orders'; selO = null; oP = 'new'; oLab = 'new'; R(); });
  await expect(page.locator('.v2-p .v2-row[onclick*="selO="]').first()).toBeVisible();
  const seenFirst = await page.evaluate(() => ORD[0].uuid);
  await run(page, 16 * MIN);
  orders.unshift(order(2));
  await run(page, 5 * MIN);
  await expect.poll(() => page.title()).toMatch(/^\(2\) Đơn mới/);
  await page.locator('.v2-p .v2-row[onclick*="selO="]').first().click();
  await page.clock.runFor(1000);
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => ORD[selO] && ORD[selO].uuid)).toBe(seenFirst);
});

test('thao tác ngay sau lần kiểm tra rảnh (< 10 giây): vẫn tải lại và vẽ danh sách mới', async ({ page }) => {
  const orders = [order(1)];
  const calls = await setup(page, orders);
  await page.evaluate(() => { goView('portal'); pg = 'orders'; selO = null; oP = 'new'; oLab = 'new'; R(); });
  await run(page, 16 * MIN);
  orders.unshift(order(2));
  await run(page, 5 * MIN);
  const before = calls.filter(p => p === '/orders').length;
  await page.keyboard.press('Shift');
  await expect.poll(() => calls.filter(p => p === '/orders').length).toBeGreaterThan(before);
  await expect.poll(() => page.locator('.v2-p .v2-row[onclick*="selO="]').count()).toBe(2);
});
