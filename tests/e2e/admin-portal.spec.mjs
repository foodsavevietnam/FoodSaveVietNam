import { expect, test } from '@playwright/test';
import { FAKE_SUPABASE, stubAdmin } from './helpers/fake-supabase.mjs';
import work from '../../public/admin/demo/fixtures/work.js';
import audit from '../../public/admin/demo/fixtures/audit.js';
import finance from '../../public/admin/demo/fixtures/finance.js';
import labels from '../../public/admin/demo/fixtures/labels.js';
import esg from '../../public/admin/demo/fixtures/esg.js';
import automation from '../../public/admin/demo/fixtures/automation.js';
import complaints, { messages as chatMessages } from '../../public/admin/demo/fixtures/complaints.js';
import payouts, { REVEAL_SAMPLE } from '../../public/admin/demo/fixtures/payouts.js';
import alerts from '../../public/admin/demo/fixtures/alerts.js';
import policy from '../../public/admin/demo/fixtures/policy.js';
import vouchers from '../../public/admin/demo/fixtures/vouchers.js';
import verify, { accounts as payoutAccounts } from '../../public/admin/demo/fixtures/verify.js';
import * as fxCustomers from '../../public/admin/demo/fixtures/customers.js';
import * as fxStores from '../../public/admin/demo/fixtures/stores.js';
import * as fxCharities from '../../public/admin/demo/fixtures/charities.js';

// Cổng quản trị mới (/admin/index.html). Auth Supabase và API đều được stub.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };

const PAYLOAD = '<img src=x onerror="window.__xss=1">';
const XSS_AUDIT = [{ id: 'x1', actor_id: 'a1', actor_name: PAYLOAD, action: PAYLOAD, target_type: PAYLOAD, target_id: PAYLOAD, detail: { note: PAYLOAD, [PAYLOAD]: PAYLOAD }, created_at: '2026-11-23T08:15:00.000Z' }];
// Nhật ký có nhóm/đối tượng mới (rút tiền, tài khoản nhận tiền, khiếu nại, cài đặt) để kiểm nhãn tiếng Việt
const ACTOR_B = '7b1c2d3e-0000-4000-8000-000000000002';
const MONEY_AUDIT = [
  { id: 'm1', actor_id: 'a1', actor_name: 'Admin Thử', action: 'withdrawal.pay', target_type: 'withdrawal', target_id: '9f8e7d6c-1111-4222-8333-444455556666', detail: { bank_txn_ref: 'FT2026112300999' }, created_at: '2026-11-23T08:15:00.000Z' },
  { id: 'm2', actor_id: ACTOR_B, actor_name: 'Admin Hai', action: 'complaint.refund_partial', target_type: 'complaint', target_id: 'c0a1b2c3-0001', detail: { refund_cents: 15000, is_false_claim: false, note: 'Hoàn một phần' }, created_at: '2026-11-23T07:15:00.000Z' },
  { id: 'm3', actor_id: 'a1', actor_name: 'Admin Thử', action: 'payout_account.verify', target_type: 'payout_account', target_id: 'aa11bb22-3333-4444-5555-666677778888', detail: { note: 'Đã gọi xác nhận' }, created_at: '2026-11-23T06:15:00.000Z' },
  { id: 'm4', actor_id: 'a1', actor_name: 'Admin Thử', action: 'settings.update', target_type: 'app_setting', target_id: 'marketing', detail: { key: 'marketing', before: { on: false }, after: { on: true }, la_ma: 'x' }, created_at: '2026-11-23T05:15:00.000Z' },
];

// Máy chủ giả: state.audit = 'ok' | 'unauthorized' | 'unauthorized-once' | 'error' | 'missing'
//              state.finance = 'ok' | 'error' | 'slow' (trả sau 1 giây)
function makeApi(state) {
  return async (route, { path, method }) => {
    const bare = path.split('?')[0];
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') {
      if (state.work === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      // Sau một quyết định duyệt hồ sơ thành công, số hồ sơ chờ giảm 1
      if (state.verifyDecided) return route.fulfill(ok({ ...work, verification_pending: work.verification_pending - 1 }));
      return route.fulfill(ok(work));
    }
    if (bare === '/admin/finance/summary') {
      if (state.finance === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      if (state.finance === 'slow') await new Promise((resolve) => setTimeout(resolve, 1000));
      return route.fulfill(ok(finance));
    }
    if (bare === '/admin/complaints') return route.fulfill(ok(state.complaints || complaints));
    if (/^\/admin\/complaints\/[^/]+\/decision$/.test(bare)) {
      if (state.decision === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      return route.fulfill(ok({ ok: true }));
    }
    if (/^\/orders\/[^/]+\/messages$/.test(bare)) {
      if (state.chat === 'forbidden') return route.fulfill(fail(403, 'CHAT_FORBIDDEN', 'Bạn không có quyền xem chat này'));
      return route.fulfill(ok({ messages: chatMessages, can_send: false }));
    }
    if (bare === '/admin/verification') return route.fulfill(ok(verify));
    if (bare === '/admin/payout-accounts') return route.fulfill(ok(state.accounts || payoutAccounts));
    if ((bare.startsWith('/admin/verification/') && bare.endsWith('/decision')) || bare.startsWith('/admin/payout-accounts/')) {
      state.verifyDecided = true;
      return route.fulfill(ok({ ok: true }));
    }
    if (bare === '/admin/fraud-alerts') return route.fulfill(ok(state.alerts || alerts));
    if (bare === '/admin/fraud-alerts/handle') return route.fulfill(ok({ key: 'x', status: 'handled' }));
    if (bare === '/admin/withdrawals') {
      // Hỗ trợ lọc đủ 6 trạng thái ở server
      const status = new URLSearchParams(path.split('?')[1] || '').get('status');
      return route.fulfill(ok(status ? payouts.filter((w) => w.status === status) : payouts));
    }
    if (/^\/admin\/withdrawals\/[^/]+\/reveal-account$/.test(bare)) return route.fulfill(ok(REVEAL_SAMPLE));
    if (/^\/admin\/withdrawals\/[^/]+$/.test(bare)) {
      if (state.withdrawal === 'error') return route.fulfill(fail(409, 'PAYOUT_INVALID_TRANSITION', 'Lệnh rút không ở trạng thái phù hợp cho bước này'));
      return route.fulfill(ok({ ok: true }));
    }
    if (bare === '/admin/labels') return route.fulfill(ok(labels));
    if (bare === '/admin/esg') return route.fulfill(ok(esg));
    if (bare === '/admin/vouchers') {
      if (method === 'POST' && state.voucherCreate === 'conflict') return route.fulfill(fail(409, 'RESOURCE_CONFLICT', 'Mã voucher đã tồn tại'));
      if (method === 'POST') return route.fulfill(ok({ id: 'v-new' }));
      return route.fulfill(ok(vouchers));
    }
    if (/^\/admin\/vouchers\/[^/]+$/.test(bare)) return route.fulfill(ok({ ok: true }));
    if (bare === '/admin/automation') return route.fulfill(ok(automation));
    if (/^\/admin\/automation\/[^/]+\/run$/.test(bare)) return route.fulfill(ok({ processed: 1 }));
    if (bare === '/admin/order-policy') {
      if (method === 'PUT' && state.policySave === 'invalid') return route.fulfill(fail(422, 'VALIDATION_ERROR', 'Nhãn Đỏ: máy chủ từ chối giá trị này'));
      if (method === 'PUT') return route.fulfill(ok({ ok: true }));
      return route.fulfill(ok(state.policy || policy));
    }
    if (bare === '/admin/order-policy/reset') return route.fulfill(ok({ ok: true }));
    if (bare === '/admin/audit-log') {
      if (state.audit === 'unauthorized') return route.fulfill(fail(401, 'AUTH_INVALID_TOKEN', 'Hết hạn'));
      if (state.audit === 'unauthorized-once') { state.audit = 'ok'; return route.fulfill(fail(401, 'AUTH_INVALID_TOKEN', 'Hết hạn')); }
      if (state.audit === 'missing') return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có'));
      if (state.audit === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      if (state.audit === 'xss') return route.fulfill(ok(XSS_AUDIT));
      if (state.audit === 'money') return route.fulfill(ok(MONEY_AUDIT));
      return route.fulfill(ok(audit));
    }
    if (bare === '/admin/search') {
      const q = (new URLSearchParams(path.split('?')[1] || '').get('q') || '').trim().toLowerCase();
      const hit = (vals) => q.length >= 2 && vals.some((v) => String(v || '').toLowerCase().includes(q));
      return route.fulfill(ok({
        query: q,
        accounts: fxCustomers.accounts.filter((a) => hit([a.full_name, a.email, a.phone])).slice(0, 5),
        stores: fxStores.stores.filter((s) => hit([s.name, s.address])).slice(0, 5),
        charities: fxCharities.charities.filter((c) => hit([c.name, c.address])).slice(0, 5),
        orders: [],
        complaints: [],
      }));
    }
    const reqBody = method === 'GET' ? undefined : route.request().postDataJSON?.();
    for (const fx of [fxCustomers, fxStores, fxCharities]) {
      const hit = fx.resolve(method, bare, reqBody, path);
      if (hit !== undefined) return route.fulfill(ok(hit));
    }
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có'));
  };
}

async function setup(page, { fakeSb = {}, audit: auditMode = 'ok', finance: financeMode = 'ok', work: workMode = 'ok', complaints: complaintRows, chat = 'ok', decision = 'ok', withdrawal = 'ok', policySave = 'ok', policy: policyData, voucherCreate = 'ok', accounts, ignoreStatuses = [] } = {}) {
  const state = { voucherCreate, policySave, policy: policyData, withdrawal, audit: auditMode, finance: financeMode, work: workMode, complaints: complaintRows, chat, decision, accounts };
  const stub = await stubAdmin(page, { api: makeApi(state), fakeSb, ignoreStatuses });
  return { state, ...stub };
}

const workCalls = (calls) => calls.filter((c) => c.path.split('?')[0] === '/admin/dashboard/work').length;
const fakeCalls = (page) => page.evaluate(() => ({ ...window.__FAKE_SB_CALLS }));

test('shell: 19 mục sidebar, huy hiệu từ dashboard/work, không lỗi console', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/today`);
  await expect(page.locator('.S-i')).toHaveCount(19);
  await expect(page.locator('em[data-badge="complaints"]')).toHaveText('3');
  await expect(page.locator('#pt')).toHaveText('Hôm nay');
  expect(errors).toEqual([]);
});

test('401 + làm mới phiên lỗi → màn đăng nhập, giữ hash, đăng nhập lại quay về #/audit, không mount trùng', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { fakeSb: {}, ignoreStatuses: [401] });
  await page.goto(`${PAGE}#/audit`);
  await expect(page.locator('.S-i[data-p="audit"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#screen table tbody tr')).toHaveCount(audit.length); // màn Nhật ký đã tải xong rồi mới đổi trạng thái máy chủ giả

  state.audit = 'unauthorized';
  await page.click('#bell');
  await expect(page.locator('body')).toHaveClass(/admin-locked/);
  await expect(page.locator('#login')).toBeVisible();
  expect(await page.evaluate(() => location.hash)).toBe('#/audit');
  expect((await fakeCalls(page)).refresh).toBe(1);

  state.audit = 'ok';
  const before = workCalls(calls);
  await page.fill('input[name="email"]', 'admin@mio.vn');
  await page.fill('input[name="password"]', 'mat-khau-thu');
  await page.click('#login button[type="submit"]');
  await expect(page.locator('body')).not.toHaveClass(/admin-locked/);
  expect(await page.evaluate(() => location.hash)).toBe('#/audit');
  await expect(page.locator('.S-i[data-p="audit"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.S-i')).toHaveCount(19);
  await expect(page.locator('#sidebar')).toHaveCount(1);
  await page.waitForTimeout(2000);
  expect(workCalls(calls) - before).toBe(1); // không gắn trùng poll/listener
  await expect(page.locator('.S-i')).toHaveCount(19);
  expect((await fakeCalls(page)).signIn).toBe(1);
  expect(errors).toEqual([]);
});

test('401 + làm mới phiên thành công → không khóa, vẽ lại màn, làm mới đúng 1 lần', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { fakeSb: { refreshOk: true }, ignoreStatuses: [401] });
  await page.goto(`${PAGE}#/audit`);
  await expect(page.locator('.S-i[data-p="audit"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#screen table tbody tr')).toHaveCount(audit.length); // màn Nhật ký đã tải xong rồi mới đổi trạng thái máy chủ giả
  await expect(page.locator('#screen .P')).toHaveCount(1);
  await expect.poll(() => workCalls(calls)).toBe(1);

  state.audit = 'unauthorized-once';
  await page.click('#bell');
  await expect.poll(async () => (await fakeCalls(page)).refresh).toBe(1);
  await expect.poll(() => workCalls(calls)).toBe(2); // refreshWork chạy lại sau khi làm mới phiên
  await expect(page.locator('body')).not.toHaveClass(/admin-locked/);
  await expect(page.locator('.S-i[data-p="audit"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#screen .P')).toHaveCount(1);
  await page.waitForTimeout(500);
  expect((await fakeCalls(page)).refresh).toBe(1);

  // Sau khi làm mới, chuông dùng lại được bình thường
  await page.click('#bell');
  await expect(page.locator('#drawer')).toContainText('Duyệt hồ sơ');
  expect(errors).toEqual([]);
});

test('500 → hiện nút Thử lại, bấm → gọi lại API', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { audit: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/today`);
  await expect(page.locator('.S-i')).toHaveCount(19);
  const auditCalls = () => calls.filter((c) => c.path.startsWith('/admin/audit-log')).length;
  await page.click('#bell');
  const retry = page.locator('#drawer [data-role="retry"]');
  await expect(retry).toBeVisible();
  await expect(retry).toHaveText('Thử lại');
  await expect(page.locator('#drawer')).toContainText('Lỗi máy chủ');
  expect(auditCalls()).toBe(1);

  state.audit = 'ok';
  await retry.click();
  await expect.poll(auditCalls).toBe(2);
  await expect(page.locator('#drawer')).toContainText('Duyệt hồ sơ');
  await expect(page.locator('#drawer [data-role="retry"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('render đua: chuyển nhanh #/complaints → #/verify → #/audit chỉ còn màn cuối', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/today`);
  await expect(page.locator('#pt')).toHaveText('Hôm nay');
  await page.evaluate(() => {
    location.hash = '#/complaints';
    location.hash = '#/verify';
    location.hash = '#/audit';
  });
  await expect(page.locator('#pt')).toHaveText('Nhật ký');
  await expect(page.locator('.S-i[aria-current="page"]')).toHaveCount(1);
  await expect(page.locator('.S-i[aria-current="page"]')).toHaveAttribute('data-p', 'audit');
  await expect(page.locator('#screen > *')).toHaveCount(1);
  await expect(page.locator('#screen .P')).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(page.locator('#pt')).toHaveText('Nhật ký');
  await expect(page.locator('#screen > *')).toHaveCount(1);
  expect(await page.title()).toContain('Nhật ký');
  expect(errors).toEqual([]);
});

test('render đua: today → complaints → audit khi finance/summary trả chậm → chỉ còn Nhật ký, today không vẽ đè', async ({ page }) => {
  const { calls, errors } = await setup(page, { finance: 'slow' });
  const financeCalls = () => calls.filter((c) => c.path.startsWith('/admin/finance/summary')).length;
  await page.goto(`${PAGE}#/today`);
  await expect.poll(financeCalls).toBe(1); // today đã bắt đầu render và đang chờ finance/summary
  await expect(page.locator('#screen [data-role="work"]')).toBeVisible();
  await page.evaluate(() => {
    location.hash = '#/complaints';
    location.hash = '#/audit';
  });
  await expect(page.locator('#pt')).toHaveText('Nhật ký');
  expect(financeCalls()).toBe(1);
  await expect(page.locator('#screen [data-act="filter"]')).toBeVisible();
  await expect(page.locator('#screen [data-role="work"]')).toHaveCount(0);
  await page.waitForTimeout(1600); // quá hạn 1 giây của finance/summary: màn today cũ không được vẽ đè
  await expect(page.locator('#screen [data-act="filter"]')).toBeVisible();
  await expect(page.locator('#screen [data-role="work"]')).toHaveCount(0);
  await expect(page.locator('#screen [data-block]')).toHaveCount(0);
  await expect(page.locator('#screen')).not.toContainText('VIỆC CẦN LÀM');
  expect(errors).toEqual([]);
});

test('today: 3 khối mức Đỏ/Vàng/Xám, bấm dòng khiếu nại → #/complaints', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/today`);
  const box = page.locator('#screen [data-role="work"]');
  await expect(box).toContainText('VIỆC CẦN LÀM');
  await expect(box.locator('[data-level="e"]')).toContainText('3 khiếu nại chờ Admin');
  await expect(box.locator('[data-level="e"]')).toContainText('1 lệnh rút tiền chờ duyệt');
  await expect(box.locator('[data-level="w"]')).toContainText('2 hồ sơ chờ duyệt');
  await expect(box.locator('[data-level="w"]')).toContainText('1 tài khoản nhận tiền chờ xác minh');
  await expect(box.locator('[data-level="w"]')).toContainText('1 cảnh báo gian lận đang mở');
  await expect(box.locator('[data-level="m"]')).toContainText('1 tác vụ tự động bị lỗi');
  await expect(box.locator('[data-level="m"]')).not.toContainText('khóa nhãn đỏ'); // số 0 thì ẩn
  // 4 ô số
  await expect(page.locator('[data-block="finance"]')).toContainText('480.000đ');
  await expect(page.locator('[data-block="finance"]')).toContainText('Nền tảng 1.250.000đ'); // khóa thật platform_revenue
  await expect(page.locator('[data-block="today"]')).toContainText('18');
  await expect(page.locator('[data-block="esg"]')).toContainText('412,5');
  await expect(page.locator('[data-block="labels"]')).toContainText('12');
  await expect(page.locator('#screen')).not.toContainText('no_show');
  await box.locator('[data-act="go"][data-screen="complaints"]').click();
  await expect(page.locator('#pt')).toHaveText('Khiếu nại');
  expect(await page.evaluate(() => location.hash)).toBe('#/complaints');
  expect(errors).toEqual([]);
});

test('today: finance/summary lỗi 500 → khối Tiền có Thử lại (chỉ gọi lại finance), khối Việc vẫn có dữ liệu', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { finance: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/today`);
  const retry = page.locator('[data-block="finance"] [data-role="retry"]');
  await expect(retry).toBeVisible();
  await expect(page.locator('[data-block="finance"]')).toContainText('Lỗi máy chủ');
  await expect(page.locator('#screen [data-role="work"] [data-act="go"]').first()).toBeVisible();
  await expect(page.locator('[data-block="labels"]')).toContainText('12');
  const count = (re) => calls.filter((c) => re.test(c.path)).length;
  expect(count(/finance\/summary/)).toBe(1);
  expect(count(/\/admin\/labels/)).toBe(1);
  expect(count(/dashboard\/work/)).toBe(1); // today không tự gọi work, dùng số của app

  state.finance = 'ok';
  await retry.click();
  await expect(page.locator('[data-block="finance"]')).toContainText('480.000đ');
  expect(count(/finance\/summary/)).toBe(2);
  expect(count(/\/admin\/labels/)).toBe(1); // khối khác không bị gọi lại
  expect(count(/\/admin\/esg/)).toBe(1);
  expect(count(/\/admin\/automation/)).toBe(1);
  expect(errors).toEqual([]);
});

test('today: dashboard/work lỗi → khối việc và ô Hôm nay có Thử lại; bấm chỉ gọi lại work', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { work: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/today`);
  const retry = page.locator('#screen [data-role="work"] [data-role="retry"]');
  await expect(retry).toBeVisible();
  await expect(page.locator('[data-block="today"] [data-role="retry"]')).toBeVisible();
  await expect(page.locator('[data-block="finance"]')).toContainText('480.000đ');
  const count = (re) => calls.filter((c) => re.test(c.path)).length;
  const before = count(/dashboard\/work/); // app và today có thể mỗi bên gọi một lần trước khi lỗi
  expect(before).toBeGreaterThanOrEqual(1);
  state.work = 'ok';
  await retry.click();
  await expect(page.locator('#screen [data-role="work"] [data-act="go"]').first()).toBeVisible();
  await expect(page.locator('[data-block="today"]')).toContainText('18');
  expect(count(/dashboard\/work/)).toBe(before + 1);
  expect(count(/finance\/summary/)).toBe(1);
  expect(count(/\/admin\/labels/)).toBe(1);
  expect(count(/\/admin\/esg/)).toBe(1);
  expect(count(/\/admin\/automation/)).toBe(1);
  expect(errors).toEqual([]);
});

test('audit: dữ liệu có mã HTML độc hại được escape, không thực thi', async ({ page }) => {
  const { errors } = await setup(page, { audit: 'xss' });
  await page.goto(`${PAGE}#/audit`);
  await expect(page.locator('#screen table tbody tr')).toHaveCount(1);
  await page.locator('#screen details summary').click();
  await expect(page.locator('#screen details')).toContainText('<img');
  await expect(page.locator('#screen table img')).toHaveCount(0);
  await expect(page.locator('#screen img')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('audit: lọc tiền tố verification. → request ?limit=100&action=verification., bảng dùng chữ tiếng Việt', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/audit`);
  const auditPaths = () => calls.filter((c) => c.path.startsWith('/admin/audit-log')).map((c) => c.path);
  await expect(page.locator('#screen table tbody tr')).toHaveCount(audit.length);
  expect(auditPaths()).toEqual(['/admin/audit-log?limit=100']);
  await expect(page.locator('#screen')).toContainText('Duyệt hồ sơ');
  await expect(page.locator('#screen')).not.toContainText('verification.approve');
  await page.selectOption('#screen select[name="action_group"]', 'verification.');
  await page.click('#screen [data-act="filter"]');
  await expect.poll(auditPaths).toEqual(['/admin/audit-log?limit=100', '/admin/audit-log?limit=100&action=verification.']);
  await page.fill('#screen input[name="from"]', '2026-11-20');
  await page.fill('#screen input[name="to"]', '2026-11-23');
  await page.click('#screen [data-act="filter"]');
  await expect.poll(() => auditPaths().length).toBe(3);
  const last = new URL('http://x' + auditPaths()[2]).searchParams;
  expect(last.get('action')).toBe('verification.');
  expect(last.get('from')).toBe('2026-11-20T00:00:00+07:00');
  expect(last.get('to')).toBe('2026-11-23T23:59:59.999+07:00');
  expect(errors).toEqual([]);
});

test('?demo=1 → không gọi API thật, hiện thanh xem thử', async ({ page }) => {
  const { calls, errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/today`);
  await expect(page.locator('.S-i')).toHaveCount(19);
  await expect(page.locator('.v2demo')).toHaveText('Chế độ xem thử · dữ liệu mẫu');
  await expect(page.locator('em[data-badge="complaints"]')).toHaveText('3');
  await expect(page.locator('[data-role="admin-name"]')).toHaveText('Quản trị viên (xem thử)');
  await expect(page.locator('body')).not.toHaveClass(/admin-locked/);
  await page.click('#bell');
  await expect(page.locator('#drawer')).toContainText('Duyệt hồ sơ');
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('bộ lọc lỗi không nuốt lỗi ngoài dự kiến: API trả 404 → errors không rỗng', async ({ page }) => {
  const { errors } = await setup(page, { audit: 'missing', ignoreStatuses: [401, 500] });
  await page.goto(`${PAGE}#/today`);
  await expect(page.locator('.S-i')).toHaveCount(19);
  await page.click('#bell');
  await expect(page.locator('#drawer [data-role="retry"]')).toBeVisible();
  await expect.poll(() => errors.length).toBeGreaterThan(0);
  expect(errors.join(' ')).toMatch(/404/);
});

// ---- Màn Khiếu nại ----
const CMP_NOTE = 'Ảnh không khớp <b>đơn</b>';
const cmpRows = (patch = {}) => complaints.map((c) => (c.status === 'in_review' ? { ...c, ...patch } : c));
const decisionCalls = (calls) => calls.filter((c) => c.method === 'POST' && /\/decision$/.test(c.path));

test('complaints: cột Chờ Admin có 1 thẻ từ fixture, 5 ô tổng quan và top cửa hàng, không lộ mã thô', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/complaints`);
  await expect(page.locator('[data-col="in_review"] [data-act="open"]')).toHaveCount(1);
  await expect(page.locator('[data-col="open"] [data-act="open"]')).toHaveCount(1);
  await expect(page.locator('[data-col="done"] [data-act="open"]')).toHaveCount(1);
  await expect(page.locator('[data-role="chips"] [data-chip]')).toHaveCount(5);
  await expect(page.locator('[data-role="top-stores"]')).toContainText('Tiệm bánh Hoa Sữa');
  const text = await page.locator('#screen').innerText();
  for (const code of ['in_review', 'spoiled_expired', 'missing_items', 'wrong_item', 'refund_full', 'resolved']) expect(text).not.toContain(code);
  expect(errors).toEqual([]);
});

test('complaints: Bác bỏ với note rỗng → nút Gửi disabled; nhập note → body đúng, note hiện nguyên văn (đã escape)', async ({ page }) => {
  const { calls, errors } = await setup(page, { complaints: cmpRows({ issue: CMP_NOTE, image_urls: ['http://x.test/a.jpg', 'https://example.com/ok.jpg'] }) });
  await page.goto(`${PAGE}#/complaints`);
  await page.click('[data-col="in_review"] [data-act="open"]');
  const drawer = page.locator('#drawer');
  await expect(drawer.locator('[data-role="chat"]')).toContainText('Bánh còn hạn nhé bạn.');
  await expect(drawer.locator('[data-role="cmp-drawer"] b')).toHaveCount(0); // tiêu đề ngăn kéo của ui.drawer tự có thẻ b
  await expect(drawer).toContainText(CMP_NOTE);
  await expect(drawer.locator('img')).toHaveCount(1);
  await expect(drawer.locator('img')).toHaveAttribute('src', 'https://example.com/ok.jpg');
  await expect(drawer).toContainText('Ảnh không hợp lệ');
  await drawer.locator('input[name="decision"][value="reject"]').check();
  await expect(drawer.locator('[data-act="submit"]')).toBeDisabled();
  await expect(drawer.locator('[data-role="false-claim"]')).toBeVisible();
  await drawer.locator('textarea[name="note"]').fill(CMP_NOTE);
  await expect(drawer.locator('[data-act="submit"]')).toBeEnabled();
  await drawer.locator('[data-act="submit"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect.poll(() => decisionCalls(calls).length).toBe(1);
  expect(decisionCalls(calls)[0].body).toEqual({ decision: 'reject', note: CMP_NOTE });
  await expect(drawer).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('complaints: Hoàn một phần với số tiền ≥ tổng đơn → không gửi', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/complaints`);
  await page.click('[data-col="in_review"] [data-act="open"]');
  const drawer = page.locator('#drawer');
  await drawer.locator('input[name="decision"][value="refund_partial"]').check();
  await drawer.locator('textarea[name="note"]').fill('Hoàn một phần');
  await expect(drawer.locator('[data-role="partial-box"]')).toBeVisible();
  await drawer.locator('input[name="refund"]').fill('120000');
  await expect(drawer.locator('[data-act="submit"]')).toBeDisabled();
  await drawer.locator('input[name="refund"]').fill('0');
  await expect(drawer.locator('[data-act="submit"]')).toBeDisabled();
  await drawer.locator('input[name="refund"]').fill('119999');
  await expect(drawer.locator('[data-act="submit"]')).toBeEnabled();
  await drawer.locator('input[name="refund"]').fill('120000');
  await drawer.locator('[data-act="submit"]').click({ force: true });
  await expect(page.locator('#modal')).not.toHaveClass(/open/);
  expect(decisionCalls(calls)).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('complaints: chat trả 403 CHAT_FORBIDDEN → drawer hiện thông báo tiếng Việt', async ({ page }) => {
  const { errors } = await setup(page, { chat: 'forbidden', ignoreStatuses: [403] });
  await page.goto(`${PAGE}#/complaints`);
  await page.click('[data-col="in_review"] [data-act="open"]');
  await expect(page.locator('#drawer [data-role="chat"]')).toContainText('Chỉ xem được chat khi đơn có khiếu nại');
  expect(errors).toEqual([]);
});

test('complaints: số tiền một phần chỉ nhận số nguyên VND (-5000, 1000.5 bị chặn; 1.000 → 1000)', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/complaints`);
  await page.click('[data-col="in_review"] [data-act="open"]');
  const drawer = page.locator('#drawer');
  await drawer.locator('input[name="decision"][value="refund_partial"]').check();
  await drawer.locator('textarea[name="note"]').fill('Hoàn một phần');
  for (const bad of ['-5000', '1000.5', '1,5']) {
    await drawer.locator('input[name="refund"]').fill(bad);
    await expect(drawer.locator('[data-act="submit"]')).toBeDisabled();
    await expect(drawer.locator('[data-role="refund-preview"]')).toContainText('Chỉ nhập số nguyên (VND)');
  }
  await drawer.locator('input[name="refund"]').fill('1.000');
  await expect(drawer.locator('[data-act="submit"]')).toBeEnabled();
  await drawer.locator('[data-act="submit"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect.poll(() => decisionCalls(calls).length).toBe(1);
  expect(decisionCalls(calls)[0].body).toEqual({ decision: 'refund_partial', refund_cents: 1000, note: 'Hoàn một phần' });
  expect(errors).toEqual([]);
});

test('complaints: POST decision lỗi 500 → toast lỗi, drawer vẫn mở, nút Gửi bật lại, giữ nội dung', async ({ page }) => {
  const { errors } = await setup(page, { decision: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/complaints`);
  await page.click('[data-col="in_review"] [data-act="open"]');
  const drawer = page.locator('#drawer');
  await drawer.locator('textarea[name="note"]').fill('Hoàn đủ cho khách');
  await drawer.locator('[data-act="submit"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts .v2toast-err')).toContainText('Lỗi máy chủ');
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer.locator('[data-act="submit"]')).toBeEnabled();
  await expect(drawer.locator('textarea[name="note"]')).toHaveValue('Hoàn đủ cho khách');
  expect(errors).toEqual([]);
});

// ---- Màn Duyệt hồ sơ ----
const verifyCalls = (calls) => calls.filter((c) => c.method !== 'GET' && (c.path.startsWith('/admin/verification/') || c.path.startsWith('/admin/payout-accounts/')));

test('verify: từ chối cửa hàng không lý do bị chặn; có lý do → body đúng, toast, huy hiệu giảm', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/verify`);
  await expect(page.locator('em[data-badge="verify"]')).toHaveText('3');
  const row = page.locator('[data-role="stores-table"] tr', { hasText: 'Tiệm bánh Hoa Sữa' });
  await row.locator('[data-act="reject"]').click();
  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('ab');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  expect(verifyCalls(calls)).toEqual([]);
  await modal.locator('[data-role="reason"]').fill('Thiếu giấy phép kinh doanh');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã từ chối');
  await expect(page.locator('em[data-badge="verify"]')).toHaveText('2');
  const made = verifyCalls(calls);
  expect(made.length).toBe(1);
  expect(made[0].method).toBe('POST');
  expect(made[0].path).toBe('/admin/verification/store/s-2001/decision');
  expect(made[0].body).toEqual({ decision: 'reject', reason: 'Thiếu giấy phép kinh doanh' });
  expect(errors).toEqual([]);
});

test('verify: duyệt tổ chức → POST kind=charity; tab lưu trong hash', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/verify`);
  await page.click('[data-act="tab"][data-tab="charities"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/verify?tab=charities');
  await page.locator('[data-role="charities-table"] [data-act="approve"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã duyệt');
  const made = verifyCalls(calls);
  expect(made.length).toBe(1);
  expect(made[0].path).toBe('/admin/verification/charity/ch-3001/decision');
  expect(made[0].body).toEqual({ decision: 'approve' });
  expect(errors).toEqual([]);
});

test('verify: tài khoản nhận tiền: tên lệch có cảnh báo, xác minh tên khớp → PATCH {decision:verify}, không lộ mã thô/số đầy đủ', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/verify?tab=accounts`);
  const mismatch = page.locator('[data-role="accounts-table"] tr', { hasText: 'TRAN VAN B' });
  await expect(mismatch).toContainText('Tên chủ tài khoản khác tên chủ cửa hàng');
  const okRow = page.locator('[data-role="accounts-table"] tr', { hasText: 'LE MINH CHAU' });
  await expect(okRow).not.toContainText('Tên chủ tài khoản khác tên chủ cửa hàng');
  await expect(okRow).toContainText('9876');
  const text = await page.locator('#screen').innerText();
  for (const code of ['pending_verification', 'name_mismatch', 'verification.approve', 'verification.reject']) expect(text).not.toContain(code);
  await okRow.locator('[data-act="verify"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã xác minh tài khoản');
  const made = verifyCalls(calls);
  expect(made.length).toBe(1);
  expect(made[0].method).toBe('PATCH');
  expect(made[0].path).toBe('/admin/payout-accounts/pa-2');
  expect(made[0].body).toEqual({ decision: 'verify' });
  expect(errors).toEqual([]);
});

test('verify: lịch sử hiện chữ tiếng Việt, lý do từ chối đã escape', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/verify`);
  const hist = page.locator('[data-role="history"]');
  await expect(hist).toContainText('Duyệt hồ sơ');
  await expect(hist).toContainText('Siêu thị Xanh');
  expect(errors).toEqual([]);
});

// ---- Màn Rút tiền & chi trả ----
const wdCalls = (calls) => calls.filter((c) => c.path.startsWith('/admin/withdrawals/'));
const openWd = async (page, name) => {
  await page.locator('[data-role="withdrawals-table"] tr', { hasText: name }).locator('[data-act="open"]').click();
  return page.locator('#drawer [data-role="payout-drawer"]');
};

test('payouts: tab mặc định Chờ duyệt có số lượng; Từ chối không lý do bị chặn; có lý do → PATCH {reject, note}', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts`);
  await expect(page.locator('[data-act="tab"][data-tab="requested"]')).toContainText('Chờ duyệt (1)');
  await expect(page.locator('[data-role="withdrawals-table"]')).toContainText('1.500.000đ');
  const panel = await openWd(page, 'Tiệm bánh Hoa Sữa');
  await expect(panel).toContainText('••••4321');
  await panel.locator('[data-act="reject"]').click();
  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('ab');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  expect(wdCalls(calls)).toEqual([]);
  await modal.locator('[data-role="reason"]').fill('Số dư chưa đủ');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã từ chối lệnh rút');
  const made = wdCalls(calls);
  expect(made.length).toBe(1);
  expect(made[0].method).toBe('PATCH');
  expect(made[0].path).toBe('/admin/withdrawals/wd-1');
  expect(made[0].body).toEqual({ decision: 'reject', note: 'Số dư chưa đủ' });
  expect(errors).toEqual([]);
});

test('payouts: Duyệt → PATCH {decision:approve}; Bắt đầu chi (tab approved) → {decision:start}', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts`);
  let panel = await openWd(page, 'Tiệm bánh Hoa Sữa');
  await panel.locator('[data-act="approve"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã duyệt lệnh rút');
  await page.click('[data-act="tab"][data-tab="approved"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/payouts?tab=approved');
  panel = await openWd(page, 'Siêu thị Xanh');
  await panel.locator('[data-act="start"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã bắt đầu chi');
  const made = wdCalls(calls);
  expect(made.map((c) => [c.path, c.body])).toEqual([
    ['/admin/withdrawals/wd-1', { decision: 'approve' }],
    ['/admin/withdrawals/wd-2', { decision: 'start' }],
  ]);
  expect(errors).toEqual([]);
});

test('payouts: tab processing gọi ?status=processing; Đã chi cần mã GD 3..80; có mã → body {pay, bank_txn_ref}', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts?tab=processing`);
  const table = page.locator('[data-role="withdrawals-table"]');
  await expect(table).toContainText('Bếp Nhà Lan');
  await expect(table).not.toContainText('Tiệm bánh Hoa Sữa');
  expect(calls.filter((c) => c.path.startsWith('/admin/withdrawals')).every((c) => c.path === '/admin/withdrawals?status=processing')).toBe(true);
  const panel = await openWd(page, 'Bếp Nhà Lan');
  const pay = panel.locator('[data-act="pay"]');
  await expect(pay).toBeDisabled();
  await panel.locator('[name="bank_txn_ref"]').fill('  ab  ');
  await expect(pay).toBeDisabled();
  await panel.locator('[name="bank_txn_ref"]').fill('FT123');
  await expect(pay).toBeEnabled();
  await pay.click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã ghi nhận chi tiền');
  const made = wdCalls(calls);
  expect(made.length).toBe(1);
  expect(made[0].path).toBe('/admin/withdrawals/wd-3');
  expect(made[0].body).toEqual({ decision: 'pay', bank_txn_ref: 'FT123' });
  expect(errors).toEqual([]);
});

test('payouts: Thất bại cần lý do → {fail, note}; lỗi 409 → toast lỗi, drawer giữ nguyên, nút bật lại', async ({ page }) => {
  const { calls, errors } = await setup(page, { withdrawal: 'error', ignoreStatuses: [409] });
  await page.goto(`${PAGE}#/payouts?tab=processing`);
  const panel = await openWd(page, 'Bếp Nhà Lan');
  await panel.locator('[data-act="fail"]').click();
  await expect(page.locator('#modal [data-role="ok"]')).toBeDisabled();
  await page.locator('#modal [data-role="reason"]').fill('Sai số tài khoản');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('không ở trạng thái phù hợp');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-act="fail"]')).toBeEnabled();
  expect(wdCalls(calls)[0].body).toEqual({ decision: 'fail', note: 'Sai số tài khoản' });
  expect(errors).toEqual([]);
});

test('payouts: Hiện số đầy đủ → POST reveal, số hiện, tự che sau 60 giây (clock), đóng drawer cũng xóa số', async ({ page }) => {
  await page.clock.install();
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts?tab=approved`);
  const panel = await openWd(page, 'Siêu thị Xanh');
  await expect(panel).toContainText('••••9876');
  await expect(panel).not.toContainText(REVEAL_SAMPLE.account_number);
  await panel.locator('[data-act="reveal"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(panel).toContainText(REVEAL_SAMPLE.account_number);
  const made = calls.filter((c) => c.method === 'POST' && c.path === '/admin/withdrawals/wd-2/reveal-account');
  expect(made.length).toBe(1);
  await page.clock.fastForward(59000);
  await expect(panel).toContainText(REVEAL_SAMPLE.account_number);
  await page.clock.fastForward(2000);
  await expect(panel).not.toContainText(REVEAL_SAMPLE.account_number);
  await expect(panel).toContainText('••••9876');
  // Lần hiện thứ hai trong cùng drawer cũng phải tự che
  await panel.locator('[data-act="reveal"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(panel).toContainText(REVEAL_SAMPLE.account_number);
  await page.clock.fastForward(61000);
  await expect(panel).not.toContainText(REVEAL_SAMPLE.account_number);
  await expect(panel).toContainText('••••9876');
  // Hiện lần ba rồi đóng drawer: số không còn trong DOM, timer bị hủy (tua 61 giây không sinh lỗi/toast)
  await panel.locator('[data-act="reveal"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(panel).toContainText(REVEAL_SAMPLE.account_number);
  await page.click('#drawer [data-role="drawer-close"]');
  expect(await page.evaluate((n) => document.body.innerText.includes(n), REVEAL_SAMPLE.account_number)).toBe(false);
  await page.clock.fastForward(61000);
  expect(await page.evaluate((n) => document.body.innerText.includes(n), REVEAL_SAMPLE.account_number)).toBe(false);
  await expect(page.locator('#toasts .v2toast')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('payouts: không lộ mã thô trạng thái trên DOM, mọi tab dùng chữ tiếng Việt', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts`);
  for (const key of ['requested', 'approved', 'processing', 'paid', 'failed', 'rejected']) {
    await page.click(`[data-act="tab"][data-tab="${key}"]`);
    await expect(page.locator(`[data-act="tab"][data-tab="${key}"]`)).toHaveAttribute('aria-current', 'page');
    const text = await page.locator('#screen').innerText();
    for (const code of ['requested', 'approved', 'processing', 'failed', 'rejected']) expect(text).not.toContain(code);
  }
  await expect(page.locator('[data-role="withdrawals-table"]')).toContainText('Từ chối');
  expect(errors).toEqual([]);
});

test('payouts: lệnh approved có Hủy lệnh (lý do → {reject, note}) và Đã chi (mã GD → {pay, bank_txn_ref})', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts?tab=approved`);
  let panel = await openWd(page, 'Siêu thị Xanh');
  await expect(panel.locator('[data-act="start"]')).toBeVisible();
  await expect(panel.locator('[data-act="pay"]')).toBeDisabled();
  await panel.locator('[data-act="reject"]').click();
  await expect(page.locator('#modal')).toContainText('Hủy lệnh rút');
  await expect(page.locator('#modal [data-role="ok"]')).toBeDisabled();
  await page.locator('#modal [data-role="reason"]').fill('Hủy theo yêu cầu cửa hàng');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã hủy lệnh rút');
  panel = await openWd(page, 'Siêu thị Xanh');
  await panel.locator('[name="bank_txn_ref"]').fill('FT999');
  await panel.locator('[data-act="pay"]').click();
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đã ghi nhận chi tiền');
  expect(wdCalls(calls).map((c) => [c.path, c.body])).toEqual([
    ['/admin/withdrawals/wd-2', { decision: 'reject', note: 'Hủy theo yêu cầu cửa hàng' }],
    ['/admin/withdrawals/wd-2', { decision: 'pay', bank_txn_ref: 'FT999' }],
  ]);
  expect(errors).toEqual([]);
});

// ---- Màn Cảnh báo gian lận ----
const alertGets = (calls) => calls.filter((c) => c.method === 'GET' && c.path.split('?')[0] === '/admin/fraud-alerts').length;
const alertPosts = (calls) => calls.filter((c) => c.method === 'POST' && c.path === '/admin/fraud-alerts/handle');

test('alerts: ô Cao đếm đúng số dòng, bấm lại bỏ lọc, lọc lưu trong hash, không tải lại', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/alerts`);
  const rows = page.locator('[data-role="alerts-table"] tbody tr');
  await expect(rows).toHaveCount(7);
  const high = page.locator('[data-act="filter"][data-filter="high"]');
  await expect(high).toContainText('Cao (2)');
  await high.click();
  await expect(rows).toHaveCount(2);
  expect(await page.evaluate(() => location.hash)).toBe('#/alerts?f=high');
  await high.click();
  await expect(rows).toHaveCount(7);
  expect(await page.evaluate(() => location.hash)).toBe('#/alerts');
  await page.locator('[data-act="filter"][data-filter="open"]').click();
  await expect(rows).toHaveCount(5);
  expect(alertGets(calls)).toBe(1);
  await expect(page.locator('[data-role="not-detected"]')).toContainText('vân tay thiết bị');
  expect(errors).toEqual([]);
});

test('alerts: Xử lý (ghi chú trống) → body {key,status}, dòng đổi tại chỗ, không tải lại; Bỏ qua có ghi chú → body có note', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/alerts`);
  const modal = page.locator('#modal');
  const row1 = page.locator('[data-role="alerts-table"] tr[data-key="high_cancel_rate:c-101"]');
  await row1.locator('[data-act="handled"]').click();
  await expect(modal.locator('[data-role="ok"]')).toBeEnabled();
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã ghi nhận xử lý');
  await expect(row1).toContainText('Đã xử lý');
  await expect(row1.locator('[data-act="handled"]')).toHaveCount(0);
  await expect(page.locator('[data-act="filter"][data-filter="high"]')).toContainText('Cao (1)');
  expect(alertPosts(calls).map((c) => c.body)).toEqual([{ key: 'high_cancel_rate:c-101', status: 'handled' }]);
  expect(alertGets(calls)).toBe(1);

  const row2 = page.locator('[data-role="alerts-table"] tr[data-key="shared_ip:10.0.0.7"]');
  await row2.locator('[data-act="dismissed"]').click();
  await modal.locator('[data-role="reason"]').fill('Wifi văn phòng');
  await modal.locator('[data-role="ok"]').click();
  await expect(row2).toContainText('Đã bỏ qua');
  await expect(row2).toContainText('Wifi văn phòng');
  expect(alertPosts(calls)[1].body).toEqual({ key: 'shared_ip:10.0.0.7', status: 'dismissed', note: 'Wifi văn phòng' });
  expect(errors).toEqual([]);
});

test('alerts: Mở hồ sơ chỉ cho khách; không lộ mã thô', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/alerts`);
  const link = page.locator('tr[data-key="high_cancel_rate:c-101"] a[data-role="open-profile"]');
  await expect(link).toHaveAttribute('href', '#/customers?id=c-101');
  await expect(page.locator('tr[data-key="shared_ip:10.0.0.7"] a')).toHaveCount(0);
  const text = await page.locator('[data-screen="alerts"]').innerText();
  for (const code of ['high_cancel_rate', 'shared_ip', 'dismissed', 'repeat_no_show', 'long_pending_payment']) expect(text).not.toContain(code);
  expect(text).toContain('Hủy nhiều');
  expect(errors).toEqual([]);
});

test('alerts: poll thay dữ liệu trong lúc hộp xác nhận mở → sau Xử lý dòng vẫn đổi trạng thái, số ô giảm 1, chỉ 1 POST', async ({ page }) => {
  await page.clock.install();
  const { state, calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/alerts`);
  const rows = page.locator('[data-role="alerts-table"] tbody tr');
  await expect(rows).toHaveCount(7);
  const open = page.locator('[data-act="filter"][data-filter="open"]');
  await expect(open).toContainText('Đang mở (5)');
  const row = page.locator('[data-role="alerts-table"] tr[data-key="high_cancel_rate:c-101"]');
  await row.locator('[data-act="handled"]').click();
  await expect(page.locator('#modal [data-role="ok"]')).toBeVisible();
  state.alerts = structuredClone(alerts); // mảng mới cùng key, vẫn open
  await page.clock.fastForward(121000);
  await expect.poll(() => alertGets(calls)).toBeGreaterThanOrEqual(2);
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã ghi nhận xử lý');
  await expect(row).toContainText('Đã xử lý');
  await expect(row.locator('[data-act="handled"], [data-act="dismissed"]')).toHaveCount(0);
  await expect(open).toContainText('Đang mở (4)');
  expect(alertPosts(calls).length).toBe(1);
  expect(errors).toEqual([]);
});

const policyWrites = (calls) => calls.filter((c) => ['PUT', 'POST'].includes(c.method) && c.path.startsWith('/admin/order-policy'));
const autoGets = (calls) => calls.filter((c) => c.method === 'GET' && c.path === '/admin/automation').length;

test('rules: hủy miễn phí 100 > hạn lấy 90 → báo lỗi, Lưu disabled, không PUT; hợp lệ → PUT đúng shape số nguyên', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/rules`);
  const save = page.locator('[data-act="save"]');
  await expect(page.locator('#pf_yellow_pick')).toHaveValue('90');
  await expect(save).toBeDisabled(); // chưa thay đổi
  await page.locator('#pf_yellow_free').fill('100');
  await expect(page.locator('[data-role="errors"]')).toContainText('Nhãn Vàng: thời gian hủy miễn phí (100) phải nhỏ hơn hạn lấy hàng (90)');
  await expect(save).toBeDisabled();
  expect(policyWrites(calls)).toEqual([]);
  await page.locator('#pf_yellow_free').fill('25');
  await expect(page.locator('[data-role="errors"]')).toBeHidden();
  await expect(save).toBeEnabled();
  await page.locator('#pf_red_ban_days').fill('14');
  await save.click();
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã lưu cấu hình');
  const puts = policyWrites(calls);
  expect(puts.length).toBe(1);
  expect(puts[0].method).toBe('PUT');
  expect(puts[0].body).toEqual({
    labels: {
      green: { payMinutes: 10, pickupMinutes: 120, cancelFreeBeforePickupMinutes: 30, finalReminderMinutes: 15 },
      yellow: { payMinutes: 10, pickupMinutes: 90, cancelFreeBeforePickupMinutes: 25, finalReminderMinutes: 15 },
      red: { payMinutes: 5, pickupMinutes: 60, cancelFreeBeforePickupMinutes: 15, finalReminderMinutes: 10 },
    },
    grace_cancel_minutes: 3, min_pickup_window_minutes: 15, no_show_ban_count: 3, no_show_window_days: 30, red_ban_days: 14,
  });
  expect(errors).toEqual([]);
});

test('rules: số thập phân bị chặn; khôi phục mặc định → confirm danger → POST reset', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/rules`);
  await page.locator('#pf_grace_cancel_minutes').fill('2.5');
  await expect(page.locator('[data-role="errors"]')).toContainText('số nguyên');
  await expect(page.locator('[data-act="save"]')).toBeDisabled();
  await page.locator('[data-act="reset"]').click();
  await expect(page.locator('#modal [data-role="ok"]')).toHaveClass(/b-e/);
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã khôi phục mặc định');
  expect(policyWrites(calls).map((c) => `${c.method} ${c.path}`)).toEqual(['POST /admin/order-policy/reset']);
  await expect(page.locator('#pf_grace_cancel_minutes')).toHaveValue('3');
  expect(errors).toEqual([]);
});

test('rules: server trả 422 VALIDATION_ERROR → hiện thông điệp, giữ dữ liệu đã nhập', async ({ page }) => {
  const { errors } = await setup(page, { policySave: 'invalid', ignoreStatuses: [422] });
  await page.goto(`${PAGE}#/rules`);
  await page.locator('#pf_red_pay').fill('7');
  await page.locator('[data-act="save"]').click();
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('[data-role="errors"]')).toContainText('máy chủ từ chối giá trị này');
  await expect(page.locator('#pf_red_pay')).toHaveValue('7');
  expect(errors).toEqual([]);
});

test('rules: ghi chú time_scale, cập nhật lần cuối, điểm uy tín; tab lạ về mặc định', async ({ page }) => {
  const stored = { ...structuredClone(policy), time_scale: 60, stored: true, updated_at: '2026-11-23T08:15:00.000Z', updated_by: '3f2a9c1e-7b44-4d0a-9e5f-1a2b3c4d5e6f' };
  const { errors } = await setup(page, { policy: stored });
  await page.goto(`${PAGE}#/rules`);
  await expect(page.locator('[data-role="time-scale"]')).toContainText('×60');
  await expect(page.locator('[data-screen="rules"]')).toContainText('Cập nhật lần cuối 2026-11-23');
  expect(await page.locator('[data-screen="rules"]').innerText()).not.toContain('3f2a9c1e');
  expect(await page.locator('[data-screen="rules"]').innerText()).not.toContain('bởi');
  await expect(page.locator('[data-role="reputation"]')).toContainText('Người mua vắng mặt');
  await expect(page.locator('[data-role="policy-table"] tbody tr')).toHaveCount(3);
  await expect(page.locator('[data-role="policy-table"]')).toContainText('Xanh');
  await page.goto(`${PAGE}#/rules?tab=bogus`);
  await expect(page.locator('#pf_green_pay')).toBeVisible();
  expect(errors).toEqual([]);
});

test('rules: tab Tự động — tên tiếng Việt, không mã thô; Chạy ngay → POST đúng path', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/rules?tab=automation`);
  const rows = page.locator('[data-role="automation-table"] tbody tr');
  await expect(rows).toHaveCount(4);
  const text = await page.locator('[data-screen="rules"]').innerText();
  for (const code of ['label-automation', 'order-automation', 'complaint-escalation', 'push-reminders']) expect(text).not.toContain(code);
  expect(text).toContain('Đổi nhãn / giá / chia hàng đỏ');
  await expect(rows.nth(2)).toContainText('Lỗi');
  await expect(rows.nth(2)).toContainText('Hết thời gian chờ cơ sở dữ liệu');
  await expect(rows.nth(2)).toContainText('2016 lần / 1 lỗi');
  await rows.nth(0).locator('[data-act="run"]').click();
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã chạy xong');
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts.map((c) => c.path)).toEqual(['/admin/automation/label-automation/run']);
  expect(errors).toEqual([]);
});

test('rules: poll 60 giây chỉ chạy ở tab Tự động, không chạy ở tab Quy tắc', async ({ page }) => {
  await page.clock.install();
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/rules`);
  await expect(page.locator('#pf_green_pay')).toBeVisible();
  await page.clock.fastForward(125000);
  await page.waitForTimeout(100);
  expect(autoGets(calls)).toBe(0);
  await page.locator('[data-act="tab"][data-tab="automation"]').click();
  expect(await page.evaluate(() => location.hash)).toBe('#/rules?tab=automation');
  await expect(page.locator('[data-role="automation-table"]')).toBeVisible();
  const before = autoGets(calls);
  await page.clock.fastForward(61000);
  await expect.poll(() => autoGets(calls)).toBeGreaterThan(before);
  await page.locator('[data-act="tab"][data-tab="policy"]').click();
  await expect(page.locator('#pf_green_pay')).toBeVisible();
  const mid = autoGets(calls);
  await page.clock.fastForward(125000);
  await page.waitForTimeout(100);
  expect(autoGets(calls)).toBe(mid);
  expect(errors).toEqual([]);
});

const voucherWrites = (calls) => calls.filter((c) => c.path.startsWith('/admin/vouchers') && c.method !== 'GET');
const voucherGets = (calls) => calls.filter((c) => c.method === 'GET' && c.path === '/admin/vouchers').length;
const fillVoucher = async (page, { code, name }) => {
  await page.locator('[data-act="new"]').click();
  await page.locator('#vc_code').fill(code);
  await page.locator('#vc_name').fill(name);
  await page.locator('#vc_from').fill('2026-12-01T08:00');
  await page.locator('#vc_to').fill('2026-12-31T23:30');
};

test('vouchers: bảng hiện mức giảm, trạng thái tiếng Việt, phạm vi; không lộ mã thô', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/vouchers`);
  await expect(page.locator('[data-screen="vouchers"] tbody tr')).toHaveCount(vouchers.length);
  const row = (code) => page.locator('[data-screen="vouchers"] tbody tr', { hasText: code });
  await expect(row('GIOVANG10')).toContainText('10%');
  await expect(row('GIOVANG10')).toContainText('đơn từ 50.000đ');
  await expect(row('GIOVANG10')).toContainText('37 / 200');
  await expect(row('GIOVANG10')).toContainText('Đang bật');
  await expect(row('GIOVANG10')).toContainText('Toàn sàn');
  await expect(row('MIO20K')).toContainText('20.000đ');
  await expect(row('MIO20K')).toContainText('không giới hạn');
  await expect(row('KHAITRUONG')).toContainText('Hết hạn');
  await expect(row('TAMDUNG')).toContainText('Đã tắt');
  await expect(row('NANG5')).toContainText('Tiệm Bánh Nắng');
  await expect(row('HETLUOT')).toContainText('Hết lượt');
  await expect(row('HETLUOT')).not.toContainText('Đang bật');
  await expect(row('SAPDIENRA')).toContainText('Chưa bắt đầu');
  const text = await page.locator('#screen').innerText();
  for (const raw of ['expired', 'scheduled', 'used_up', 'percent_off', 'fixed_discount_cents', 'is_active']) expect(text).not.toContain(raw);
  expect(errors).toEqual([]);
});

test('vouchers: mã "ab" → báo lỗi, Tạo disabled, không POST; hợp lệ 10% → POST chỉ trường có giá trị, ISO +07:00', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/vouchers`);
  await expect(page.locator('[data-screen="vouchers"] tbody tr')).toHaveCount(vouchers.length);
  await fillVoucher(page, { code: 'ab', name: 'Giảm mười' });
  await page.locator('#vc_val').fill('10');
  const create = page.locator('#drawer [data-act="create"]');
  await expect(page.locator('#drawer [data-role="errors"]')).toContainText('Mã chỉ gồm chữ, số, - và _ (3-30 ký tự)');
  await expect(create).toBeDisabled();
  expect(voucherWrites(calls)).toEqual([]);
  await page.locator('#vc_code').fill('MIO10');
  await expect(page.locator('#drawer [data-role="errors"]')).toBeHidden();
  await expect(create).toBeEnabled();
  const before = voucherGets(calls);
  await create.click();
  await expect(page.locator('#toasts')).toContainText('Đã tạo voucher');
  const writes = voucherWrites(calls);
  expect(writes.length).toBe(1);
  expect(writes[0].method).toBe('POST');
  expect(writes[0].body).toEqual({
    code: 'MIO10', name: 'Giảm mười', percent_off: 10,
    starts_at: '2026-12-01T08:00:00+07:00', expires_at: '2026-12-31T23:30:00+07:00',
  });
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  await expect.poll(() => voucherGets(calls)).toBe(before + 1);
  expect(errors).toEqual([]);
});

test('vouchers: loại giảm là radio (không chọn cả hai); số tiền < 1.000 bị chặn; mô tả/đơn tối thiểu/lượt chỉ gửi khi có', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/vouchers`);
  await expect(page.locator('[data-screen="vouchers"] tbody tr')).toHaveCount(vouchers.length);
  await fillVoucher(page, { code: 'GIAM20K', name: 'Giảm 20k' });
  await expect(page.locator('#drawer input[name="vc_type"]')).toHaveCount(2);
  await page.locator('#vc_type_fixed').check();
  await expect(page.locator('#vc_type_percent')).not.toBeChecked();
  await page.locator('#vc_val').fill('500');
  await expect(page.locator('#drawer [data-role="errors"]')).toContainText('Số tiền giảm phải là số nguyên từ 1.000đ');
  await expect(page.locator('#drawer [data-act="create"]')).toBeDisabled();
  await page.locator('#vc_val').fill('20000');
  await page.locator('#vc_desc').fill('Giảm cho đơn đầu');
  await page.locator('#vc_min').fill('80000');
  await page.locator('#vc_max').fill('50');
  await page.locator('#drawer [data-act="create"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã tạo voucher');
  expect(voucherWrites(calls)[0].body).toEqual({
    code: 'GIAM20K', name: 'Giảm 20k', description: 'Giảm cho đơn đầu', fixed_discount_cents: 20000, min_order_cents: 80000, max_redemptions: 50,
    starts_at: '2026-12-01T08:00:00+07:00', expires_at: '2026-12-31T23:30:00+07:00',
  });
  expect(errors).toEqual([]);
});

test('vouchers: bắt đầu >= kết thúc → chặn, không POST', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/vouchers`);
  await fillVoucher(page, { code: 'MIO10', name: 'Giảm mười' });
  await page.locator('#vc_val').fill('10');
  await page.locator('#vc_to').fill('2026-12-01T08:00');
  await expect(page.locator('#drawer [data-role="errors"]')).toContainText('Ngày hết hạn phải sau ngày bắt đầu');
  await expect(page.locator('#drawer [data-act="create"]')).toBeDisabled();
  expect(voucherWrites(calls)).toEqual([]);
  expect(errors).toEqual([]);
});

test('vouchers: server trả 409 → thông điệp dưới form, drawer và dữ liệu giữ nguyên', async ({ page }) => {
  const { errors } = await setup(page, { voucherCreate: 'conflict', ignoreStatuses: [409] });
  await page.goto(`${PAGE}#/vouchers`);
  await fillVoucher(page, { code: 'MIO10', name: 'Giảm mười' });
  await page.locator('#vc_val').fill('10');
  await page.locator('#drawer [data-act="create"]').click();
  await expect(page.locator('#drawer [data-role="errors"]')).toContainText('Mã voucher đã tồn tại');
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#vc_code')).toHaveValue('MIO10');
  await expect(page.locator('#drawer [data-act="create"]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('vouchers: Tắt → confirm → PATCH {is_active:false} rồi tải lại; voucher đã tắt có nút Bật → {is_active:true}', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/vouchers`);
  await expect(page.locator('[data-screen="vouchers"] tbody tr')).toHaveCount(vouchers.length);
  const before = voucherGets(calls);
  await page.locator('[data-screen="vouchers"] tbody tr', { hasText: 'GIOVANG10' }).locator('[data-act="toggle"]').click();
  await expect(page.locator('#modal')).toContainText('Tắt voucher GIOVANG10');
  expect(voucherWrites(calls)).toEqual([]);
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã tắt voucher');
  expect(voucherWrites(calls).map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body)}`)).toEqual(['PATCH /admin/vouchers/v-1 {"is_active":false}']);
  await expect.poll(() => voucherGets(calls)).toBe(before + 1);
  await page.locator('[data-screen="vouchers"] tbody tr', { hasText: 'TAMDUNG' }).locator('[data-act="toggle"]').click();
  await page.locator('#modal [data-role="ok"]').click();
  await expect.poll(() => voucherWrites(calls).length).toBe(2);
  expect(voucherWrites(calls)[1].body).toEqual({ is_active: true });
  expect(errors).toEqual([]);
});

const esgGets = (calls) => calls.filter((c) => c.method === 'GET' && c.path.startsWith('/admin/esg')).map((c) => c.path);

test('esg: 4 ô số + top cửa hàng; đổi tháng → GET ?month=2026-10 và hash cập nhật; tháng sai → tháng hiện tại', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/esg?month=2026-10`);
  await expect(page.locator('#esg_month')).toHaveValue('2026-10');
  await expect.poll(() => esgGets(calls)).toEqual(['/admin/esg?month=2026-10']);
  await expect(page.locator('[data-block="esg-food"]')).toContainText('412,5');
  await expect(page.locator('[data-block="esg-food"]')).toContainText('kg');
  await expect(page.locator('[data-block="esg-co2"]')).toContainText('1.031,3');
  await expect(page.locator('[data-block="esg-meals"]')).toContainText('1.650');
  await expect(page.locator('[data-block="esg-orders"]')).toContainText('188');
  await expect(page.locator('[data-screen="esg"] table')).toContainText('Tiệm Bánh Nắng');
  await page.locator('#esg_month').fill('2026-09');
  await expect.poll(() => esgGets(calls).length).toBe(2);
  expect(esgGets(calls)[1]).toBe('/admin/esg?month=2026-09');
  expect(await page.evaluate(() => location.hash)).toBe('#/esg?month=2026-09');
  await page.goto(`${PAGE}#/esg?month=abc`);
  await page.reload();
  await expect(page.locator('#esg_month')).toHaveValue(/^\d{4}-\d{2}$/);
  expect(esgGets(calls).at(-1)).toMatch(/^\/admin\/esg\?month=\d{4}-\d{2}$/);
  expect(esgGets(calls).at(-1)).not.toContain('abc');
  expect(errors).toEqual([]);
});

// Task 17: trang cũ /quan-tri chuyển hướng các mục đã di trú sang cổng mới.
test('trang cũ: mục đã di trú chuyển sang /admin/, mục chưa di trú ở lại, dải thông báo nhớ trạng thái đóng', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/@supabase/supabase-js**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_SUPABASE }));
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
    if (path === '/admin/users') return route.fulfill(ok({ buyers: [] }));
    if (path.startsWith('/admin/')) return route.fulfill(fail(500, 'INTERNAL', 'Không thuộc test'));
    return route.fulfill(ok({ items: [] }));
  });
  const open = async () => { await page.goto('/quan-tri'); await expect(page.locator('.S-i[data-p="hub"]')).toBeVisible(); };
  await open();
  const oldUrl = page.url();
  const banner = page.locator('#newPortalBanner');
  await expect(banner).toBeVisible();
  await expect(banner.locator('a')).toHaveAttribute('href', '/admin/');
  await page.click('.S-i[data-p="tracking"]');
  await expect(page.locator('#pt')).toHaveText('Bản đồ theo dõi');
  expect(page.url()).toBe(oldUrl);
  for (const p of ['disputes', 'finance']) {
    await page.click(`.S-i[data-p="${p}"]`);
    expect(page.url()).toBe(oldUrl);
  }
  await page.click('#newPortalBannerClose');
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.locator('.S-i[data-p="hub"]')).toBeVisible();
  await expect(banner).toBeHidden();
  await page.click('.S-i[data-p="hub"]');
  await expect(page).toHaveURL(/\/admin\/index\.html#\/complaints$/);
  await open();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.click('.S-i[data-p="risks"]');
  await expect(page).toHaveURL(/\/admin\/index\.html#\/alerts$/);
  expect(errors).toEqual([]);
});

// ---- Vòng sửa cuối (review toàn nhánh): hộp xác nhận, form đăng nhập, CSS, Nhật ký, Rút tiền, Duyệt hồ sơ, chỉ dẫn trang cũ ----
const wdListPaths = (calls) => calls.filter((c) => c.method === 'GET' && c.path.split('?')[0] === '/admin/withdrawals').map((c) => c.path);

test('I1: hộp xác nhận đóng khi đổi màn, không gửi gì; hộp mở chồng → hộp cũ trả {ok:false}', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts`);
  const panel = await openWd(page, 'Tiệm bánh Hoa Sữa');
  await panel.locator('[data-act="approve"]').click();
  await expect(page.locator('#modal.open')).toHaveCount(1);
  await page.evaluate(() => { location.hash = '#/audit'; });
  await expect(page.locator('#pt')).toHaveText('Nhật ký');
  await expect(page.locator('#modal.open')).toHaveCount(0);
  await expect(page.locator('#modal [data-role="ok"]')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(wdCalls(calls)).toEqual([]);
  // Hộp B mở khi hộp A còn chờ: A trả { ok:false }, chỉ còn B trên màn
  const result = await page.evaluate(async () => {
    const ui = await import('/admin/core/ui.js');
    const a = ui.confirm({ title: 'Hộp A', body: 'A' });
    const b = ui.confirm({ title: 'Hộp B', body: 'B' });
    const ra = await a;
    const title = document.querySelector('#modal h3')?.textContent;
    const dialogs = document.querySelectorAll('#modal [role="dialog"]').length;
    document.querySelector('#modal [data-role="ok"]').click();
    const rb = await b;
    return { ra, rb, title, dialogs, open: document.querySelectorAll('#modal.open').length };
  });
  expect(result).toEqual({ ra: { ok: false }, rb: { ok: true }, title: 'Hộp B', dialogs: 1, open: 0 });
  expect(errors).toEqual([]);
});

test('I1: hộp xác nhận đóng khi khóa cổng (401), đăng nhập lại không hiện lại, không gửi lệnh', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { ignoreStatuses: [401] });
  await page.goto(`${PAGE}#/payouts`);
  const panel = await openWd(page, 'Tiệm bánh Hoa Sữa');
  await panel.locator('[data-act="approve"]').click();
  await expect(page.locator('#modal.open')).toHaveCount(1);
  state.audit = 'unauthorized';
  await page.evaluate(() => document.getElementById('bell').click()); // bấm xuyên lớp phủ của hộp để gây 401
  await expect(page.locator('body')).toHaveClass(/admin-locked/);
  await expect(page.locator('#modal.open')).toHaveCount(0);
  state.audit = 'ok';
  await page.fill('input[name="email"]', 'admin@mio.vn');
  await page.fill('input[name="password"]', 'mat-khau-thu');
  await page.click('#login button[type="submit"]');
  await expect(page.locator('body')).not.toHaveClass(/admin-locked/);
  await expect(page.locator('[data-role="withdrawals-table"]')).toBeVisible();
  await expect(page.locator('#modal.open')).toHaveCount(0);
  await expect(page.locator('#modal [role="dialog"]')).toHaveCount(0);
  expect(wdCalls(calls)).toEqual([]);
  expect(errors).toEqual([]);
});

test('I2: một module không nạp được → nút Đăng nhập vẫn tắt, Enter/bấm không gửi form, URL không đổi', async ({ page }) => {
  await setup(page, { fakeSb: { noSession: true } });
  await page.route('**/admin/core/shell.js', (route) => route.abort());
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.goto(PAGE);
  const url = page.url();
  await expect(page.locator('#login')).toBeVisible();
  const submit = page.locator('#login button[type="submit"]');
  await expect(submit).toBeDisabled();
  await page.fill('input[name="email"]', 'admin@mio.vn');
  await page.fill('input[name="password"]', 'mat-khau-thu');
  await page.press('input[name="password"]', 'Enter');
  await submit.click({ force: true });
  await page.waitForTimeout(500);
  expect(posts).toEqual([]);
  expect(page.url()).toBe(url);
  await expect(page.locator('input[name="password"]')).toHaveValue('mat-khau-thu');
});

test('I2: khởi động bình thường → nút Đăng nhập được bật sau khi gắn handler', async ({ page }) => {
  const { errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(PAGE);
  await expect(page.locator('#login button[type="submit"]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('I3: viewport 980×800 → 19 mục thanh bên đều có chữ, trang không cuộn ngang', async ({ page }) => {
  await page.setViewportSize({ width: 980, height: 800 });
  const { errors } = await setup(page);
  for (const screen of ['today', 'payouts', 'complaints', 'audit']) {
    await page.goto(`${PAGE}#/${screen}`);
    await expect(page.locator('.S-i')).toHaveCount(19);
    await expect(page.locator(`.S-i[data-p="${screen}"]`)).toHaveAttribute('aria-current', 'page');
    const items = await page.locator('.S-i').evaluateAll((els) => els.map((el) => {
      const span = el.querySelector('span');
      const r = span.getBoundingClientRect();
      return { text: span.innerText.trim(), all: el.innerText.trim(), w: r.width, h: r.height };
    }));
    expect(items.length).toBe(19);
    for (const it of items) {
      expect(it.text.length).toBeGreaterThan(0);
      expect(it.all).not.toMatch(/^\d*$/);
      expect(it.w).toBeGreaterThan(0);
      expect(it.h).toBeGreaterThan(0);
    }
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('I4: nút disabled mờ + con trỏ cấm; toast lỗi có nền riêng (--err)', async ({ page }) => {
  const { errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts?tab=processing`);
  const panel = await openWd(page, 'Bếp Nhà Lan');
  const pay = panel.locator('[data-act="pay"]');
  await expect(pay).toBeDisabled();
  await expect.poll(() => pay.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeLessThan(1);
  expect(await pay.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed');
  const bgs = await page.evaluate(async () => {
    const ui = await import('/admin/core/ui.js');
    ui.toast('Thường');
    ui.toast('Lỗi', 'err');
    const bg = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
    return { ok: bg('#toasts .v2toast-ok'), err: bg('#toasts .v2toast-err') };
  });
  expect(bgs.err).not.toBe(bgs.ok);
  expect(bgs.err).toBe('rgb(217, 78, 69)');
  expect(errors).toEqual([]);
});

test('I5: Nhật ký hiện nhãn tiếng Việt cho rút tiền/khiếu nại/tài khoản nhận tiền/cài đặt; lọc nhóm Rút tiền và người làm', async ({ page }) => {
  const { calls, errors } = await setup(page, { audit: 'money' });
  const auditPaths = () => calls.filter((c) => c.path.startsWith('/admin/audit-log')).map((c) => c.path);
  await page.goto(`${PAGE}#/audit`);
  await expect(page.locator('#screen table tbody tr')).toHaveCount(MONEY_AUDIT.length);
  await page.locator('#screen details').evaluateAll((els) => els.forEach((d) => { d.open = true; }));
  const text = await page.locator('#screen').innerText();
  for (const bad of ['withdrawal ·', 'payout_account', 'refund_cents', 'bank_txn_ref', 'is_false_claim', 'app_setting', 'complaint ·', 'withdrawal.', 'complaint.']) expect(text).not.toContain(bad);
  for (const good of ['Lệnh rút · 9f8e7d6c', 'Khiếu nại · c0a1b2c3', 'Tài khoản nhận tiền · aa11bb22', 'Cài đặt · marketing',
    'Mã giao dịch', 'FT2026112300999', 'Số tiền hoàn', '15.000đ', 'Khiếu nại sai', 'Không', 'Ghi chú', 'Hoàn một phần', 'Khóa', 'Trước', 'Sau', 'Khác', 'la_ma']) expect(text).toContain(good);
  expect(text).not.toContain('9f8e7d6c-1111');
  // Nhóm mới có trong ô chọn
  const groups = await page.locator('#screen select[name="action_group"] option').allInnerTexts();
  for (const g of ['Rút tiền', 'Tài khoản nhận tiền', 'Khiếu nại', 'Cài đặt']) expect(groups).toContain(g);
  await page.selectOption('#screen select[name="action_group"]', { label: 'Rút tiền' });
  await page.click('#screen [data-act="filter"]');
  await expect.poll(() => auditPaths().length).toBe(2);
  expect(new URL('http://x' + auditPaths()[1]).searchParams.get('action')).toBe('withdrawal.');
  // Lọc theo người làm: ô chọn lấy từ các actor trong dữ liệu đã tải
  const actors = await page.locator('#screen select[name="actor_id"] option').allInnerTexts();
  expect(actors).toEqual(['Tất cả', 'Admin Thử', 'Admin Hai']);
  await page.selectOption('#screen select[name="action_group"]', '');
  await page.selectOption('#screen select[name="actor_id"]', { label: 'Admin Hai' });
  await page.click('#screen [data-act="filter"]');
  await expect.poll(() => auditPaths().length).toBe(3);
  const last = new URL('http://x' + auditPaths()[2]).searchParams;
  expect(last.get('actor_id')).toBe(ACTOR_B);
  expect(last.get('action')).toBeNull();
  await expect(page.locator('#screen select[name="actor_id"]')).toHaveValue(ACTOR_B);
  expect(errors).toEqual([]);
});

test('I6: cả 6 tab rút tiền gọi lọc phía server (?status=...), không còn ghi chú lọc phía client 100 lệnh', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/payouts`);
  await expect(page.locator('[data-role="withdrawals-table"]')).toContainText('Tiệm bánh Hoa Sữa');
  expect(wdListPaths(calls)).toEqual(['/admin/withdrawals?status=requested']);
  await expect(page.locator('[data-act="tab"][data-tab="requested"]')).toHaveText('Chờ duyệt (1)');
  await expect(page.locator('[data-act="tab"][data-tab="approved"]')).toHaveText('Đã duyệt, chờ chi'); // không có nguồn số chính xác → không hiện số
  await expect(page.locator('[data-act="tab"][data-tab="paid"]')).toHaveText('Đã chi');
  await expect(page.locator('#screen')).not.toContainText('Chỉ tính trong 100 lệnh rút mới nhất');
  await page.click('[data-act="tab"][data-tab="processing"]');
  await expect(page.locator('[data-role="withdrawals-table"]')).toContainText('Bếp Nhà Lan');
  expect(wdListPaths(calls).at(-1)).toBe('/admin/withdrawals?status=processing');
  await expect(page.locator('#screen')).toContainText('Hiện tối đa 100 lệnh mới nhất ở trạng thái này.');
  await expect(page.locator('[data-act="tab"][data-tab="requested"]')).toHaveText('Chờ duyệt');
  await page.click('[data-act="tab"][data-tab="rejected"]');
  await expect.poll(() => wdListPaths(calls).at(-1)).toBe('/admin/withdrawals?status=rejected');
  await expect(page.locator('[data-role="withdrawals-table"]')).toContainText('Siêu thị Xanh');
  await expect(page.locator('[data-role="withdrawals-table"] tbody tr')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('T12: câu xác nhận tài khoản nhận tiền theo loại cảnh báo (tên không khớp / chưa có tên đăng ký)', async ({ page }) => {
  const accounts = [payoutAccounts[0], { ...payoutAccounts[1], id: 'pa-3', store_name: 'Bếp Nhà Lan', account_holder_name: 'PHAM VAN D', account_last4: '5555', warning: 'no_registered_name', registered_name: null }];
  const { calls, errors } = await setup(page, { accounts });
  await page.goto(`${PAGE}#/verify?tab=accounts`);
  const row = (name) => page.locator('[data-role="accounts-table"] tr', { hasText: name });
  await row('TRAN VAN B').locator('[data-act="verify"]').click();
  await expect(page.locator('#modal')).toContainText('không khớp');
  await expect(page.locator('#modal [data-role="reason"]')).toBeVisible();
  await page.click('#modal [data-role="cancel"]');
  await row('PHAM VAN D').locator('[data-act="verify"]').click();
  await expect(page.locator('#modal')).toContainText('chưa có tên đăng ký');
  await expect(page.locator('#modal')).not.toContainText('không khớp');
  await expect(page.locator('#modal [data-role="reason"]')).toBeVisible();
  await page.click('#modal [data-role="cancel"]');
  expect(verifyCalls(calls)).toEqual([]);
  expect(errors).toEqual([]);
});

test('M7: khiếu nại cũ dẫn tới "Mở trang cũ → mục Tranh chấp"', async ({ page }) => {
  // Đợt 2 tạm: cả 19 màn đều có nội dung, màn chờ _pending chỉ còn được kiểm ở test đơn vị.
  const legacy = complaints.map((c) => (c.status === 'in_review' ? { ...c, reason_code: null } : c));
  const { errors } = await setup(page, { complaints: legacy });
  await page.goto(`${PAGE}#/complaints`);
  await page.click('[data-col="in_review"] [data-act="open"]');
  await expect(page.locator('#drawer a[href="/quan-tri"]')).toHaveText('Mở trang cũ → mục Tranh chấp');
  expect(errors).toEqual([]);
});

test('Đợt 2 tạm: 10 màn từng trống không còn màn chờ "Chưa nối API"', async ({ page }) => {
  const { errors } = await setup(page, { ignoreStatuses: [404, 500] });
  for (const id of ['customers', 'stores', 'charities', 'orders', 'donations', 'tracking', 'inventory', 'ledger', 'marketing', 'settings']) {
    await page.goto(`${PAGE}#/${id}`);
    await expect(page.locator('#pt')).not.toHaveText('');
    await expect(page.locator('#screen')).not.toContainText('Chưa nối API');
    await expect(page.locator('#screen')).not.toContainText('Màn này chưa có trên cổng mới');
  }
  expect(errors.filter((e) => !/status of (404|500)/.test(e))).toEqual([]);
});

test('Wave 4A Đợt 2: tìm kiếm toàn cục, hồ sơ 360° người mua / cửa hàng / tổ chức & hành động trạng thái', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/today`);

  // 1. Tìm kiếm toàn cục: gõ >= 2 ký tự -> gọi GET /admin/search -> bấm kết quả cửa hàng mở thẳng drawer 360°
  const searchInput = page.locator('#globalSearch');
  await searchInput.fill('Tiệm bánh');
  const storeOpt = page.locator('#globalSearchList [data-search-group="stores"]').first();
  await expect(storeOpt).toBeVisible();
  await storeOpt.click();
  await expect(page).toHaveURL(/#\/stores\?id=/);
  await expect(page.locator('#drawer [data-role="store"]')).toBeVisible();
  await expect(page.locator('#drawer')).toContainText('Ví cửa hàng');
  await expect(page.locator('#drawer')).toContainText('Tạm ngưng bán');
  await page.click('#drawer [data-role="drawer-close"]');

  // 2. Người mua: danh sách /admin/accounts, mở 360° drawer, bấm Tạm khóa tài khoản yêu cầu lý do >= 3 ký tự
  await page.goto(`${PAGE}#/customers`);
  await expect(page.locator('[data-screen="customers"] tbody tr').first()).toBeVisible();
  await page.locator('[data-screen="customers"] [data-act="open"]').first().click();
  await expect(page.locator('#drawer [data-role="profile"]')).toBeVisible();
  await page.locator('#drawer [data-act="account-status"][data-status="suspended"]').click();
  await expect(page.locator('#modal [data-role="ok"]')).toBeDisabled();
  await page.locator('#modal [data-role="reason"]').fill('Vi phạm quy định đặt đơn');
  await expect(page.locator('#modal [data-role="ok"]')).toBeEnabled();
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã tạm khóa tài khoản');
  expect(calls.some((c) => c.method === 'POST' && /^\/admin\/accounts\/[^/]+\/status$/.test(c.path))).toBe(true);
  await page.click('#drawer [data-role="drawer-close"]');

  // 3. Tổ chức & TNV: tab Tình nguyện viên gọi /admin/volunteers và có link sang Bản đồ theo dõi
  await page.goto(`${PAGE}#/charities?tab=volunteers`);
  await expect(page.locator('[data-screen="charities"] [data-role="volunteers-table"]')).toBeVisible();
  await expect(page.locator('[data-screen="charities"] a[href="#/tracking"]')).toBeVisible();
  expect(calls.some((c) => c.path.startsWith('/admin/volunteers'))).toBe(true);
  expect(errors).toEqual([]);
});
