import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/location.html', import.meta.url)), 'utf8');
const CONTEXT = { kind: 'order', id: '11111111-1111-4111-8111-111111111111' };
const HCM = { latitude: 10.7769, longitude: 106.7009, accuracy: 20 };
const FAR = { latitude: 10.8231, longitude: 106.6297, accuracy: 20 };

// Dựng trang thử, stub toàn bộ API vị trí và ghi lại các request.
// locationStatus: số, hoặc mảng trạng thái theo thứ tự các lần POST /location (phần tử cuối lặp lại).
// state.offline = true: mọi request vị trí lỗi mạng. forbiddenCode: mã lỗi kèm 403 (mặc định LOCATION_CONSENT_REQUIRED).
// onLocationPost(page): chạy trước khi trả lời mỗi POST /location (đổi trạng thái trang giữa chừng).
async function setup(page, { locationStatus = 200, state = {}, forbiddenCode = 'LOCATION_CONSENT_REQUIRED', onLocationPost = null } = {}) {
  let locationPostCount = 0;
  const calls = [];
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/__test__/location.html', route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: FIXTURE }));
  await page.route('**/api/v1/location**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    calls.push({ method: request.method(), path: url.pathname, body, auth: request.headers().authorization, offline: Boolean(state.offline) });
    if (state.offline) return route.abort('internetdisconnected');
    let status = 200;
    if (request.method() === 'POST' && url.pathname.endsWith('/location')) {
      const seq = [].concat(locationStatus);
      status = seq[Math.min(locationPostCount, seq.length - 1)];
      locationPostCount += 1;
      if (onLocationPost) await onLocationPost(page);
    }
    const failing = status !== 200;
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(failing
        ? { success: false, error: { code: status === 403 ? forbiddenCode : 'NO_ACTIVE_TASK', message: 'Lỗi vị trí' } }
        : { success: true, data: { stored: true, throttled: false } }),
    });
  });
  return { calls, pageErrors };
}

const posts = (calls, suffix) => calls.filter(c => c.method === 'POST' && c.path.endsWith(suffix));
const locationPosts = calls => calls.filter(c => c.method === 'POST' && /\/location$/.test(c.path));

async function open(page) {
  await page.goto('/__test__/location.html');
  await page.evaluate(() => window.FoodSaveLocation._ready);
}

test('hộp xin quyền hiện lần đầu; bấm "Để sau" thì tải lại không hiện', async ({ page }) => {
  const { pageErrors } = await setup(page);
  await open(page);
  const prompt = page.locator('[data-location-prompt]');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('chỉ chia sẻ trong lúc làm nhiệm vụ');
  await page.locator('[data-location-later]').click();
  await expect(prompt).toBeHidden();
  await open(page);
  await expect(page.locator('[data-location-prompt]')).toHaveCount(0);
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('unknown');
  expect(pageErrors).toEqual([]);
});

test('cho phép gửi consent, startTask gửi vị trí, gọi lần 2 không gửi thêm', async ({ page, context }) => {
  const { calls, pageErrors } = await setup(page);
  await open(page);
  // Cấp quyền sau khi hộp đã hiện để test thao tác bấm "Cho phép" từ trạng thái chưa có quyền.
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await expect.poll(() => posts(calls, '/location/consent').length).toBe(1);
  const consent = posts(calls, '/location/consent')[0];
  expect(consent.body).toEqual({ granted: true, policy_version: '2026-11-22' });
  expect(consent.auth).toBe('Bearer test-token');
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('granted');

  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(1);
  const sent = locationPosts(calls)[0].body;
  expect(sent.context).toEqual(CONTEXT);
  expect(sent.lat).toBeCloseTo(HCM.latitude, 3);
  expect(sent.lng).toBeCloseTo(HCM.longitude, 3);

  // Gọi lại ngay và di chuyển xa: vẫn chịu MIN_SEND_MS = 60 giây.
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await context.setGeolocation(FAR);
  await page.waitForTimeout(700);
  expect(locationPosts(calls)).toHaveLength(1);

  const cur = await page.evaluate(() => window.FoodSaveLocation.current());
  expect(cur.lat).toBeCloseTo(FAR.latitude, 3);
  const url = await page.evaluate(() => window.FoodSaveLocation.directionsUrl({ lat: 10.78, lng: 106.69 }));
  expect(url).toContain('https://www.google.com/maps/dir/?api=1&destination=10.78,106.69');
  expect(url).toContain('origin=10.8231');
  expect(url).toContain('travelmode=driving');
  expect(pageErrors).toEqual([]);
});

test('di chuyển đủ xa thì gửi tiếp (khi hết thời gian tối thiểu)', async ({ page, context }) => {
  const { calls } = await setup(page);
  await open(page);
  // Cấp quyền sau khi hộp đã hiện để test thao tác bấm "Cho phép" từ trạng thái chưa có quyền.
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await page.evaluate(() => window.FoodSaveLocation._setTimingForTest({ MIN_SEND_MS: 0 }));
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(1);
  await context.setGeolocation(FAR);
  await expect.poll(() => locationPosts(calls).length).toBe(2);
});

test('API trả 409 thì tự dừng, không gửi tiếp', async ({ page, context }) => {
  const { calls, pageErrors } = await setup(page, { locationStatus: 409 });
  await open(page);
  // Cấp quyền sau khi hộp đã hiện để test thao tác bấm "Cho phép" từ trạng thái chưa có quyền.
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await page.evaluate(() => window.FoodSaveLocation._setTimingForTest({ MIN_SEND_MS: 0, SEND_DISTANCE_M: 1 }));
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  await context.setGeolocation(FAR);
  await page.waitForTimeout(700);
  expect(locationPosts(calls)).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('stopTask gọi DELETE /location', async ({ page, context }) => {
  const { calls } = await setup(page);
  await open(page);
  // Cấp quyền sau khi hộp đã hiện để test thao tác bấm "Cho phép" từ trạng thái chưa có quyền.
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(1);
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(true);
  await page.evaluate(() => window.FoodSaveLocation.stopTask());
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  await expect.poll(() => calls.filter(c => c.method === 'DELETE').length).toBe(1);
});

test('không có quyền vị trí thì không lỗi JS', async ({ page }) => {
  const { calls, pageErrors } = await setup(page);
  await open(page);
  await page.locator('[data-location-allow]').click();
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await page.waitForTimeout(500);
  expect(locationPosts(calls)).toHaveLength(0);
  expect(pageErrors).toEqual([]);
});

test('localStorage ném lỗi thì không lỗi JS', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  });
  const { pageErrors } = await setup(page);
  await open(page);
  await expect(page.locator('[data-location-prompt]')).toBeVisible();
  await page.locator('[data-location-later]').click();
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('unknown');
  expect(pageErrors).toEqual([]);
});

test('trình duyệt đã granted nhưng chưa có lựa chọn local thì hộp vẫn hiện', async ({ page, context }) => {
  const { pageErrors } = await setup(page);
  await context.grantPermissions(['geolocation']);
  await open(page);
  await expect(page.locator('[data-location-prompt]')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('trình duyệt đã denied thì hộp không hiện', async ({ page }) => {
  await setup(page);
  await page.addInitScript(() => {
    navigator.permissions.query = () => Promise.resolve({ state: 'denied' });
  });
  await open(page);
  await expect(page.locator('[data-location-prompt]')).toHaveCount(0);
});

test('POST /location trả 403 thì gửi lại consent rồi thử lại một lần', async ({ page, context }) => {
  const { calls, pageErrors } = await setup(page, { locationStatus: [403, 200] });
  await open(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await expect.poll(() => posts(calls, '/location/consent').length).toBe(1);
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(2);
  await expect.poll(() => posts(calls, '/location/consent').length).toBe(2);
  expect(posts(calls, '/location/consent')[1].body).toEqual({ granted: true, policy_version: '2026-11-22' });
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('403 vẫn lỗi sau khi gửi lại consent thì dừng, trạng thái nhất quán', async ({ page, context }) => {
  const { calls } = await setup(page, { locationStatus: 403 });
  await open(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(2);
  await expect.poll(() => page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  await page.waitForTimeout(500);
  expect(locationPosts(calls)).toHaveLength(2);
});

test('startTask hai lần cùng context chỉ có một watcher', async ({ page, context }) => {
  await setup(page);
  await page.addInitScript(() => {
    window.__watchCalls = 0;
    const original = navigator.geolocation.watchPosition.bind(navigator.geolocation);
    navigator.geolocation.watchPosition = (...args) => { window.__watchCalls += 1; return original(...args); };
  });
  await open(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await page.evaluate(ctx => { window.FoodSaveLocation.startTask(ctx); window.FoodSaveLocation.startTask(ctx); }, CONTEXT);
  expect(await page.evaluate(() => window.__watchCalls)).toBe(1);
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(true);
});

test('directionsUrl trả null khi điểm đến không hợp lệ', async ({ page }) => {
  await setup(page);
  await open(page);
  const results = await page.evaluate(() => [
    window.FoodSaveLocation.directionsUrl(null),
    window.FoodSaveLocation.directionsUrl({ lat: 'x', lng: 1 }),
    window.FoodSaveLocation.directionsUrl({}),
  ]);
  expect(results).toEqual([null, null, null]);
});

// ---------- Lựa chọn gắn với tài khoản, rút lại khi mất mạng, đăng xuất ----------
const consentPosts = calls => posts(calls, '/location/consent').filter(c => !c.offline);
const deleteCalls = calls => calls.filter(c => c.method === 'DELETE' && !c.offline);
const STORE_KEY = 'mio.location.consent.v1';

test('lựa chọn của tài khoản A không được gửi cho tài khoản B; B được hỏi lại', async ({ page, context }) => {
  const { calls, pageErrors } = await setup(page);
  await open(page);
  await context.grantPermissions(['geolocation']);
  await page.locator('[data-location-allow]').click();
  await expect.poll(() => consentPosts(calls).length).toBe(1);
  // A đăng xuất, B đăng nhập trên cùng trình duyệt
  await page.evaluate(() => { window.__actor = 'customer:u2'; window.__auth = 'Bearer token-b'; });
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('unknown');
  await page.evaluate(() => window.FoodSaveLocation.syncConsent());
  await expect(page.locator('[data-location-prompt]')).toBeVisible();
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await page.waitForTimeout(500);
  expect(consentPosts(calls)).toHaveLength(1);
  expect(locationPosts(calls)).toHaveLength(0);
  // Tải lại trang với B: vẫn hỏi, không tự gửi consent
  await page.addInitScript(() => { window.__actor = 'customer:u2'; window.__auth = 'Bearer token-b'; });
  await open(page);
  await expect(page.locator('[data-location-prompt]')).toBeVisible();
  await page.waitForTimeout(300);
  expect(consentPosts(calls)).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('lựa chọn lúc chưa đăng nhập thuộc về tài khoản đầu tiên đăng nhập, gửi một lần', async ({ page, context }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('__seen')) { sessionStorage.setItem('__seen', '1'); window.__actor = null; window.__auth = null; } });
  const { calls } = await setup(page);
  await open(page);
  await context.grantPermissions(['geolocation']);
  await page.locator('[data-location-allow]').click();
  expect(consentPosts(calls)).toHaveLength(0);
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('granted');
  // Đăng nhập (sự kiện lưu phiên của foodsave-auth-client.js)
  await page.evaluate(() => { window.__actor = 'customer:u1'; window.__auth = 'Bearer test-token'; window.dispatchEvent(new CustomEvent('foodsave:session-saved')); });
  await expect.poll(() => consentPosts(calls).length).toBe(1);
  expect(consentPosts(calls)[0].body.granted).toBe(true);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORE_KEY);
  expect(saved.actor).toBe('customer:u1');
  // Tải lại: đã đồng bộ thì không gửi lại
  await open(page);
  await page.waitForTimeout(300);
  expect(consentPosts(calls)).toHaveLength(1);
});

test('bản lưu cũ không có chủ (actor) bị bỏ qua: hỏi lại, không gửi', async ({ page }) => {
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ choice: 'granted', version: '2026-11-22', at: 1 })), STORE_KEY);
  const { calls } = await setup(page);
  await open(page);
  await expect(page.locator('[data-location-prompt]')).toBeVisible();
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('unknown');
  await page.waitForTimeout(300);
  expect(consentPosts(calls)).toHaveLength(0);
});

test('403 không phải LOCATION_CONSENT_REQUIRED thì KHÔNG tự gửi consent, dừng theo dõi', async ({ page, context }) => {
  const { calls, pageErrors } = await setup(page, { locationStatus: 403, forbiddenCode: 'AUTH_FORBIDDEN' });
  await open(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await expect.poll(() => consentPosts(calls).length).toBe(1);
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  await page.waitForTimeout(300);
  expect(consentPosts(calls)).toHaveLength(1);
  expect(locationPosts(calls)).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('403 LOCATION_CONSENT_REQUIRED nhưng lựa chọn hiện tại không phải của tài khoản này → hỏi lại, không tự cấp', async ({ page, context }) => {
  const { calls } = await setup(page, {
    locationStatus: 403,
    onLocationPost: p => p.evaluate(() => { window.__actor = 'customer:u2'; }),
  });
  await open(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await expect.poll(() => consentPosts(calls).length).toBe(1);
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(1);
  await expect(page.locator('[data-location-prompt]')).toBeVisible();
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  expect(consentPosts(calls)).toHaveLength(1);
});

test('403 LOCATION_CONSENT_REVOKED (đã tắt ở máy khác) → lưu "denied", dừng, KHÔNG tự cấp lại, không hỏi', async ({ page, context }) => {
  // Máy này đã cho phép và đã đồng bộ; người dùng tắt chia sẻ trên máy khác → máy chủ trả REVOKED
  await page.addInitScript(key => localStorage.setItem(key, JSON.stringify({ choice: 'granted', version: '2026-11-22', at: 1, actor: 'customer:u1', pending: false })), STORE_KEY);
  const { calls, pageErrors } = await setup(page, { locationStatus: 403, forbiddenCode: 'LOCATION_CONSENT_REVOKED' });
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await open(page);
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('granted');
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(1);
  await expect.poll(() => page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('denied');
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  await page.waitForTimeout(500);
  expect(posts(calls, '/location/consent').filter(c => c.body && c.body.granted === true)).toHaveLength(0);
  expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(0);
  expect(locationPosts(calls)).toHaveLength(1);
  await expect(page.locator('[data-location-prompt]')).toHaveCount(0);
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORE_KEY);
  expect(saved).toMatchObject({ choice: 'denied', actor: 'customer:u1', pending: false });
  // Tải lại trang: không gửi lại consent nào (đã đồng bộ), không hỏi
  await open(page);
  await page.waitForTimeout(300);
  expect(posts(calls, '/location/consent')).toHaveLength(0);
  expect(pageErrors).toEqual([]);
});

test('rút lại khi mất mạng: promise bị từ chối, dừng theo dõi, có mạng lại thì gửi consent false + DELETE', async ({ page, context }) => {
  const state = {};
  const { calls, pageErrors } = await setup(page, { state });
  await open(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await page.locator('[data-location-allow]').click();
  await page.evaluate(ctx => window.FoodSaveLocation.startTask(ctx), CONTEXT);
  await expect.poll(() => locationPosts(calls).length).toBe(1);
  state.offline = true;
  const outcome = await page.evaluate(() => window.FoodSaveLocation.setConsent(false).then(() => 'resolved', () => 'rejected'));
  expect(outcome).toBe('rejected');
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('denied');
  state.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => consentPosts(calls).filter(c => c.body.granted === false).length).toBe(1);
  await expect.poll(() => deleteCalls(calls).length).toBe(1);
  // Đã đồng bộ: sự kiện online lần nữa không gửi lại
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(300);
  expect(consentPosts(calls).filter(c => c.body.granted === false)).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('rút lại lúc mất mạng rồi tải lại trang: init gửi lại lựa chọn đang chờ', async ({ page }) => {
  const state = { offline: true };
  const { calls } = await setup(page, { state });
  await open(page);
  const outcome = await page.evaluate(() => window.FoodSaveLocation.setConsent(false).then(() => 'resolved', () => 'rejected'));
  expect(outcome).toBe('rejected');
  state.offline = false;
  await open(page);
  await expect.poll(() => consentPosts(calls).filter(c => c.body.granted === false).length).toBe(1);
  await expect.poll(() => deleteCalls(calls).length).toBe(1);
});

test('rút lại khi chưa theo dõi vẫn gọi DELETE /location', async ({ page }) => {
  const { calls } = await setup(page);
  await open(page);
  await page.evaluate(() => window.FoodSaveLocation.setConsent(false));
  expect(consentPosts(calls).map(c => c.body.granted)).toEqual([false]);
  expect(deleteCalls(calls)).toHaveLength(1);
});

test('clearServer (đăng xuất) gửi DELETE kể cả khi chưa bắt đầu theo dõi; không có token thì không gửi', async ({ page }) => {
  const { calls } = await setup(page);
  await open(page);
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  await page.evaluate(() => window.FoodSaveLocation.clearServer());
  expect(deleteCalls(calls)).toHaveLength(1);
  expect(deleteCalls(calls)[0].auth).toBe('Bearer test-token');
  await page.evaluate(() => { window.__auth = null; return window.FoodSaveLocation.clearServer(); });
  expect(deleteCalls(calls)).toHaveLength(1);
});

test('promptText thay nội dung hộp hỏi (được escape); serverSync false không gọi API', async ({ page }) => {
  await page.addInitScript(() => { window.__promptText = 'Xác nhận <b>vị trí</b> địa chỉ cửa hàng'; window.__serverSync = false; });
  const { calls } = await setup(page);
  await open(page);
  const prompt = page.locator('[data-location-prompt]');
  await expect(prompt).toContainText('Xác nhận <b>vị trí</b> địa chỉ cửa hàng');
  await expect(prompt).not.toContainText('lấy/giao hàng');
  await expect(prompt.locator('b')).toHaveCount(0);
  await page.locator('[data-location-allow]').click();
  expect(await page.evaluate(() => window.FoodSaveLocation.consentState())).toBe('granted');
  await page.waitForTimeout(300);
  expect(calls).toHaveLength(0);
});
