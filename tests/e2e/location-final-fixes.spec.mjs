import { expect, test } from '@playwright/test';

// Sửa sau review tổng: lựa chọn vị trí gắn với tài khoản, đăng xuất luôn xóa vị trí, rút lại khi mất mạng,
// 403 phiên TNV, nội dung hộp hỏi của cửa hàng/tổ chức, chế độ demo chỉ khi ?demo=1.
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const VOL_ID = '33333333-3333-4333-8333-333333333333';
const HCM = { latitude: 10.7769, longitude: 106.7009, accuracy: 20 };
const STORE_KEY = 'mio.location.consent.v1';
const consentFor = (actor, choice = 'granted') => JSON.stringify({ choice, version: '2026-11-22', at: 1, actor, pending: false });

const ok = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

function paidOrder(overrides = {}) {
  return {
    id: ORDER_ID, order_number: 'MIO-1001', status: 'confirmed', payment_status: 'paid',
    created_at: '2026-11-22T01:00:00Z', store_id: 's1', stores: { name: 'Tiệm thử', latitude: 10.78, longitude: 106.69 },
    order_items: [], total_cents: 5000000, ...overrides,
  };
}

// state.offline: request /location* lỗi mạng; state.me: fulfill cho /volunteer/me
async function stubApi(page, state = {}) {
  const calls = [];
  state.orders = state.orders || [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    calls.push({ method: request.method(), path, body, auth: request.headers().authorization, offline: Boolean(state.offline) });
    if (path.startsWith('/location')) {
      if (state.offline) return route.abort('internetdisconnected');
      return route.fulfill(ok({ stored: true, throttled: false }));
    }
    if (path === '/orders') return route.fulfill(ok({ items: state.orders }));
    if (path === '/volunteer/me') return route.fulfill(state.me || ok({ id: VOL_ID, full_name: 'TNV Thử', phone: '0901234567', charity_name: 'Mái ấm A', duty_role: 'both', active_today: true }));
    if (path === '/volunteer/tasks') return route.fulfill(ok({ items: state.tasks || [] }));
    return route.fulfill(ok({ items: [] }));
  });
  return calls;
}

const online = calls => calls.filter(c => !c.offline);
const deletes = calls => online(calls).filter(c => c.method === 'DELETE' && c.path === '/location');
const consents = calls => online(calls).filter(c => c.method === 'POST' && c.path === '/location/consent');
const locationPosts = calls => online(calls).filter(c => c.method === 'POST' && c.path === '/location');

async function buyer(page, id, consent) {
  await page.addInitScript(([uid, saved, key]) => {
    localStorage.setItem('foodsave.auth.session.customer', JSON.stringify({ role: 'customer', accessToken: 'token-' + uid, profile: { id: uid, full_name: 'Khách ' + uid } }));
    if (saved) localStorage.setItem(key, saved);
  }, [id, consent, STORE_KEY]);
}

// ---------- Finding 1: lựa chọn gắn với tài khoản ----------
for (const file of ['FOODSAVE_USER.html', 'FOODSAVE_APP.html']) {
  test(`${file}: "Cho phép" của tài khoản khác không làm tài khoản này bị theo dõi; hộp hỏi hiện lại`, async ({ page, context }) => {
    const errors = trackErrors(page);
    await buyer(page, 'u2', consentFor('customer:u1'));
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HCM);
    const calls = await stubApi(page, { orders: [paidOrder()] });
    await page.goto('/' + file);
    await expect(page.locator('[data-location-prompt]')).toBeVisible();
    await page.waitForTimeout(2000);
    expect(locationPosts(calls)).toHaveLength(0);
    expect(consents(calls)).toHaveLength(0);
    expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('unknown');
    expect(errors).toEqual([]);
  });

  test(`${file}: lựa chọn của chính tài khoản thì theo dõi bình thường`, async ({ page, context }) => {
    await buyer(page, 'u1', consentFor('customer:u1'));
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HCM);
    const calls = await stubApi(page, { orders: [paidOrder()] });
    await page.goto('/' + file);
    await expect.poll(() => locationPosts(calls).length, { timeout: 15000 }).toBeGreaterThan(0);
    expect(locationPosts(calls)[0].auth).toBe('Bearer token-u1');
  });
}

// ---------- Finding 7: đăng xuất luôn DELETE /location ----------
test('FOODSAVE_USER.html: đăng xuất khi chưa theo dõi vẫn gửi DELETE /location kèm token', async ({ page }) => {
  await buyer(page, 'u1', consentFor('customer:u1'));
  const calls = await stubApi(page);
  await page.goto('/FOODSAVE_USER.html');
  await expect.poll(() => page.evaluate(() => typeof window.FoodSaveLocation)).toBe('object');
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  await page.evaluate(() => window.logout());
  await expect.poll(() => deletes(calls).length).toBe(1);
  expect(deletes(calls)[0].auth).toBe('Bearer token-u1');
});

test('FOODSAVE_APP.html: đăng xuất khi chưa theo dõi vẫn gửi DELETE /location kèm token', async ({ page }) => {
  await buyer(page, 'u1', consentFor('customer:u1'));
  const calls = await stubApi(page);
  await page.goto('/FOODSAVE_APP.html');
  await expect.poll(() => page.evaluate(() => typeof window.FoodSaveLocation)).toBe('object');
  await page.evaluate(() => window.doLogout(true));
  await expect.poll(() => deletes(calls).length).toBe(1);
  expect(deletes(calls)[0].auth).toBe('Bearer token-u1');
});

// ---------- Finding 2: rút lại khi mất mạng ----------
test('FOODSAVE_USER.html: tắt chia sẻ lúc mất mạng thì báo chưa gửi được, có mạng lại thì gửi consent false + DELETE', async ({ page }) => {
  const errors = trackErrors(page);
  await buyer(page, 'u1', consentFor('customer:u1'));
  const state = {};
  const calls = await stubApi(page, state);
  await page.goto('/FOODSAVE_USER.html');
  await page.evaluate(() => window.accTab && window.accTab('profile', document.querySelector('#page-account .side-link')));
  const toggle = page.locator('#loc-share-toggle');
  await expect(toggle).toBeChecked();
  state.offline = true;
  await toggle.evaluate(el => el.click());
  await expect(page.locator('#toast-wrap')).toContainText('Chưa gửi được');
  await expect(toggle).not.toBeChecked();
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('denied');
  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => consents(calls).filter(c => c.body.granted === false).length).toBe(1);
  await expect.poll(() => deletes(calls).length).toBe(1);
  expect(errors).toEqual([]);
});

test('FOODSAVE_APP.html: tắt chia sẻ lúc mất mạng không gây lỗi JS và có báo', async ({ page }) => {
  const errors = trackErrors(page);
  await buyer(page, 'u1', consentFor('customer:u1'));
  const state = {};
  await stubApi(page, state);
  await page.goto('/FOODSAVE_APP.html');
  await expect.poll(() => page.evaluate(() => typeof window.toggleLocationShare)).toBe('function');
  state.offline = true;
  await page.evaluate(() => window.toggleLocationShare());
  await expect(page.locator('#toast')).toContainText('Chưa gửi được');
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('denied');
  expect(errors).toEqual([]);
});

// ---------- Finding 6 + 7: trang TNV ----------
async function volunteer(page) {
  await page.addInitScript(([saved, key, id]) => {
    localStorage.setItem('foodsave-volunteer-token', 'vol-token');
    localStorage.setItem('foodsave-volunteer-info', JSON.stringify({ id, full_name: 'TNV Thử', charity_name: 'Mái ấm A' }));
    localStorage.setItem(key, saved);
  }, [consentFor('volunteer:' + VOL_ID), STORE_KEY, VOL_ID]);
}

for (const [code, text] of [['AUTH_FORBIDDEN', 'tạm ngưng'], ['AUTH_VERIFICATION_REQUIRED', 'xác minh lại']]) {
  test(`FOODSAVE_VOLUNTEER.html: 403 ${code} thì đăng xuất, báo lý do, xóa vị trí trước khi bỏ token`, async ({ page }) => {
    const errors = trackErrors(page);
    await volunteer(page);
    const calls = await stubApi(page, { me: fail(403, code, 'Forbidden') });
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#login-err')).toContainText(text);
    expect(await page.evaluate(() => localStorage.getItem('foodsave-volunteer-token'))).toBeNull();
    await expect.poll(() => deletes(calls).length).toBe(1);
    expect(deletes(calls)[0].auth).toBe('Bearer vol-token');
    expect(errors).toEqual([]);
  });
}

test('FOODSAVE_VOLUNTEER.html: đăng xuất khi không có nhiệm vụ vẫn gửi DELETE /location', async ({ page }) => {
  await volunteer(page);
  const calls = await stubApi(page, { tasks: [] });
  await page.goto('/FOODSAVE_VOLUNTEER.html');
  await page.click('[data-act="tab"][data-t="profile"]');
  await page.click('[data-act="logout"]');
  await expect.poll(() => deletes(calls).length).toBe(1);
  expect(deletes(calls)[0].auth).toBe('Bearer vol-token');
});

// ---------- Finding 8: nội dung hộp hỏi của cửa hàng / tổ chức ----------
for (const [file, word] of [['FOODSAVE_PARTNER.html', 'cửa hàng'], ['FOODSAVE_CHARITY.html', 'tổ chức']]) {
  test(`${file}: hộp hỏi nói về xác nhận vị trí địa chỉ ${word}, không nói lấy/giao hàng; không gọi API vị trí`, async ({ page }) => {
    const errors = trackErrors(page);
    // Banner cookie (z-index cao hơn, hiện sau 700 ms) có thể che nút "Cho phép": đánh dấu đã chọn cookie trước
    await page.addInitScript(() => localStorage.setItem('foodsave.cookie.consent.v2', JSON.stringify({
      version: 2, choice: 'reject', sourceRole: 'test', categories: { necessary: true, analytics: false, personalization: false, marketing: false },
      savedAt: Date.now(), expiresAt: Date.now() + 86400000,
    })));
    const calls = await stubApi(page);
    await page.goto('/' + file);
    const prompt = page.locator('[data-location-prompt]');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText('địa chỉ ' + word);
    await expect(prompt).not.toContainText('lấy/giao hàng');
    await page.locator('[data-location-allow]').click();
    await page.waitForTimeout(300);
    expect(calls.filter(c => c.path.startsWith('/location'))).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}

// ---------- Finding 4: chế độ demo chỉ khi ?demo=1 ----------
for (const file of ['FOODSAVE_PARTNER.html', 'FOODSAVE_CHARITY.html']) {
  test(`${file}: mặc định KHÔNG nạp chế độ demo, form đăng nhập thật không lỗi JS`, async ({ page }) => {
    const errors = trackErrors(page);
    const scripts = [];
    page.on('request', r => { if (r.url().includes('mio-demo-mode.js')) scripts.push(r.url()); });
    await stubApi(page);
    await page.goto('/' + file);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => Boolean(window.MIO_DEMO_MODE))).toBe(false);
    expect(scripts).toHaveLength(0);
    await expect(page.locator('.mio-demo-badge')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${file}: ?demo=1 nạp chế độ demo và nhớ trong tab`, async ({ page }) => {
    const errors = trackErrors(page);
    await stubApi(page);
    await page.goto('/' + file + '?demo=1');
    await expect.poll(() => page.evaluate(() => Boolean(window.MIO_DEMO_MODE))).toBe(true);
    await expect(page.locator('.mio-demo-badge')).toBeVisible();
    await page.goto('/' + file);
    await expect.poll(() => page.evaluate(() => Boolean(window.MIO_DEMO_MODE))).toBe(true);
    expect(errors).toEqual([]);
  });
}
