import test from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
test('admin/index.html tồn tại và chỉ nạp script module ngoài', () => {
  const html = readFileSync('public/admin/index.html', 'utf8');
  assert.match(html, /<title>MIO — Quản trị<\/title>/u);
  assert.match(html, /<script type="module" src="\.\/core\/app\.js\?v=\d{8}[a-z]"><\/script>/u);
  assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>[\s\S]*?import /u, 'không được có module nội tuyến');
  for (const id of ['app', 'sidebar', 'topbar', 'screen', 'drawer', 'modal', 'toasts', 'login', 'loginError']) assert.match(html, new RegExp(`id="${id}"`));
});
test('sw.js không cache /admin/ và đã lên mio-v5', () => {
  const sw = readFileSync('public/sw.js', 'utf8');
  assert.match(sw, /CACHE_VERSION = "mio-v5"/); assert.match(sw, /\/admin\//);
});

// ---- Task 5: guard tĩnh + manifest, state, auth, tìm màn ----
const adminJs = () => readdirSync('public/admin', { recursive: true })
  .map((f) => String(f).replace(/\\/g, '/'))
  .filter((f) => f.endsWith('.js'));
const src = (f) => readFileSync(`public/admin/${f}`, 'utf8');

test('chỉ core/auth.js được dùng supabase / createClient(', () => {
  const files = adminJs();
  assert.ok(files.includes('core/auth.js'), 'thiếu core/auth.js');
  const bad = files.filter((f) => f !== 'core/auth.js' && /supabase|createClient\(/i.test(src(f)));
  assert.deepEqual(bad, []);
});

test('screens không có onclick=/onchange=/onsubmit= nội tuyến', () => {
  const screens = adminJs().filter((f) => /^screens\/[^/]+\.js$/.test(f));
  assert.ok(screens.length > 0, 'chưa có file screens/*.js');
  const bad = screens.filter((f) => /on(click|change|submit)\s*=/i.test(src(f)));
  assert.deepEqual(bad, []);
});

test('setInterval( chỉ có trong core/poll.js', () => {
  const bad = adminJs().filter((f) => f !== 'core/poll.js' && /setInterval\(/.test(src(f)));
  assert.deepEqual(bad, []);
});

const IDS = ['today', 'complaints', 'verify', 'payouts', 'alerts', 'customers', 'stores', 'charities', 'orders', 'donations',
  'tracking', 'inventory', 'ledger', 'vouchers', 'marketing', 'esg', 'rules', 'audit', 'settings'];

test('manifest 19 màn đúng thứ tự spec, group ∈ GROUPS, có title và load', async () => {
  const { GROUPS, SCREENS } = await import('../public/admin/screens/manifest.js');
  assert.deepEqual(GROUPS, ['HÔM NAY', 'CẦN QUYẾT ĐỊNH', 'HỒ SƠ', 'HOẠT ĐỘNG', 'TĂNG TRƯỞNG', 'HỆ THỐNG']);
  assert.deepEqual(SCREENS.map((s) => s.id), IDS);
  for (const s of SCREENS) {
    assert.ok(GROUPS.includes(s.group), `${s.id}: group lạ`);
    assert.equal(typeof s.title, 'string'); assert.ok(s.title.length > 0, `${s.id}: thiếu title`);
    assert.equal(typeof s.load, 'function', `${s.id}: thiếu load`);
  }
  const by = Object.fromEntries(SCREENS.map((s) => [s.id, s]));
  assert.equal(by.today.title, 'Hôm nay'); assert.equal(by.charities.title, 'Tổ chức & tình nguyện viên');
  assert.equal(by.payouts.group, 'CẦN QUYẾT ĐỊNH'); assert.equal(by.tracking.group, 'HOẠT ĐỘNG'); assert.equal(by.settings.group, 'HỆ THỐNG');
});

test('mỗi màn nạp được module có render (Đợt 0: _pending)', async () => {
  const { SCREENS } = await import('../public/admin/screens/manifest.js');
  for (const s of SCREENS) {
    const mod = await s.load();
    assert.equal(typeof mod.default?.render, 'function', `${s.id}: không có render`);
  }
  const pending = (await import('../public/admin/screens/_pending.js')).default;
  assert.equal(pending.id, '_pending'); assert.equal(pending.title, 'Chưa nối API');
  const box = { innerHTML: '' };
  pending.render(box, {});
  assert.match(box.innerHTML, /Màn này chưa có trên cổng mới/u);
  assert.match(box.innerHTML, /href="\/quan-tri"/u);
  // Nêu tên mục tương ứng ở trang cũ; không biết thì dùng tiêu đề màn
  const named = { innerHTML: '' };
  pending.render(named, { screen: { id: 'ledger', title: 'Tiền & sổ cái' } });
  assert.match(named.innerHTML, /Mở trang cũ → mục Tài chính · Sổ cái/u);
  const unknown = { innerHTML: '' };
  pending.render(unknown, { screen: { id: 'la', title: 'Màn <b>lạ</b>' } });
  assert.match(unknown.innerHTML, /mục Màn &lt;b&gt;lạ&lt;\/b&gt;/u);
});

test('huy hiệu: đúng trường, không bao giờ NaN', async () => {
  const { SCREENS } = await import('../public/admin/screens/manifest.js');
  const by = Object.fromEntries(SCREENS.map((s) => [s.id, s]));
  const w = { verification_pending: 2, complaints_waiting_admin: '3', withdrawals_requested: 4, payout_accounts_pending: 1,
    fraud_open: 5, ledger_unbalanced: 1, automation_failed: 2, marketing_queue: 6 };
  assert.equal(by.today.badge(w), 15);
  assert.equal(by.complaints.badge(w), 3);
  assert.equal(by.verify.badge(w), 3);
  assert.equal(by.payouts.badge(w), 4);
  assert.equal(by.alerts.badge(w), 5);
  assert.equal(by.ledger.badge(w), 1);
  assert.equal(by.rules.badge(w), 2);
  assert.equal(by.marketing.badge(w), 6);
  for (const s of SCREENS.filter((x) => x.badge)) {
    for (const input of [{}, null, undefined, { verification_pending: 'abc', fraud_open: null }]) {
      const v = s.badge(input);
      assert.ok(Number.isFinite(v), `${s.id}: ${v}`);
    }
  }
  assert.equal(Object.keys(by).filter((id) => by[id].badge).sort().join(','), 'alerts,complaints,ledger,marketing,payouts,rules,today,verify');
});

test('state: set đổi giá trị và báo subscriber, hủy được', async () => {
  const { createState } = await import('../public/admin/core/state.js');
  const s = createState({ demo: true });
  assert.equal(s.admin, null); assert.equal(s.work, null); assert.equal(s.demo, true);
  const seen = [];
  const off = s.subscribe((key, value) => seen.push([key, value]));
  s.set('work', { fraud_open: 1 });
  assert.deepEqual(s.work, { fraud_open: 1 });
  off(); s.set('admin', { id: 'a' });
  assert.deepEqual(seen, [['work', { fraud_open: 1 }]]);
  assert.throws(() => s.set('subscribe', 1));
});

function fakeClient(over = {}) {
  const calls = [];
  const auth = {
    signInWithPassword: async () => ({ data: { user: { id: 'a1' }, session: { access_token: 'tok' } }, error: null }),
    getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
    signOut: async () => { calls.push('signOut'); return {}; },
    onAuthStateChange: (cb) => { calls.push(cb); return { data: { subscription: { unsubscribe() { calls.push('unsub'); } } } }; },
    ...over,
  };
  return { calls, client: { auth } };
}
async function withClient(fake, fn) {
  const { createAuth } = await import('../public/admin/core/auth.js');
  const prev = globalThis.window;
  let opts;
  globalThis.window = { supabase: { createClient: (url, key, o) => { opts = { url, key, o }; return fake.client; } } };
  try { return await fn(createAuth({ supabaseUrl: 'https://x', supabaseKey: 'k' }), opts); } finally { globalThis.window = prev; }
}

test('auth: createClient đúng storageKey; signIn sai mật khẩu → thông điệp chuẩn', async () => {
  const fake = fakeClient({ signInWithPassword: async () => ({ data: {}, error: { status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } }) });
  await withClient(fake, async (auth, opts) => {
    assert.deepEqual(opts, { url: 'https://x', key: 'k', o: { auth: { storageKey: 'foodsave-admin-auth', persistSession: true, autoRefreshToken: true } } });
    assert.deepEqual(await auth.signIn('a@b.vn', 'sai'), { ok: false, message: 'Email hoặc mật khẩu không đúng.' });
    assert.equal(await auth.getToken(), 'tok');
  });
  await withClient(fakeClient(), async (auth) => assert.deepEqual(await auth.signIn(' a@b.vn ', 'dung'), { ok: true }));
  // 400 khác sai mật khẩu (vd chưa xác nhận email) không bị báo nhầm là sai mật khẩu
  const unconfirmed = fakeClient({ signInWithPassword: async () => ({ data: {}, error: { status: 400, code: 'email_not_confirmed', message: 'Email not confirmed' } }) });
  await withClient(unconfirmed, async (auth) => {
    const r = await auth.signIn('a@b.vn', 'x');
    assert.equal(r.ok, false); assert.notEqual(r.message, 'Email hoặc mật khẩu không đúng.');
  });
  const byMessage = fakeClient({ signInWithPassword: async () => ({ data: {}, error: { message: 'Invalid login credentials' } }) });
  await withClient(byMessage, async (auth) => assert.equal((await auth.signIn('a@b.vn', 'x')).message, 'Email hoặc mật khẩu không đúng.'));
  // Không lỗi nhưng không có phiên → không coi là đăng nhập được
  const noSession = fakeClient({ signInWithPassword: async () => ({ data: { user: { id: 'a1' } }, error: null }) });
  await withClient(noSession, async (auth) => assert.deepEqual(await auth.signIn('a@b.vn', 'x'), { ok: false, message: 'Không thể đăng nhập. Vui lòng thử lại.' }));
});

test('form đăng nhập: method="post", nút submit tắt sẵn và app.js chặn submit trước createAuth(', () => {
  const page = readFileSync('public/admin/index.html', 'utf8');
  assert.match(page, /<form id="login"[^>]*\bmethod="post"/u);
  // Module lỗi nạp thì handler không bao giờ được gắn: nút phải tắt sẵn để form không gửi mật khẩu
  assert.match(page, /<form id="login"[\s\S]*?<button type="submit"[^>]*\bdisabled\b[^>]*>Đăng nhập<\/button>[\s\S]*?<\/form>/u);
  const app = src('core/app.js');
  const submitAt = app.search(/addEventListener\(\s*'submit'/);
  const createAt = app.search(/=\s*createAuth\(/);
  const bootAt = app.indexOf('async function boot(');
  assert.ok(submitAt >= 0, 'app.js chưa gắn handler submit');
  assert.ok(createAt > 0 && submitAt < createAt, 'handler submit phải gắn trước createAuth(');
  assert.ok(submitAt < bootAt, 'handler submit phải gắn ở cấp module, trước boot()');
  const enableAt = app.search(/button\[type="submit"\]'\)\.disabled = false/);
  assert.ok(enableAt > submitAt && enableAt < bootAt, 'nút submit chỉ bật lại ngay sau khi gắn handler, trước boot()');
});

test('auth: refresh không có phương thức/lỗi → false; có phiên → true', async () => {
  await withClient(fakeClient(), async (auth) => assert.equal(await auth.refresh(), false));
  await withClient(fakeClient({ refreshSession: async () => ({ data: { session: null }, error: { message: 'x' } }) }), async (auth) => assert.equal(await auth.refresh(), false));
  await withClient(fakeClient({ refreshSession: async () => ({ data: { session: { access_token: 't2' } }, error: null }) }), async (auth) => assert.equal(await auth.refresh(), true));
  await withClient(fakeClient({ getSession: async () => { throw new Error('x'); } }), async (auth) => assert.equal(await auth.getToken(), null));
});

test('auth: ensureAdmin chỉ nhận admin chưa bị khóa, còn lại signOut + null', async () => {
  const api = (data) => ({ get: async (p) => { assert.equal(p, '/profile/me'); return data; } });
  const fake = fakeClient();
  await withClient(fake, async (auth) => {
    assert.deepEqual(await auth.ensureAdmin(api({ id: 'a1', role: 'admin', full_name: 'Ad', email: 'a@b.vn', status: 'active', phone: 'x' })),
      { id: 'a1', full_name: 'Ad', email: 'a@b.vn' });
    assert.equal(fake.calls.filter((c) => c === 'signOut').length, 0);
    assert.equal(await auth.ensureAdmin(api({ id: 'u', role: 'customer', status: 'active' })), null);
    assert.equal(await auth.ensureAdmin(api({ id: 'a2', role: 'admin', status: 'suspended' })), null);
    assert.equal(await auth.ensureAdmin({ get: async () => { const e = new Error('hết hạn'); e.status = 401; throw e; } }), null);
    assert.equal(fake.calls.filter((c) => c === 'signOut').length, 3);
    await assert.rejects(auth.ensureAdmin({ get: async () => { const e = new Error('mạng'); e.code = 'NETWORK'; throw e; } }), /mạng/u);
    const seen = [];
    const off = auth.onChange((s) => seen.push(s));
    fake.calls.find((c) => typeof c === 'function')('SIGNED_OUT', null);
    assert.deepEqual(seen, [null]); off(); assert.ok(fake.calls.includes('unsub'));
  });
});

test('shell: tìm màn không dấu, không phân biệt hoa thường', async () => {
  const { matchScreens } = await import('../public/admin/core/shell.js');
  const { SCREENS } = await import('../public/admin/screens/manifest.js');
  assert.deepEqual(matchScreens('hom nay', SCREENS).map((s) => s.id), ['today']);
  assert.deepEqual(matchScreens('RUT TIEN', SCREENS).map((s) => s.id), ['payouts']);
  assert.deepEqual(matchScreens('ĐƠN HÀNG', SCREENS).map((s) => s.id), ['orders']);
  assert.deepEqual(matchScreens('ghep don', SCREENS).map((s) => s.id), ['donations']);
  assert.deepEqual(matchScreens('  ', SCREENS), []);
});

test('vouchers: voucherForm khớp voucherBodySchema, chỉ gửi trường có giá trị', async () => {
  const { voucherForm, voucherState, localToIso } = await import('../public/admin/screens/vouchers.js');
  const ok = { code: 'MIO10', name: 'Giảm mười', description: '', type: 'percent', value: '10', min: '', max: '', from: '2026-12-01T08:00', to: '2026-12-31T23:30' };
  assert.deepEqual(voucherForm(ok), { errors: [], body: { code: 'MIO10', name: 'Giảm mười', percent_off: 10, starts_at: '2026-12-01T08:00:00+07:00', expires_at: '2026-12-31T23:30:00+07:00' } });
  assert.equal(voucherForm({ ...ok, type: 'fixed', value: '20000', min: '0', max: '5' }).body.fixed_discount_cents, 20000);
  for (const patch of [{ code: 'ab' }, { code: 'a b c' }, { name: 'x' }, { value: '0' }, { value: '101' }, { value: '10.5' }, { type: 'fixed', value: '999' }, { min: '-1' }, { max: '0' }, { to: '2026-12-01T08:00' }, { from: '' }]) {
    assert.ok(voucherForm({ ...ok, ...patch }).errors.length > 0, JSON.stringify(patch));
  }
  assert.equal(localToIso('not-a-date'), null);
  const now = Date.parse('2026-11-23T00:00:00Z');
  const v = { is_active: true, starts_at: '2026-11-01T00:00:00Z', expires_at: '2026-12-01T00:00:00Z' };
  assert.equal(voucherState(v, now), 'live');
  assert.equal(voucherState({ ...v, is_active: false }, now), 'off');
  assert.equal(voucherState({ ...v, expires_at: '2026-11-10T00:00:00Z' }, now), 'expired');
  assert.equal(voucherState({ ...v, starts_at: '2026-11-30T00:00:00Z' }, now), 'scheduled');
  assert.equal(voucherState({ ...v, max_redemptions: 5, redemption_count: 5 }, now), 'used_up');
  assert.equal(voucherState({ ...v, max_redemptions: 5, redemption_count: 4 }, now), 'live');
  assert.equal(voucherState({ ...v, max_redemptions: 5, redemption_count: 5, expires_at: '2026-11-10T00:00:00Z' }, now), 'expired');
  assert.equal(voucherState({ ...v, state: 'used_up' }, now), 'used_up'); // ưu tiên state của server
});

test('esg: resolveMonth chỉ nhận YYYY-MM hợp lệ', async () => {
  const { resolveMonth } = await import('../public/admin/screens/esg.js');
  assert.equal(resolveMonth('2026-10', '2026-11'), '2026-10');
  for (const bad of ['abc', '2026-13', '2026-1', '', undefined, '2026-10-01']) assert.equal(resolveMonth(bad, '2026-11'), '2026-11');
});
