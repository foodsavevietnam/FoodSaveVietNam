import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../public/admin/core/api.js';
import { parseHash, buildHash } from '../public/admin/core/router.js';
import { html, raw, esc } from '../public/admin/core/ui.js';
import { vnd, dt, stamp, maskPhone, left, monthVn } from '../public/admin/core/format.js';
import { VI, badge, ACTIONS, actionLabel } from '../public/admin/core/vi.js';
import { dataTable } from '../public/admin/core/table.js';

const jsonRes = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const make = (fetch, extra = {}) => createApi({ fetch, getToken: async () => 'tok', baseUrl: 'http://x/api', ...extra });
const catchErr = async (p) => { try { await p; } catch (e) { return e; } return null; };

test('parseHash: rỗng → today; có query → params', () => {
  assert.deepEqual(parseHash(''), { screen: 'today', params: {} });
  assert.deepEqual(parseHash('#'), { screen: 'today', params: {} });
  assert.deepEqual(parseHash('#/'), { screen: 'today', params: {} });
  assert.deepEqual(parseHash('#/orders?page=2&status=ready'), { screen: 'orders', params: { page: '2', status: 'ready' } });
  assert.equal(parseHash('#/Bad!x').screen, 'today');
});

test('buildHash encode giá trị', () => assert.equal(buildHash('orders', { q: 'a b' }), '#/orders?q=a%20b'));

test('api: thành công bóc data', async () => {
  const api = make(async () => jsonRes(200, { success: true, data: { x: 1 } }));
  assert.deepEqual(await api.get('/a'), { x: 1 });
});

test('api: mạng lỗi → NETWORK', async () => {
  const e = await catchErr(make(async () => { throw new TypeError('fail'); }).get('/a'));
  assert.ok(e instanceof ApiError);
  assert.equal(e.code, 'NETWORK');
  assert.equal(e.message, 'Không kết nối được máy chủ.');
});

test('api: JSON hỏng → BAD_RESPONSE', async () => {
  const e = await catchErr(make(async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('x'); } })).get('/a'));
  assert.equal(e.code, 'BAD_RESPONSE');
  assert.equal(e.message, 'Máy chủ trả dữ liệu không hợp lệ.');
});

test('api: 401 → AUTH_INVALID_TOKEN + onUnauthorized', async () => {
  let n = 0;
  const api = make(async () => jsonRes(401, {}), { onUnauthorized: () => { n += 1; } });
  const e = await catchErr(api.get('/a'));
  assert.equal(e.code, 'AUTH_INVALID_TOKEN');
  assert.equal(e.status, 401);
  assert.equal(e.message, 'Phiên đăng nhập đã hết hạn.');
  assert.equal(n, 1);
});

test('api: {success:false} giữ code backend', async () => {
  const api = make(async () => jsonRes(400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'x', details: [1] } }));
  const e = await catchErr(api.post('/a', { a: 1 }));
  assert.equal(e.code, 'VALIDATION_ERROR');
  assert.equal(e.message, 'x');
  assert.equal(e.status, 400);
  assert.deepEqual(e.details, [1]);
});

test('api: không token → AUTH_MISSING_TOKEN, không gọi fetch', async () => {
  let called = 0;
  const api = createApi({ fetch: async () => { called += 1; }, getToken: async () => null, baseUrl: 'http://x' });
  const e = await catchErr(api.get('/a'));
  assert.equal(e.code, 'AUTH_MISSING_TOKEN');
  assert.equal(called, 0);
});

const hangingFetch = (url, init) => new Promise((_, reject) => {
  const abortErr = () => init.signal.reason ?? new DOMException('Aborted', 'AbortError');
  if (init.signal.aborted) return reject(abortErr());
  init.signal.addEventListener('abort', () => reject(abortErr()));
});

test('api: timeout → TIMEOUT', async () => {
  const e = await catchErr(make(hangingFetch, { timeoutMs: 10 }).get('/a'));
  assert.equal(e.code, 'TIMEOUT');
  assert.equal(e.message, 'Máy chủ phản hồi quá lâu.');
});

test('api: người gọi hủy → ném lại AbortError, không thành TIMEOUT', async () => {
  const ac = new AbortController();
  const p = catchErr(make(hangingFetch, { timeoutMs: 5000 }).get('/a', { signal: ac.signal }));
  ac.abort();
  const e = await p;
  assert.equal(e.name, 'AbortError');
  assert.ok(!(e instanceof ApiError));
});

const hangingJson = (status = 200, body = {}) => async (url, init) => ({
  status,
  ok: status < 400,
  json: () => new Promise((_, reject) => {
    const abortErr = () => init.signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (init.signal.aborted) return reject(abortErr());
    init.signal.addEventListener('abort', () => reject(abortErr()));
  }),
});

test('api: res.json() treo rồi timeout → TIMEOUT', async () => {
  const e = await catchErr(make(hangingJson(), { timeoutMs: 10 }).get('/a'));
  assert.equal(e.code, 'TIMEOUT');
});

test('api: người gọi hủy lúc đọc body → AbortError gốc, không gọi onUnauthorized', async () => {
  let n = 0;
  const ac = new AbortController();
  const api = make(hangingJson(401), { timeoutMs: 5000, onUnauthorized: () => { n += 1; } });
  const p = catchErr(api.get('/a', { signal: ac.signal }));
  setTimeout(() => ac.abort(), 20);
  const e = await p;
  assert.equal(e.name, 'AbortError');
  assert.ok(!(e instanceof ApiError));
  assert.equal(n, 0);
});

test('html escape và raw', () => {
  assert.equal(html`<b>${'<x>'}</b>`, '<b>&lt;x&gt;</b>');
  assert.equal(html`${raw('<i>ok</i>')}`, '<i>ok</i>');
  assert.equal(esc(`a&"'<`), 'a&amp;&quot;&#39;&lt;');
  assert.equal(html`${[raw('<i>1</i>'), 'x<']}`, '<i>1</i>x&lt;');
});

test('vnd/dt/stamp/maskPhone/left', () => {
  assert.equal(vnd(65000), '65.000đ');
  assert.equal(vnd(1234567), '1.234.567đ');
  assert.equal(maskPhone('0901234567'), '090***567');
  assert.equal(dt('2026-11-23T03:05:00Z'), '10:05 23/11');
  assert.equal(stamp('2026-11-23T03:05:00Z'), '2026-11-23 10:05');
  assert.equal(dt(''), '—');
  assert.equal(stamp('xyz'), '—');
  const now = Date.now();
  assert.equal(left(new Date(now + 10 * 60000).toISOString(), now).level, 'err');
  assert.equal(left(new Date(now + 22 * 60000).toISOString(), now).text, 'còn 22 phút');
  assert.equal(left(new Date(now + 22 * 60000).toISOString(), now).level, 'warn');
  assert.equal(left(new Date(now + 90 * 60000).toISOString(), now).level, 'ok');
  assert.deepEqual(left(new Date(now - 1000).toISOString(), now), { text: 'Đã hết hạn', level: 'err' });
  assert.deepEqual(left('bad'), { text: '—', level: 'm' });
});

test('vi.badge', () => {
  assert.match(badge('order', 'weird'), /b-m/);
  assert.match(badge('order', '<img>'), /&lt;img&gt;/);
  assert.equal(badge('order', 'no_show'), '<span class="b b-e">Khách vắng mặt</span>');
  assert.equal(VI.withdrawal.paid[0], 'Đã chuyển');
  assert.match(badge('payoutAccount', 'pending_verification'), /Chờ xác minh/);
  assert.match(badge('payoutWarning', 'name_mismatch'), /b-w.*Tên chủ tài khoản khác tên chủ cửa hàng/);
  assert.ok(badge('ledger', 'charge').includes('Khách trả (giữ chờ)'));
  assert.match(badge('fraud', 'shared_ip'), /Nhiều tài khoản cùng mạng/);
  assert.equal(badge('fraudStatus', 'open'), '<span class="b b-w">Chưa xử lý</span>');
  assert.equal(badge('fraudStatus', 'handled'), '<span class="b b-ok">Đã xử lý</span>');
  assert.equal(badge('fraudStatus', 'dismissed'), '<span class="b b-m">Đã bỏ qua</span>');
});

test('dataTable sort + phân trang', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: i + 1, name: 'n' + i, total: (i * 7) % 45 + i }));
  const t = dataTable({ columns: [{ key: 'name', label: 'Tên' }, { key: 'total', label: 'Tổng', sort: true }], rows, sort: { key: 'total', dir: 'desc' } });
  const max = Math.max(...rows.map((r) => r.total));
  assert.equal(t.state.rows[0].total, max);
  assert.equal(t.state.pageRows.length, 20);
  assert.equal(t.state.pages, 3);
  assert.match(t.html(), /data-act="page" data-page="2"/);
  t.state.page = 3;
  assert.equal(t.state.pageRows.length, 5);
  assert.equal(dataTable({ columns: [], rows: [], emptyText: 'Trống' }).html().includes('Trống'), true);
});

// ---- core/poll.js ----
import { createPoll } from '../public/admin/core/poll.js';

function pollRig(opts = {}) {
  const st = { t: 0, vis: true, n: 0 };
  const poll = createPoll({ now: () => st.t, visible: () => st.vis, ...opts });
  const job = () => { st.n += 1; };
  return { st, poll, job };
}

test('poll (a): everyMs 60000 chạy ở 0s, không ở 30s, chạy ở 60s', () => {
  const { st, poll, job } = pollRig();
  poll.add('j', job, { everyMs: 60000, immediate: true });
  poll.tick(); assert.equal(st.n, 1);
  st.t = 30000; poll.tick(); assert.equal(st.n, 1);
  st.t = 60000; poll.tick(); assert.equal(st.n, 2);
});

test('poll: mặc định coi như vừa chạy, không gọi trùng lần tải đầu', () => {
  const { st, poll, job } = pollRig();
  poll.add('j', job, { everyMs: 60000 });
  poll.tick(); assert.equal(st.n, 0);
  st.t = 60000; poll.tick(); assert.equal(st.n, 1);
});

test('poll (b): tab ẩn → không chạy', () => {
  const { st, poll, job } = pollRig();
  st.vis = false;
  poll.add('j', job, { everyMs: 1000, immediate: true });
  st.t = 5000; poll.tick();
  assert.equal(st.n, 0);
});

test('poll (c): rảnh 15 phút → paused; touch → chạy ngay, hết paused', () => {
  const calls = [];
  const { st, poll, job } = pollRig({ onPaused: (p) => calls.push(p) });
  poll.add('j', job, { everyMs: 60000 });
  st.t = 900000; poll.tick(); poll.tick();
  assert.equal(poll.isPaused(), true);
  assert.equal(st.n, 0);
  assert.deepEqual(calls, [true]);
  poll.touch();
  assert.equal(poll.isPaused(), false);
  assert.equal(st.n, 1);
  assert.deepEqual(calls, [true, false]);
});

test('poll (d): hai tick(true) cách 3 giây → chạy 1 lần (minGap)', () => {
  const { st, poll, job } = pollRig();
  poll.add('j', job, { everyMs: 60000, immediate: true });
  st.t = 100000; poll.tick(true);
  st.t = 103000; poll.tick(true);
  assert.equal(st.n, 1);
  st.t = 110000; poll.tick(true);
  assert.equal(st.n, 2);
});

test('poll (e): demo=true → 0 lần', () => {
  const { st, poll, job } = pollRig({ demo: true });
  poll.add('j', job, { everyMs: 1000, immediate: true });
  st.t = 100000; poll.tick(); poll.tick(true);
  assert.equal(st.n, 0);
});

test('poll: paused vẫn chạy job có idleMs riêng, bỏ qua job không có', () => {
  const { st, poll } = pollRig();
  let a = 0, b = 0;
  poll.add('a', () => { a += 1; }, { everyMs: 60000, immediate: true });
  poll.add('b', () => { b += 1; }, { everyMs: 60000, idleMs: 120000, immediate: true });
  st.t = 900000; poll.tick();
  assert.equal(poll.isPaused(), true);
  assert.equal([a, b].join(), '0,1');
  st.t = 960000; poll.tick(); assert.equal(b, 1);
  st.t = 1020000; poll.tick(); assert.equal(b, 2);
});

test('poll: remove theo tên và theo tiền tố *, add trùng tên thay job', () => {
  const { st, poll } = pollRig();
  let x = 0, y = 0, z = 0;
  poll.add('screen:a', () => { x += 1; }, { everyMs: 1000, immediate: true });
  poll.add('screen:b', () => { y += 1; }, { everyMs: 1000, immediate: true });
  poll.add('app:c', () => { z += 1; }, { everyMs: 1000, immediate: true });
  poll.remove('screen:*');
  st.t = 5000; poll.tick();
  assert.equal([x, y, z].join(), '0,0,1');
  poll.add('app:c', () => { x += 10; }, { everyMs: 1000, immediate: true });
  st.t = 9000; poll.tick();
  assert.equal([x, z].join(), '10,1');
  poll.remove('app:c');
  st.t = 20000; poll.tick();
  assert.equal(x, 10);
});

test('poll: job async chưa xong thì bỏ lượt; lỗi job không làm chết tick', async () => {
  const { st, poll } = pollRig();
  let n = 0, release;
  poll.add('slow', () => { n += 1; return new Promise((r) => { release = r; }); }, { everyMs: 1000, immediate: true });
  poll.add('bad', () => { throw new Error('x'); }, { everyMs: 1000, immediate: true });
  const warn = console.warn; console.warn = () => {};
  try {
    st.t = 2000; poll.tick();
    st.t = 4000; poll.tick();
    assert.equal(n, 1);
    release(); await new Promise((r) => setImmediate(r));
    st.t = 6000; poll.tick();
    assert.equal(n, 2);
  } finally { console.warn = warn; }
});

test('poll: attach nghe tương tác + heartbeat, gỡ sạch', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const st = { t: 0, n: 0 };
  const poll = createPoll({ now: () => st.t });
  poll.add('j', () => { st.n += 1; }, { everyMs: 60000, immediate: true });
  const handlers = {};
  const doc = { visibilityState: 'visible', addEventListener: (k, f) => { handlers['d' + k] = f; }, removeEventListener: (k) => { delete handlers['d' + k]; } };
  const detach = poll.attach(doc);
  st.t = 5000; t.mock.timers.tick(5000);
  assert.equal(st.n, 1);
  st.t = 900000 + 5000; t.mock.timers.tick(5000);
  assert.equal(poll.isPaused(), true);
  handlers.dpointerdown();
  assert.equal(poll.isPaused(), false);
  detach();
  assert.equal(Object.keys(handlers).length, 0);
  const before = st.n; st.t += 999999; t.mock.timers.tick(10000);
  assert.equal(st.n, before);
});

test('poll: pause() thủ công giữ nguyên qua tick, resume() chạy lại', () => {
  const { st, poll, job } = pollRig();
  poll.add('j', job, { everyMs: 1000, immediate: true });
  poll.pause(); st.t = 5000; poll.tick();
  assert.equal(poll.isPaused(), true); assert.equal(st.n, 0);
  poll.resume();
  assert.equal(poll.isPaused(), false); assert.equal(st.n, 1);
});

function fakeDoc(state = 'visible') {
  const handlers = {};
  return {
    visibilityState: state, handlers,
    addEventListener(k, f) { handlers[k] = f; },
    removeEventListener(k) { delete handlers[k]; },
  };
}

test('poll attach: không truyền visible → theo doc.visibilityState', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const st = { t: 0, n: 0 };
  const poll = createPoll({ now: () => st.t });
  poll.add('j', () => { st.n += 1; }, { everyMs: 1000 });
  const doc = fakeDoc('hidden');
  const detach = poll.attach(doc);
  for (let i = 1; i <= 5; i += 1) { st.t = i * 5000; t.mock.timers.tick(5000); }
  assert.equal(st.n, 0);
  doc.visibilityState = 'visible';
  st.t = 26000;
  doc.handlers.visibilitychange();
  assert.equal(st.n, 1);
  doc.visibilityState = 'hidden';
  st.t = 60000; doc.handlers.visibilitychange();
  assert.equal(st.n, 1);
  detach();
});

test('poll: now nhảy 1 giờ khi tab ẩn rồi hiện lại → mỗi job chạy đúng 1 lần', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const st = { t: 0 };
  const poll = createPoll({ now: () => st.t });
  let a = 0, b = 0;
  poll.add('a', () => { a += 1; }, { everyMs: 60000 });
  poll.add('b', () => { b += 1; }, { everyMs: 60000 });
  const doc = fakeDoc('hidden');
  poll.attach(doc);
  st.t = 3600000; t.mock.timers.tick(5000);
  assert.equal(a + b, 0);
  doc.visibilityState = 'visible';
  doc.handlers.visibilitychange();
  assert.equal([a, b].join(), '1,1');
  poll.tick();
  assert.equal([a, b].join(), '1,1');
});

test('poll: rảnh 20 phút rồi touch → mỗi job chạy đúng 1 lần, tick ngay sau không chạy thêm', () => {
  const { st, poll } = pollRig();
  let a = 0, b = 0;
  poll.add('a', () => { a += 1; }, { everyMs: 60000 });
  poll.add('b', () => { b += 1; }, { everyMs: 60000 });
  st.t = 1200000; poll.tick();
  assert.equal(a + b, 0);
  poll.touch();
  assert.equal([a, b].join(), '1,1');
  poll.tick(); poll.tick(true);
  assert.equal([a, b].join(), '1,1');
});

test('actionLabel: action đã biết → chữ tiếng Việt; action lạ → nguyên văn', () => {
  assert.equal(actionLabel('verification.approve'), 'Duyệt hồ sơ');
  assert.equal(actionLabel('verification.reject'), 'Từ chối hồ sơ');
  assert.equal(actionLabel('customer.unlock'), 'Mở khóa nhãn đỏ cho khách');
  assert.equal(actionLabel('fraud.dismissed'), 'Bỏ qua cảnh báo gian lận');
  assert.equal(actionLabel('withdrawal.pay'), 'Xác nhận đã chi tiền rút');
  assert.equal(actionLabel('payout_account.reveal'), 'Xem số tài khoản đầy đủ');
  assert.equal(actionLabel('payout_account.verify'), 'Xác minh tài khoản nhận tiền');
  assert.equal(actionLabel('complaint.refund_partial'), 'Khiếu nại: hoàn một phần');
  for (const k of ['approve', 'reject', 'start', 'pay', 'fail']) assert.notEqual(actionLabel(`withdrawal.${k}`), `withdrawal.${k}`);
  assert.equal(actionLabel('lạ.hành_động'), 'lạ.hành_động');
  assert.equal(actionLabel(''), '—');
  assert.equal(actionLabel(null), '—');
  assert.equal(actionLabel('toString'), 'toString'); // không lọt qua prototype
  for (const [key, text] of Object.entries(ACTIONS)) assert.ok(text && !/[a-z]+\.[a-z_]+/.test(text), `${key}: nhãn còn mã thô`);
});

test('monthVn: tháng theo giờ Việt Nam, qua ranh giới UTC', () => {
  assert.equal(monthVn(Date.parse('2026-11-23T05:00:00Z')), '2026-11');
  assert.equal(monthVn(Date.parse('2026-11-30T17:30:00Z')), '2026-12'); // 00:30 ngày 1/12 giờ VN
  assert.equal(monthVn(Date.parse('2026-12-31T16:59:00Z')), '2026-12');
});

test('vi: bảng lý do và quyết định khiếu nại', () => {
  assert.equal(VI.complaintReason.spoiled_expired, 'Hư hỏng / hết hạn');
  assert.equal(VI.complaintDecision.refund_partial, 'Hoàn một phần');
  assert.deepEqual(Object.keys(VI.complaintDecision), ['refund_full', 'refund_partial', 'reject']);
});

test('badge voucher: 4 trạng thái tiếng Việt', () => {
  assert.equal(badge('voucher', 'live'), '<span class="b b-ok">Đang bật</span>');
  assert.match(badge('voucher', 'off'), /Đã tắt/);
  assert.match(badge('voucher', 'expired'), /Hết hạn/);
  assert.match(badge('voucher', 'scheduled'), /Chưa bắt đầu/);
  assert.match(badge('voucher', 'used_up'), /b-w.*Hết lượt/);
});
