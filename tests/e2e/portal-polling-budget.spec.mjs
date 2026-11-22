import { expect, test } from '@playwright/test';

// Hạn mức Netlify (125k lượt gọi function/tháng): một tab cửa hàng / tổ chức để mở phải tốn ≤ 6 lượt gọi API/phút
// khi người dùng đang thao tác, và ~0 khi không thao tác 15 phút. Đếm mọi request /api/v1 bằng page.route, thời gian giả bằng page.clock.
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const DONATION_ID = '55555555-5555-4555-8555-555555555555';
const MIN = 60000;
const PAUSED_TEXT = 'Đã tạm dừng cập nhật — chạm để tiếp tục';

const ok = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

function paidOrder() {
  return {
    id: ORDER_ID, order_number: 'MIO-1001', status: 'confirmed', payment_status: 'paid',
    created_at: '2026-11-22T01:00:00Z', store_id: 's1', stores: { name: 'Tiệm thử', latitude: 10.78, longitude: 106.69 },
    order_items: [], total_cents: 5000000,
  };
}

function donation() {
  return {
    id: DONATION_ID, donation_code: 'DN-1001', status: 'pending', store_id: 's1', charity_id: 'c1',
    created_at: '2026-11-22T01:00:00Z', stores: { name: 'Tiệm thử' }, donation_items: [],
  };
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function stubApi(page, { orders = [], donations = [] } = {}) {
  const calls = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');
    calls.push({ method: request.method(), path });
    if (path === '/orders') return route.fulfill(ok({ items: orders }));
    if (path === '/donations') return route.fulfill(ok({ items: donations }));
    if (/\/customer-eta$/.test(path)) return route.fulfill(ok({ distance_km: 1.2, eta_minutes: 5, updated_at: new Date().toISOString() }));
    if (/\/messages$/.test(path) && request.method() === 'GET') return route.fulfill(ok({ messages: [], can_send: true }));
    if (path === '/orders/chat/unread') return route.fulfill(ok({}));
    if (path === '/partner/products') return route.fulfill(ok({ products: [] }));
    if (path === '/orders/complaints/list') return route.fulfill(ok([]));
    return route.fulfill(ok({ items: [] }));
  });
  return calls;
}

// Cho request/response đang bay xử lý xong (thời gian thật, đồng hồ trang đứng yên)
const settle = page => page.waitForTimeout(60);

// Người dùng thao tác (phím Shift) rồi cho thời gian trôi; lặp lại tới hết khoảng thời gian
async function activeFor(page, ms, stepMs = 10000) {
  for (let t = 0; t < ms; t += stepMs) {
    await page.keyboard.press('Shift');
    await page.clock.runFor(stepMs);
    await settle(page);
  }
}

async function idleFor(page, ms, stepMs = MIN) {
  for (let t = 0; t < ms; t += stepMs) {
    await page.clock.runFor(stepMs);
    await settle(page);
  }
}

async function setVisibility(page, state) {
  await page.evaluate(s => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s !== 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function openPartnerOrder(page) {
  await page.addInitScript(() => {
    localStorage.setItem('foodsave.auth.session.partner', JSON.stringify({ role: 'partner', accessToken: 'test-token', profile: { id: 'p1', full_name: 'Chủ quán' }, context: { store: { id: 's1', name: 'Tiệm thử' } } }));
  });
  const calls = await stubApi(page, { orders: [paidOrder()] });
  await page.clock.install();
  await page.goto('/FOODSAVE_PARTNER.html');
  await expect.poll(() => page.evaluate(() => ORD.length)).toBeGreaterThan(0);
  await page.evaluate(() => { goView('portal'); pg = 'orders'; selO = 0; oP = ORD[0].st; R(); });
  await expect(page.locator('.v2-chat')).toBeVisible();
  // Lượt tải đầu (danh mục, thống kê, sản phẩm…) không tính vào ngân sách theo phút
  await activeFor(page, 10000, 5000);
  return calls;
}

async function openCharity(page) {
  await page.addInitScript(() => {
    localStorage.setItem('foodsave.auth.session.charity', JSON.stringify({ role: 'charity', accessToken: 'char-token', profile: { id: 'c1', full_name: 'Tổ chức thử' }, context: { charity: { id: 'c1', name: 'Mái ấm A' } } }));
  });
  const calls = await stubApi(page, { donations: [donation()] });
  await page.clock.install();
  await page.goto('/FOODSAVE_CHARITY.html');
  await expect.poll(() => calls.filter(c => c.path === '/donations').length).toBeGreaterThan(0);
  await page.evaluate(() => { goView('portal'); go('inbox'); });
  await activeFor(page, 10000, 5000);
  return calls;
}

const count = (calls, from, re) => calls.slice(from).filter(c => re.test(c.path)).length;

test('FOODSAVE_PARTNER.html: mở chi tiết đơn, có thao tác 5 phút → ≤ 30 lượt gọi API; chat 15 giây; không thao tác 20 phút → dừng hẳn; thao tác lại → làm mới ngay', async ({ page }) => {
  const errors = trackErrors(page);
  const calls = await openPartnerOrder(page);

  const start = calls.length;
  await activeFor(page, 5 * MIN);
  const used = calls.length - start;
  test.info().annotations.push({ type: "ngân sách", description: `cửa hàng, chi tiết đơn mở, 5 phút có thao tác: ${used} lượt gọi API (${(used / 5).toFixed(1)}/phút)` });
  expect(used).toBeLessThanOrEqual(30);
  expect(count(calls, start, /\/messages$/)).toBeGreaterThanOrEqual(15);   // chat vẫn cập nhật ~15 giây/lần
  expect(count(calls, start, /^\/orders$/)).toBeGreaterThanOrEqual(4);     // đơn mới vẫn được kéo về mỗi phút

  // Không thao tác: sau mốc 15 phút không còn lượt gọi nào, hiện thông báo tạm dừng
  await idleFor(page, 16 * MIN);
  const afterGate = calls.length;
  await idleFor(page, 4 * MIN);
  // Cửa hàng rảnh vẫn kiểm tra đơn 5 phút/lần (chỉ endpoint đơn); không còn lượt gọi nào khác
  expect(calls.slice(afterGate).filter(c => c.path !== '/orders')).toEqual([]);
  expect(count(calls, afterGate, /^\/orders$/)).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-poll-paused]')).toBeVisible();
  await expect(page.locator('[data-poll-paused]')).toContainText(PAUSED_TEXT);

  // Thao tác lại: làm mới ngay (không cần chờ nhịp kế tiếp), thông báo biến mất
  const beforeResume = count(calls, 0, /^\/orders$/);
  await page.keyboard.press('Shift');
  await expect.poll(() => count(calls, 0, /^\/orders$/)).toBeGreaterThan(beforeResume);
  await expect(page.locator('[data-poll-paused]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('FOODSAVE_PARTNER.html: tab ẩn thì không gọi API; hiện lại thì làm mới một lần', async ({ page }) => {
  const calls = await openPartnerOrder(page);
  await setVisibility(page, 'hidden');
  await settle(page);
  const hiddenAt = calls.length;
  await activeFor(page, 5 * MIN);
  expect(calls.length).toBe(hiddenAt);
  await setVisibility(page, 'visible');
  await expect.poll(() => count(calls, hiddenAt, /^\/orders$/)).toBe(1);
  await page.clock.runFor(3000);
  await settle(page);
  expect(count(calls, hiddenAt, /^\/orders$/)).toBe(1);
});

test('FOODSAVE_CHARITY.html: có thao tác 5 phút → ≤ 30 lượt gọi API; không thao tác 20 phút → dừng hẳn; thao tác lại → làm mới ngay', async ({ page }) => {
  const errors = trackErrors(page);
  const calls = await openCharity(page);

  const start = calls.length;
  await activeFor(page, 5 * MIN);
  const used = calls.length - start;
  test.info().annotations.push({ type: "ngân sách", description: `tổ chức, 5 phút có thao tác: ${used} lượt gọi API (${(used / 5).toFixed(1)}/phút)` });
  expect(used).toBeLessThanOrEqual(30);
  expect(count(calls, start, /^\/donations$/)).toBeGreaterThanOrEqual(4);

  await idleFor(page, 16 * MIN);
  const afterGate = calls.length;
  await idleFor(page, 4 * MIN);
  expect(calls.length).toBe(afterGate);
  await expect(page.locator('[data-poll-paused]')).toContainText(PAUSED_TEXT);

  const beforeResume = count(calls, 0, /^\/donations$/);
  await page.locator('[data-poll-paused]').click();
  await expect.poll(() => count(calls, 0, /^\/donations$/)).toBeGreaterThan(beforeResume);
  await expect(page.locator('[data-poll-paused]')).toBeHidden();
  expect(errors).toEqual([]);
});

for (const file of ['FOODSAVE_PARTNER.html', 'FOODSAVE_CHARITY.html']) {
  test(`${file}?demo=1: không gọi API, không hiện thông báo tạm dừng`, async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await stubApi(page, { orders: [paidOrder()], donations: [donation()] });
    await page.clock.install();
    await page.goto('/' + file + '?demo=1');
    await expect.poll(() => page.evaluate(() => Boolean(window.MIO_DEMO_MODE))).toBe(true);
    await activeFor(page, 2 * MIN);
    await idleFor(page, 17 * MIN);
    expect(calls).toHaveLength(0);
    await expect(page.locator('[data-poll-paused]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
