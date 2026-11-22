import { expect, test } from '@playwright/test';

// Task 5: nối FoodSaveLocation vào trang người mua (WEB + APP) và trang cửa hàng.
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const HCM = { latitude: 10.7769, longitude: 106.7009, accuracy: 20 };
// Lựa chọn gắn với tài khoản (actor) đang đăng nhập: buyerSession dùng profile id 'u1'
const CONSENT = JSON.stringify({ choice: 'granted', version: '2026-11-22', at: 1, actor: 'customer:u1', pending: false });

const ok = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

function paidOrder(overrides = {}) {
  return {
    id: ORDER_ID, order_number: 'MIO-1001', status: 'confirmed', payment_status: 'paid',
    created_at: '2026-11-22T01:00:00Z', store_id: 's1', stores: { name: 'Tiệm thử', latitude: 10.78, longitude: 106.69 },
    order_items: [], total_cents: 5000000, ...overrides,
  };
}

// Stub toàn bộ API; trả lại danh sách request để kiểm tra.
// calls.state.orders: mảng đơn trả về; calls.state.failOrders = true thì GET /orders trả 500 (đổi được giữa chừng).
async function stubApi(page, { orders = [], etaBody = null } = {}) {
  const calls = [];
  calls.state = { orders, failOrders: false };
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    calls.push({ method: request.method(), path, body, auth: request.headers().authorization });
    if (path.startsWith('/location')) return route.fulfill(ok({ stored: true, throttled: false }));
    if (path === '/orders') {
      if (calls.state.failOrders) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'Lỗi' } }) });
      return route.fulfill(ok({ items: calls.state.orders }));
    }
    if (/\/customer-eta$/.test(path)) return route.fulfill(ok(etaBody || { distance_km: null, eta_minutes: null, updated_at: null }));
    return route.fulfill(ok({ items: [] }));
  });
  return calls;
}

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

async function buyerSession(page) {
  await page.addInitScript(consent => {
    localStorage.setItem('foodsave.auth.session.customer', JSON.stringify({
      role: 'customer', accessToken: 'test-token', profile: { id: 'u1', full_name: 'Khách thử', email: 'a@b.vn' },
    }));
    localStorage.setItem('mio.location.consent.v1', consent);
  }, CONSENT);
}

const locationPosts = calls => calls.filter(c => c.method === 'POST' && c.path === '/location');

for (const file of ['FOODSAVE_USER.html', 'FOODSAVE_APP.html']) {
  test(`${file}: nạp FoodSaveLocation không lỗi JS khi chưa đăng nhập`, async ({ page }) => {
    const errors = trackErrors(page);
    await stubApi(page);
    await page.goto('/' + file);
    await expect.poll(() => page.evaluate(() => typeof window.FoodSaveLocation)).toBe('object');
    await page.waitForTimeout(800);
    expect(errors).toEqual([]);
  });

  test(`${file}: có đơn đã thanh toán thì gửi POST /location`, async ({ page, context }) => {
    const errors = trackErrors(page);
    await buyerSession(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HCM);
    const calls = await stubApi(page, { orders: [paidOrder()] });
    await page.goto('/' + file);
    await expect.poll(() => locationPosts(calls).length, { timeout: 15000 }).toBeGreaterThan(0);
    const sent = locationPosts(calls)[0];
    expect(sent.body.context).toEqual({ kind: 'order', id: ORDER_ID });
    expect(sent.auth).toBe('Bearer test-token');
    expect(errors).toEqual([]);
  });

  test(`${file}: đơn chưa thanh toán thì không theo dõi`, async ({ page, context }) => {
    await buyerSession(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HCM);
    const calls = await stubApi(page, { orders: [paidOrder({ payment_status: 'unpaid', status: 'awaiting_payment' })] });
    await page.goto('/' + file);
    await page.waitForTimeout(2500);
    expect(locationPosts(calls)).toHaveLength(0);
  });

  test(`${file}: không có geolocation và localStorage bị chặn vẫn không lỗi`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
    });
    await stubApi(page, { orders: [paidOrder()] });
    await page.goto('/' + file);
    await page.waitForTimeout(1500);
    expect(errors.filter(m => !/blocked/.test(m))).toEqual([]);
  });
}

test('FOODSAVE_USER.html: công tắc chia sẻ vị trí trong hồ sơ gọi setConsent', async ({ page, context }) => {
  const errors = trackErrors(page);
  await buyerSession(page);
  await page.addInitScript(() => localStorage.setItem('mio.location.consent.v1', JSON.stringify({ choice: 'later', version: '2026-11-22', at: 1, actor: 'customer:u1', pending: false })));
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  const calls = await stubApi(page);
  await page.goto('/FOODSAVE_USER.html');
  await page.evaluate(() => window.accTab && window.accTab('profile', document.querySelector('#page-account .side-link')));
  const toggle = page.locator('#loc-share-toggle');
  await expect(toggle).toHaveCount(1);
  await expect(toggle).not.toBeChecked();
  await toggle.evaluate(el => el.click());
  await expect.poll(() => calls.filter(c => c.path === '/location/consent').length).toBe(1);
  expect(calls.find(c => c.path === '/location/consent').body.granted).toBe(true);
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('granted');
  await toggle.evaluate(el => el.click());
  await expect.poll(() => calls.filter(c => c.path === '/location/consent').length).toBe(2);
  expect(calls.filter(c => c.path === '/location/consent')[1].body.granted).toBe(false);
  expect(errors).toEqual([]);
});

test('FOODSAVE_USER.html: nút chỉ đường dùng directionsUrl, null khi cửa hàng không có tọa độ', async ({ page }) => {
  await page.goto('/FOODSAVE_USER.html');
  const result = await page.evaluate(() => ({
    withCoords: window.storeRouteUrl({ latitude: 10.78, longitude: 106.69 }),
    noCoords: window.storeRouteUrl({ name: 'x' }),
    zero: window.storeRouteUrl({ latitude: null, longitude: null }),
  }));
  expect(result.withCoords).toContain('https://www.google.com/maps/dir/?api=1&destination=10.78,106.69');
  expect(result.noCoords).toBeNull();
  expect(result.zero).toBeNull();
});

test('FOODSAVE_PARTNER.html: nạp FoodSaveLocation không lỗi JS', async ({ page }) => {
  const errors = trackErrors(page);
  await stubApi(page);
  await page.goto('/FOODSAVE_PARTNER.html');
  await expect.poll(() => page.evaluate(() => typeof window.FoodSaveLocation)).toBe('object');
  await page.waitForTimeout(800);
  expect(errors).toEqual([]);
});

test('FOODSAVE_PARTNER.html: dòng "Khách cách ~X km" từ ETA, rỗng khi null', async ({ page }) => {
  const errors = trackErrors(page);
  await stubApi(page);
  await page.goto('/FOODSAVE_PARTNER.html');
  await expect.poll(() => page.evaluate(() => typeof window.partnerOrderEtaHtml)).toBe('function');
  const updated = new Date(Date.now() - 3 * 60000).toISOString();
  const html = await page.evaluate(iso => window.partnerOrderEtaHtml({ distance_km: 2.46, eta_minutes: 9, updated_at: iso }), updated);
  expect(html).toContain('Khách cách ~2,5 km');
  expect(html).toContain('cập nhật 3 phút trước');
  const hidden = await page.evaluate(() => window.partnerOrderEtaHtml({ distance_km: null, eta_minutes: null, updated_at: null }));
  expect(hidden).toBe('');
  expect(errors).toEqual([]);
});

// Trang cửa hàng chỉ nạp mio-demo-mode.js khi có ?demo=1: mặc định chạy đường API thật.
async function openPartnerOrderDetail(page, etaBody, { clock = false } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('foodsave.auth.session.partner', JSON.stringify({ role: 'partner', accessToken: 'test-token', profile: { id: 'p1', full_name: 'Chủ quán' }, context: { store: { id: 's1', name: 'Tiệm thử' } } }));
  });
  const calls = await stubApi(page, { orders: [paidOrder()], etaBody });
  if (clock) await page.clock.install();
  await page.goto('/FOODSAVE_PARTNER.html');
  // Đợi danh sách đơn thật nạp xong, rồi mở chi tiết đơn bằng đường render thật (ordDetail).
  await expect.poll(() => page.evaluate(() => ORD.length)).toBeGreaterThan(0);
  await page.evaluate(() => { pg = 'orders'; selO = 0; oP = ORD[0].st; R(); });
  return calls;
}
const etaCalls = calls => calls.filter(c => c.method === 'GET' && c.path === `/partner/orders/${ORDER_ID}/customer-eta`);

test('FOODSAVE_PARTNER.html: chi tiết đơn (render thật) gọi customer-eta và hiện dòng khách cách', async ({ page }) => {
  const errors = trackErrors(page);
  const updated = new Date(Date.now() - 2 * 60000).toISOString();
  const calls = await openPartnerOrderDetail(page, { distance_km: 1.2, eta_minutes: 5, updated_at: updated });
  await expect(page.locator('#order-eta-box')).toContainText('Khách cách ~1,2 km');
  await expect(page.locator('#order-eta-box')).toContainText('cập nhật 2 phút trước');
  expect(etaCalls(calls)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('FOODSAVE_PARTNER.html: ETA null thì ô khách cách bị ẩn', async ({ page }) => {
  const calls = await openPartnerOrderDetail(page, { distance_km: null, eta_minutes: null, updated_at: null });
  await expect.poll(() => etaCalls(calls).length).toBe(1);
  await expect(page.locator('#order-eta-box')).toBeHidden();
});

// Nhịp ETA giãn 120 giây (hạn mức Netlify: cả tab cửa hàng ≤ 6 lượt gọi/phút), chạy qua lịch chung FS.poll.
// page.clock.runFor chạy từng nhịp hẹn giờ (fastForward chỉ chạy dồn một lần); bấm phím giữ cho trang không bị coi là bỏ không.
test('FOODSAVE_PARTNER.html: ETA làm mới mỗi 120 giây khi mở chi tiết đơn, dừng khi rời', async ({ page }) => {
  const updated = new Date().toISOString();
  const calls = await openPartnerOrderDetail(page, { distance_km: 1.2, eta_minutes: 5, updated_at: updated }, { clock: true });
  await expect.poll(() => etaCalls(calls).length).toBe(1);
  await page.keyboard.press('Shift');
  await page.clock.runFor(61000);
  await page.waitForTimeout(300);
  expect(etaCalls(calls)).toHaveLength(1);
  await page.keyboard.press('Shift');
  await page.clock.runFor(65000);
  await expect.poll(() => etaCalls(calls).length).toBe(2);
  await page.evaluate(() => { selO = null; R(); });
  await page.clock.runFor(250000);
  await page.waitForTimeout(300);
  expect(etaCalls(calls)).toHaveLength(2);
});

test('FOODSAVE_PARTNER.html: form sửa địa chỉ có nút "Dùng vị trí hiện tại"', async ({ page }) => {
  await stubApi(page);
  await page.goto('/FOODSAVE_PARTNER.html');
  const src = await page.evaluate(() => String(window.editStoreAddress));
  expect(src).toContain('Dùng vị trí hiện tại');
});

// ---------- Dừng theo dõi (quan trọng về quyền riêng tư) ----------
const deletes = calls => calls.filter(c => c.method === 'DELETE' && c.path === '/location');
const tracking = page => page.evaluate(() => window.FoodSaveLocation._isTracking());
const OLD_ID = '33333333-3333-4333-8333-333333333333';

async function startTracking(page, context, orders) {
  await buyerSession(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  return stubApi(page, { orders });
}

for (const file of ['FOODSAVE_USER.html', 'FOODSAVE_APP.html']) {
  test(`${file}: đơn đã thanh toán rồi hoàn tất ở lần poll sau thì DELETE /location và ngừng theo dõi`, async ({ page, context }) => {
    const errors = trackErrors(page);
    const calls = await startTracking(page, context, [paidOrder()]);
    await page.goto('/' + file);
    await expect.poll(() => locationPosts(calls).length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(await tracking(page)).toBe(true);
    calls.state.orders = [paidOrder({ status: 'completed' })];
    await page.evaluate(() => window.FS.sync.refresh());
    await expect.poll(() => deletes(calls).length).toBe(1);
    expect(await tracking(page)).toBe(false);
    expect(errors).toEqual([]);
  });

  test(`${file}: đăng xuất thì DELETE /location và ngừng theo dõi`, async ({ page, context }) => {
    const calls = await startTracking(page, context, [paidOrder()]);
    await page.goto('/' + file);
    await expect.poll(() => locationPosts(calls).length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(await tracking(page)).toBe(true);
    await page.evaluate(() => (typeof window.doLogout === 'function' ? window.doLogout(true) : window.logout()));
    await expect.poll(() => deletes(calls).length).toBeGreaterThan(0);
    expect(deletes(calls)[0].auth).toBe('Bearer test-token');
    expect(await tracking(page)).toBe(false);
  });

  test(`${file}: hai đơn đủ điều kiện thì theo dõi đơn mới nhất`, async ({ page, context }) => {
    const calls = await startTracking(page, context, [
      paidOrder({ id: OLD_ID, order_number: 'MIO-0001', created_at: '2026-11-22T01:00:00Z' }),
      paidOrder({ id: ORDER_ID, order_number: 'MIO-0002', created_at: '2026-11-22T05:00:00Z' }),
    ]);
    await page.goto('/' + file);
    await expect.poll(() => locationPosts(calls).length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(locationPosts(calls)[0].body.context).toEqual({ kind: 'order', id: ORDER_ID });
    expect(locationPosts(calls).every(c => c.body.context.id === ORDER_ID)).toBe(true);
  });

  test(`${file}: tải đơn lỗi 500 lúc đang theo dõi thì không DELETE, vẫn theo dõi`, async ({ page, context }) => {
    const calls = await startTracking(page, context, [paidOrder()]);
    await page.goto('/' + file);
    await expect.poll(() => locationPosts(calls).length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(await tracking(page)).toBe(true);
    calls.state.failOrders = true;
    await page.evaluate(() => window.FS.sync.refresh().catch(() => {}));
    await page.waitForTimeout(500);
    expect(deletes(calls)).toHaveLength(0);
    expect(await tracking(page)).toBe(true);
    // Tải lại thành công và hết đơn thật sự thì mới dừng.
    calls.state.failOrders = false;
    calls.state.orders = [];
    await page.evaluate(() => window.FS.sync.refresh());
    await expect.poll(() => deletes(calls).length).toBe(1);
    expect(await tracking(page)).toBe(false);
  });
}
