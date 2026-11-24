import { expect, test } from '@playwright/test';

// Task 6: trang tình nguyện viên (đăng nhập OTP email + vị trí) và trang tổ chức (bản đồ TNV trực tiếp).
const HCM = { latitude: 10.7769, longitude: 106.7009, accuracy: 20 };
const GOOGLE_ROUTE = 'https://www.google.com/maps/dir/?api=1&origin=10.77,106.70&destination=10.80,106.72&waypoints=10.78,106.71';
const VOL_ID = '33333333-3333-4333-8333-333333333333';
const VOL_ID_2 = '44444444-4444-4444-8444-444444444444';
// Lựa chọn gắn với TNV đang đăng nhập (volunteerSession lưu info.id = VOL_ID)
const CONSENT = JSON.stringify({ choice: 'granted', version: '2026-11-22', at: 1, actor: 'volunteer:' + VOL_ID, pending: false });

const ok = data => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  return errors;
}

function volunteerTask(overrides = {}) {
  return {
    id: 'don-1', donation_code: 'DN-1001', items: 'Bánh mì', amount_text: '10 phần', weight_kg: 4,
    status: 'accepted', does_pickup: true, does_distribute: false, packed_at: '2026-11-22T01:00:00Z',
    my_pickup: { done_at: null }, my_distribute: null, team: { pickup: [], distribute: [] }, my_photos: [], pickup_photo_count: 0,
    expires_at: null, stores: { name: 'Tiệm thử', address: '1 Lê Lợi', latitude: 10.78, longitude: 106.69, emoji: '🍞' },
    route: null, ...overrides,
  };
}

const volunteerMe = (extra = {}) => ({ id: VOL_ID, full_name: 'TNV Thử', phone: '0901234567', email: 'tnv@mio.vn', charity_name: 'Mái ấm A', vehicle: 'Xe máy', zones: ['Q1'], schedule: 'Linh hoạt', duty_role: 'both', active_today: true, runs: 0, kg_collected: 0, rating: 5, ...extra });

// state: tasks, verify (hàm trả về fulfill), failTasks, meExtra
async function stubVolunteerApi(page, state = {}) {
  const calls = [];
  state.tasks = state.tasks || [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');
    let body = null;
    try { body = request.postDataJSON(); } catch { body = null; }
    calls.push({ method: request.method(), path, body, auth: request.headers().authorization });
    if (path.startsWith('/location')) return route.fulfill(ok({ stored: true, throttled: false }));
    if (path === '/volunteer/otp/request') return route.fulfill(ok({ message: 'Nếu email đã được tổ chức đăng ký, mã sẽ được gửi.' }));
    if (path === '/volunteer/otp/verify') return route.fulfill(state.verify ? state.verify(body) : ok({ token: 'vol-token', volunteer: { id: VOL_ID, full_name: 'TNV Thử', phone: '0901234567', charity_name: 'Mái ấm A' } }));
    if (path === '/volunteer/otp/select') return route.fulfill(ok({ token: 'vol-token-2', volunteer: { id: body.volunteer_id, full_name: 'TNV Thử', phone: '0901234567', charity_name: 'Mái ấm B' } }));
    if (path === '/volunteer/login') return route.fulfill(ok({ token: 'vol-token', volunteer: { id: VOL_ID, full_name: 'TNV Thử', phone: '0901234567', charity_name: 'Mái ấm A' } }));
    if (path === '/volunteer/me') return route.fulfill(ok(volunteerMe(state.meExtra)));
    if (path === '/volunteer/tasks' && state.gate) await state.gate;
    if (path === '/volunteer/tasks') return state.failTasks ? route.fulfill(fail(500, 'INTERNAL', 'Lỗi')) : route.fulfill(ok({ items: state.tasks }));
    return route.fulfill(ok({ items: [] }));
  });
  return calls;
}

async function volunteerSession(page) {
  await page.addInitScript(([consent, id]) => {
    localStorage.setItem('foodsave-volunteer-token', 'vol-token');
    localStorage.setItem('foodsave-volunteer-info', JSON.stringify({ id, full_name: 'TNV Thử', charity_name: 'Mái ấm A' }));
    localStorage.setItem('mio.location.consent.v1', consent);
  }, [CONSENT, VOL_ID]);
}

const locationPosts = calls => calls.filter(c => c.method === 'POST' && c.path === '/location');

async function fillOtpFlow(page, email = 'tnv@mio.vn', code = '123456') {
  await page.fill('#email', email);
  await page.click('#login-form button[type=submit]');
  await expect(page.locator('#otp-code')).toBeVisible();
  await page.fill('#otp-code', code);
  await page.click('#login-form button[type=submit]');
}

test.describe('FOODSAVE_VOLUNTEER.html: đăng nhập OTP email', () => {
  test('email -> mã 6 số -> danh sách nhiệm vụ, không hiện đăng nhập số điện thoại', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await stubVolunteerApi(page, { tasks: [volunteerTask()] });
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    await expect(page.locator('#phone')).toHaveCount(0);
    await fillOtpFlow(page);
    await expect(page.locator('.task').first()).toContainText('Bánh mì');
    expect(calls.find(c => c.path === '/volunteer/otp/request').body).toEqual({ email: 'tnv@mio.vn' });
    expect(calls.find(c => c.path === '/volunteer/otp/verify').body).toEqual({ email: 'tnv@mio.vn', code: '123456' });
    expect(await page.evaluate(() => localStorage.getItem('foodsave-volunteer-token'))).toBe('vol-token');
    expect(errors).toEqual([]);
  });

  test('có 2 tổ chức: hiện màn chọn, chọn xong vào danh sách bằng /otp/select', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await stubVolunteerApi(page, {
      tasks: [volunteerTask()],
      verify: () => ok({ selection_token: 'sel-token-0123456789', options: [{ volunteer_id: VOL_ID, charity_name: 'Mái ấm A' }, { volunteer_id: VOL_ID_2, charity_name: '<b>Mái ấm B</b>' }] }),
    });
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    await fillOtpFlow(page);
    const options = page.locator('[data-act="pick-org"]');
    await expect(options).toHaveCount(2);
    await expect(options.nth(1)).toContainText('<b>Mái ấm B</b>'); // được escape, không thành thẻ
    await options.nth(1).click();
    await expect(page.locator('.task').first()).toContainText('Bánh mì');
    expect(calls.find(c => c.path === '/volunteer/otp/select').body).toEqual({ selection_token: 'sel-token-0123456789', volunteer_id: VOL_ID_2 });
    expect(await page.evaluate(() => localStorage.getItem('foodsave-volunteer-token'))).toBe('vol-token-2');
    expect(errors).toEqual([]);
  });

  test('429 OTP_LOCKED hiện thông báo khóa', async ({ page }) => {
    await stubVolunteerApi(page, { verify: () => fail(429, 'OTP_LOCKED', 'Bạn nhập sai quá nhiều lần. Thử lại sau 15 phút.') });
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    await fillOtpFlow(page);
    await expect(page.locator('#login-err')).toContainText('sai quá nhiều lần');
    await expect(page.locator('.task')).toHaveCount(0);
  });

  test('401 sai mã hiện thông báo và cho nhập lại', async ({ page }) => {
    await stubVolunteerApi(page, { verify: () => fail(401, 'AUTH_INVALID', 'Mã không đúng hoặc đã hết hạn.') });
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    await fillOtpFlow(page, 'tnv@mio.vn', '000000');
    await expect(page.locator('#login-err')).toContainText('Mã không đúng');
    await expect(page.locator('#otp-code')).toBeVisible();
  });

  test('email sai định dạng không gọi API', async ({ page }) => {
    const calls = await stubVolunteerApi(page);
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    await page.fill('#email', 'khong-phai-email');
    await page.click('#login-form button[type=submit]');
    await expect(page.locator('#login-err')).toContainText('email');
    expect(calls.filter(c => c.path === '/volunteer/otp/request')).toHaveLength(0);
  });

  test('đăng nhập số điện thoại chỉ hiện ở chế độ demo (?demo=1) và vẫn chạy', async ({ page }) => {
    const calls = await stubVolunteerApi(page, { tasks: [volunteerTask()] });
    await page.goto('/FOODSAVE_VOLUNTEER.html?demo=1');
    await expect(page.locator('#phone')).toBeVisible();
    await page.fill('#phone', '0901234567');
    await page.click('#phone-form button[type=submit]');
    await expect(page.locator('.task').first()).toContainText('Bánh mì');
    expect(calls.find(c => c.path === '/volunteer/login').body).toEqual({ phone: '0901234567' });
  });
});

test.describe('FOODSAVE_VOLUNTEER.html: vị trí và chỉ đường', () => {
  test('nhiệm vụ đang chạy -> POST /location kiểu donation với token TNV', async ({ page, context }) => {
    const errors = trackErrors(page);
    await volunteerSession(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HCM);
    const calls = await stubVolunteerApi(page, { tasks: [volunteerTask({ status: 'in_route' })] });
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    await expect.poll(() => locationPosts(calls).length, { timeout: 15000 }).toBeGreaterThan(0);
    const sent = locationPosts(calls)[0];
    expect(sent.body.context).toEqual({ kind: 'donation', id: 'don-1' });
    expect(sent.auth).toBe('Bearer vol-token');
    expect(errors).toEqual([]);
  });

  test('nhiệm vụ xong thì dừng; tải lỗi thì KHÔNG dừng; đăng xuất thì dừng kèm token', async ({ page, context }) => {
    const errors = trackErrors(page);
    await volunteerSession(page);
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation(HCM);
    const state = { tasks: [volunteerTask({ status: 'in_route' })] };
    const calls = await stubVolunteerApi(page, state);
    await page.clock.install();
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    await expect.poll(() => page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(true);
    const deletes = () => calls.filter(c => c.method === 'DELETE' && c.path === '/location');

    // Tải lỗi (500): danh sách rỗng không có nghĩa là hết việc
    state.failTasks = true;
    await page.clock.fastForward(31000);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(true);
    expect(deletes()).toHaveLength(0);

    // Tải lại thành công và nhiệm vụ đã xong: dừng
    state.failTasks = false;
    state.tasks = [volunteerTask({ status: 'completed', my_pickup: { done_at: '2026-11-22T02:00:00Z' }, completed_at: '2026-11-22T02:00:00Z' })];
    await page.clock.fastForward(31000);
    await expect.poll(() => deletes().length).toBe(1);
    expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);

    // Có việc mới rồi đăng xuất: dừng và DELETE còn mang token
    state.tasks = [volunteerTask({ id: 'don-2', status: 'accepted' })];
    await page.clock.fastForward(121000);
    await expect.poll(() => page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(true);
    await page.click('[data-act="tab"][data-t="profile"]');
    await page.click('[data-act="logout"]');
    await expect.poll(() => deletes().length).toBe(2);
    expect(deletes()[1].auth).toBe('Bearer vol-token');
    expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
    expect(errors).toEqual([]);
  });

  test('"Chỉ đường" dùng route.directions.google khi có, nếu không dùng toạ độ cửa hàng', async ({ page }) => {
    await volunteerSession(page);
    await page.addInitScript(() => { window.__opened = []; window.open = url => { window.__opened.push(url); return null; }; });
    await stubVolunteerApi(page, {
      tasks: [
        volunteerTask({ route: { ordered_stops: [], directions: { google: GOOGLE_ROUTE, apple: 'https://maps.apple.com/?x=1' } } }),
        volunteerTask({ id: 'don-3', donation_code: 'DN-1003', items: 'Rau củ', route: null }),
      ],
    });
    await page.goto('/FOODSAVE_VOLUNTEER.html');
    const buttons = page.locator('[data-act="dir"]');
    await expect(buttons).toHaveCount(2);
    await buttons.nth(0).click();
    await buttons.nth(1).click();
    const opened = await page.evaluate(() => window.__opened);
    expect(opened[0]).toBe(GOOGLE_ROUTE);
    expect(opened[1]).toContain('destination=10.78%2C106.69');
  });
});

// ---------- Trang tổ chức ----------
const LIVE = [
  { actor_kind: 'volunteer', actor_id: VOL_ID, name: 'Trần <img src=x onerror=window.__xss=1>', context_kind: 'donation', context_id: 'don-1', context_code: 'DN-1001', lat: 10.78, lng: 106.7, accuracy_m: 20, updated_at: new Date().toISOString(), destination: { lat: 10.77, lng: 106.69, label: 'Tiệm thử' }, directions_url: 'https://www.google.com/maps/dir/?api=1&destination=10.77,106.69' },
  { actor_kind: 'volunteer', actor_id: VOL_ID_2, name: 'Lê Mai', context_kind: 'donation', context_id: 'don-2', context_code: 'DN-1002', lat: 10.79, lng: 106.71, accuracy_m: 30, updated_at: new Date(Date.now() - 10 * 60000).toISOString(), destination: null, directions_url: null },
];

async function openCharityRoutes(page, { live = LIVE, clock = true } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem('foodsave.auth.session.charity', JSON.stringify({ role: 'charity', accessToken: 'char-token', profile: { id: 'c1', full_name: 'Tổ chức thử' }, context: { charity: { id: 'c1', name: 'Mái ấm A' } } }));
  });
  // Không có ?demo=1 nên trang tổ chức chạy đường API thật (mio-demo-mode.js không được nạp).
  const calls = [];
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '');
    calls.push({ method: request.method(), path, auth: request.headers().authorization });
    if (path === '/charity/volunteers/live') return calls.failLive ? route.fulfill(fail(500, 'INTERNAL', 'Lỗi')) : route.fulfill(ok(live));
    return route.fulfill(ok({ items: [] }));
  });
  if (clock) await page.clock.install();
  await page.goto('/FOODSAVE_CHARITY.html');
  await page.evaluate(() => { goView('portal'); go('routes'); });
  return calls;
}
const livePolls = calls => calls.filter(c => c.path === '/charity/volunteers/live');

test.describe('FOODSAVE_CHARITY.html: bản đồ TNV trực tiếp', () => {
  test('hiện marker và danh sách từ API, tên được escape, mờ khi > 5 phút', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await openCharityRoutes(page, { clock: false });
    await expect(page.locator('#charity-live-map .leaflet-marker-icon')).toHaveCount(2, { timeout: 10000 });
    await expect(page.locator('#charity-live-list')).toContainText('DN-1001');
    await expect(page.locator('#charity-live-list')).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator('#charity-live-list [data-stale="1"]')).toHaveCount(1);
    expect(livePolls(calls)[0].auth).toBe('Bearer char-token');
    expect(await page.evaluate(() => typeof window.FoodSaveLocation)).toBe('object');
    expect(errors).toEqual([]);
  });

  test('poll 20 giây khi tab hiện; dừng khi tab ẩn; dừng khi rời trang bản đồ', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await openCharityRoutes(page);
    await expect.poll(() => livePolls(calls).length).toBe(1);
    await page.clock.fastForward(20500);
    await expect.poll(() => livePolls(calls).length).toBe(2);

    // Tab ẩn
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(65000);
    await page.waitForTimeout(200);
    expect(livePolls(calls).length).toBe(2);

    // Tab hiện lại: tải ngay và poll tiếp
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => livePolls(calls).length).toBe(3);
    await page.clock.fastForward(20500);
    await expect.poll(() => livePolls(calls).length).toBe(4);

    // Rời trang bản đồ
    await page.evaluate(() => go('dash'));
    expect(await page.evaluate(() => window.charityLiveTimer)).toBeNull();
    await page.clock.fastForward(65000);
    await page.waitForTimeout(200);
    expect(livePolls(calls).length).toBe(4);
    expect(errors).toEqual([]);
  });
});

test('FOODSAVE_CHARITY.html: vẽ lại liên tục không ném lỗi Leaflet và "Dùng vị trí hiện tại" lưu tọa độ tổ chức', async ({ page, context }) => {
  const errors = trackErrors(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  await openCharityRoutes(page, { clock: false });
  await expect(page.locator('#charity-live-map .leaflet-marker-icon')).toHaveCount(2, { timeout: 10000 });
  // Vẽ lại ba lần liên tiếp (bản đồ cũ bị gỡ trong lúc hẹn giờ invalidateSize còn chạy)
  await page.evaluate(() => { R(); R(); R(); });
  await page.waitForTimeout(400);
  await expect(page.locator('#charity-live-map .leaflet-marker-icon')).toHaveCount(2);

  await page.evaluate(() => {
    window.__updates = [];
    window.charityProfile = { id: 'c1' };
    window.getFoodSaveSupabaseClient = () => ({ from: table => ({ update: values => ({ eq: (col, val) => { window.__updates.push({ table, values, col, val }); return Promise.resolve({ error: null }); } }) }) });
  });
  await page.click('#charity-locate-btn');
  await expect.poll(() => page.evaluate(() => window.__updates.length)).toBe(1);
  const update = await page.evaluate(() => window.__updates[0]);
  expect(update.table).toBe('charity_profiles');
  expect(update.col).toBe('id');
  expect(update.val).toBe('c1');
  expect(update.values.latitude).toBeCloseTo(HCM.latitude, 3);
  expect(update.values.longitude).toBeCloseTo(HCM.longitude, 3);
  expect(errors).toEqual([]);
});

test('FOODSAVE_VOLUNTEER.html: đăng xuất lúc đang tải danh sách thì KHÔNG bật lại theo dõi vị trí', async ({ page, context }) => {
  const errors = trackErrors(page);
  await volunteerSession(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(HCM);
  const state = { tasks: [volunteerTask({ status: 'in_route' })] };
  const calls = await stubVolunteerApi(page, state);
  await page.clock.install();
  await page.goto('/FOODSAVE_VOLUNTEER.html');
  await expect.poll(() => page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(true);
  // Chặn phản hồi /volunteer/tasks của lần poll kế tiếp, đăng xuất, rồi mới thả
  let release;
  state.gate = new Promise(resolve => { release = resolve; });
  await page.clock.fastForward(31000);
  await expect.poll(() => calls.filter(c => c.path === '/volunteer/tasks').length).toBe(2);
  await page.click('[data-act="tab"][data-t="profile"]');
  await page.click('[data-act="logout"]');
  await expect(page.locator('#login-form')).toBeVisible();
  const postsBefore = locationPosts(calls).length;
  release();
  await page.waitForTimeout(500);
  await page.clock.fastForward(130000);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.FoodSaveLocation._isTracking())).toBe(false);
  expect(locationPosts(calls).length).toBe(postsBefore);
  await expect(page.locator('#login-form')).toBeVisible();
  expect(errors).toEqual([]);
});

test('FOODSAVE_VOLUNTEER.html: "Gửi lại mã" gọi lại /otp/request, 429 hiện thông báo rõ', async ({ page }) => {
  const calls = await stubVolunteerApi(page);
  await page.goto('/FOODSAVE_VOLUNTEER.html');
  await page.fill('#email', 'tnv@mio.vn');
  await page.click('#login-form button[type=submit]');
  await expect(page.locator('#otp-code')).toBeVisible();
  await page.click('[data-act="otp-resend"]');
  await expect.poll(() => calls.filter(c => c.path === '/volunteer/otp/request').length).toBe(2);
  expect(calls.filter(c => c.path === '/volunteer/otp/request')[1].body).toEqual({ email: 'tnv@mio.vn' });
  await expect(page.locator('.login-ok')).toContainText('mã sẽ được gửi');
  await page.unroute('**/api/v1/**');
  await page.route('**/api/v1/volunteer/otp/request', route => route.fulfill(fail(429, 'RATE_LIMITED', 'Too many')));
  await page.click('[data-act="otp-resend"]');
  await expect(page.locator('#login-err')).toContainText('quá nhanh');
});

test('FOODSAVE_CHARITY.html: tải lỗi thì đánh dấu dữ liệu có thể đã cũ', async ({ page }) => {
  const errors = trackErrors(page);
  const calls = await openCharityRoutes(page, { clock: false });
  await expect(page.locator('#charity-live-map .leaflet-marker-icon')).toHaveCount(2, { timeout: 10000 });
  calls.failLive = true;
  await page.evaluate(() => { charityLiveBusy = false; return charityLiveFetch(); });
  await expect(page.locator('#charity-live-status')).toContainText('có thể đã cũ');
  await expect(page.locator('#charity-live-list [data-stale="1"]')).toHaveCount(2);
  expect(errors).toEqual([]);
});

// ---------- Bản đồ tổ chức: giới hạn chi phí ----------
test.describe('FOODSAVE_CHARITY.html: giới hạn poll', () => {
  test('không thao tác 15 phút thì dừng poll, nút "Bấm để tiếp tục cập nhật" tải lại và poll tiếp', async ({ page }) => {
    const errors = trackErrors(page);
    const calls = await openCharityRoutes(page);
    await expect.poll(() => livePolls(calls).length).toBe(1);
    await page.clock.runFor(10 * 60000);
    await page.evaluate(() => document.dispatchEvent(new Event('pointerdown')));
    await page.clock.runFor(10 * 60000);
    const resume = page.locator('[data-charity-live-resume]');
    await expect(resume).toBeHidden();
    await page.clock.runFor(6 * 60000);
    await expect(resume).toBeVisible();
    await expect(resume).toHaveText(/Bấm để tiếp tục cập nhật/);
    const stopped = livePolls(calls).length;
    // Vòng tự làm mới dữ liệu chung (15 giây, foodsave-live-data.js) cũng ngừng khi rảnh
    const others = () => calls.filter(c => c.path !== '/charity/volunteers/live').length;
    await page.waitForTimeout(1000);   // chờ các request phát ra từ trước (đồng hồ giả chạy nhanh hơn mạng) tới hết
    const othersStopped = others();
    await page.clock.runFor(5 * 60000);
    expect(livePolls(calls).length).toBe(stopped);
    expect(others()).toBe(othersStopped);
    await resume.click();
    await expect.poll(() => livePolls(calls).length).toBe(stopped + 1);
    await expect(resume).toBeHidden();
    await page.clock.runFor(20500);
    await expect.poll(() => livePolls(calls).length).toBe(stopped + 2);
    expect(errors).toEqual([]);
  });

  test('máy chủ treo thì sau 15 giây bỏ chờ (busy không kẹt), lần poll sau vẫn chạy', async ({ page }) => {
    const calls = await openCharityRoutes(page);
    await expect.poll(() => livePolls(calls).length).toBe(1);
    await page.route('**/api/v1/charity/volunteers/live', async route => {
      calls.push({ path: '/charity/volunteers/live' });
      if (calls.hang) return; // không bao giờ trả lời
      return route.fulfill(ok(LIVE));
    });
    calls.hang = true;
    await page.clock.runFor(20500);
    await expect.poll(() => livePolls(calls).length).toBe(2);
    await page.clock.runFor(15100);
    await expect(page.locator('#charity-live-status')).toContainText('có thể đã cũ');
    calls.hang = false;
    await page.clock.runFor(20500);
    await expect.poll(() => livePolls(calls).length).toBe(3);
    await expect(page.locator('#charity-live-status')).not.toContainText('có thể đã cũ');
  });

  test('tab hiện lại ngay sau một lần tải thì không tải thêm; làm mới không đổi zoom', async ({ page }) => {
    const calls = await openCharityRoutes(page);
    await expect(page.locator('#charity-live-map .leaflet-marker-icon')).toHaveCount(2, { timeout: 10000 });
    const n = livePolls(calls).length;
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.clock.runFor(1000);
    expect(livePolls(calls).length).toBe(n);
    await page.evaluate(() => charityLiveMap.setZoom(9, { animate: false }));
    await page.clock.runFor(20500);
    await expect.poll(() => livePolls(calls).length).toBe(n + 1);
    await page.clock.runFor(500);
    expect(await page.evaluate(() => charityLiveMap.getZoom())).toBe(9);
  });
});
