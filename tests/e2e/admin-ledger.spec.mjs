import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import work from '../../public/admin/demo/fixtures/work.js';

// Màn "Tiền & sổ cái" (Đợt 3): tab Sổ cái bút toán (finance/summary, reconcile, ledger) và tab Sự kiện thanh toán (payments/summary, payments).
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };

const SUMMARY = {
  wallets: { external: -9150000, escrow: 480000, platform_revenue: 1250000, charity_pool: 310000 },
  store_wallets_total: 3620000, refunded_total: 215000, forfeited_total: 64000, released_total: 4180000,
  pending_withdrawals_count: 1, pending_withdrawals_total: 650000, withdrawn_total: 2900000, accounts_pending: 1,
  reconcile: { total_balance: 0, mismatched_wallets: 0, entry_count: 1842, ok: true },
};
const ENTRIES = {
  total: 60,
  items: [
    { id: 'e1', type: 'charge', order_number: 'FS-0042', from: 'Bên ngoài (khách / ngân hàng)', to: 'Giữ chờ (escrow)', amount: 62000, reason: null, created_at: '2026-11-23T08:15:00.000Z' },
    { id: 'e2', type: 'release', order_number: 'FS-0039', from: 'Giữ chờ (escrow)', to: 'Ví Tiệm bánh Mẫu', amount: 54000, reason: 'completed', created_at: '2026-11-23T07:15:00.000Z' },
    { id: 'e3', type: 'release', order_number: 'FS-0039', from: 'Giữ chờ (escrow)', to: 'Doanh thu nền tảng', amount: 2000, reason: 'mystery_code', created_at: '2026-11-23T07:15:00.000Z' },
    { id: 'e4', type: 'withdraw', order_number: null, from: 'Ví Quán cơm Mẫu', to: 'Bên ngoài (khách / ngân hàng)', amount: 500000, reason: null, created_at: '2026-11-22T05:00:00.000Z' },
  ],
};
const PAY_SUMMARY = {
  total: 30,
  processed_amount_cents: 1980000,
  by_status: { processed: 25, received: 3, rejected: 2, ignored: 0 },
  by_provider: {
    momo: { count: 20, amount_cents: 1400000 },
    vnpay: { count: 10, amount_cents: 580000 },
  },
};
const seedPaymentEvents = () => [
  { id: 'pe-1', provider: 'momo', provider_txn_id: 'MM-9001', order_number: 'FS-0042', amount_cents: 62000, status: 'processed', created_at: '2026-11-23T08:15:00.000Z' },
  { id: 'pe-2', provider: 'vnpay', provider_txn_id: 'VN-9002', order_number: 'FS-0043', amount_cents: 85000, status: 'received', created_at: '2026-11-23T07:45:00.000Z' },
  { id: 'pe-3', provider: 'momo', provider_txn_id: 'MM-9003', order_number: 'FS-0044', amount_cents: 40000, status: 'rejected', created_at: '2026-11-23T06:00:00.000Z' },
];

function makeApi(state) {
  return async (route, { path, method }) => {
    const [bare, qs = ''] = path.split('?');
    const sp = new URLSearchParams(qs);
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok(work));
    if (bare === '/admin/finance/summary') {
      if (state.summary === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      if (state.summary === 'mismatch') return route.fulfill(ok({ ...SUMMARY, reconcile: { total_balance: 1500, mismatched_wallets: 2, entry_count: 9, ok: false } }));
      return route.fulfill(ok(SUMMARY));
    }
    if (bare === '/admin/ledger') {
      if (state.ledger === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      if (state.ledger === 'empty') return route.fulfill(ok({ items: [], total: 0 }));
      return route.fulfill(ok(ENTRIES));
    }
    if (bare === '/admin/finance/reconcile' && method === 'POST') {
      if (state.reconcile === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Đối soát thất bại'));
      if (state.reconcile === 'mismatch') return route.fulfill(ok({ synced_orders: 0, total_balance: 1500, mismatched_wallets: 2, entry_count: 9, ok: false }));
      return route.fulfill(ok({ synced_orders: 3, total_balance: 0, mismatched_wallets: 0, entry_count: 1845, ok: true }));
    }
    if (bare === '/admin/payments/summary') {
      if (state.paySummary === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi tổng quan thanh toán'));
      return route.fulfill(ok(PAY_SUMMARY));
    }
    if (bare === '/admin/payments') {
      if (state.payments === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi sự kiện thanh toán'));
      const prov = sp.get('provider');
      const st = sp.get('status');
      const items = state.paymentItems.filter((p) => (!prov || p.provider === prov) && (!st || p.status === st));
      return route.fulfill(ok({ items, total: prov || st ? items.length : 60, page: Number(sp.get('page') || 1), limit: 25 }));
    }
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không có'));
  };
}

async function setup(page, init = {}) {
  const state = {
    summary: 'ok',
    ledger: 'ok',
    reconcile: 'ok',
    paySummary: 'ok',
    payments: 'ok',
    paymentItems: seedPaymentEvents(),
    ...init.state,
  };
  const stub = await stubAdmin(page, { api: makeApi(state), ignoreStatuses: init.ignoreStatuses || [] });
  return { state, ...stub };
}

const ledgerCalls = (calls) => calls.filter((c) => c.path.split('?')[0] === '/admin/ledger');
const summaryCalls = (calls) => calls.filter((c) => c.path.split('?')[0] === '/admin/finance/summary');
const reconcileCalls = (calls) => calls.filter((c) => c.path === '/admin/finance/reconcile');
const paymentCalls = (calls) => calls.filter((c) => c.path.split('?')[0] === '/admin/payments');
const paySummaryCalls = (calls) => calls.filter((c) => c.path.split('?')[0] === '/admin/payments/summary');
const query = (path) => new URLSearchParams(path.split('?')[1] || '');
const RAW = /\b(escrow|platform_revenue|charity_pool|external|charge|release|refund_clawback|withdraw|adjustment|mystery_code|completed|late_cancel|no_show|processed|received|rejected|ignored|momo|vnpay|cents)\b/;

test('ledger: tải tổng quan và sổ cái thật, nhãn Việt, không mã thô', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/ledger`);
  const root = page.locator('#screen [data-screen="ledger"]');
  await expect(root.locator('[data-role="ledger-table"] tbody tr')).toHaveCount(4);
  await expect(root.locator('[data-kpi="escrow"]')).toContainText('Tiền đang giữ chờ');
  await expect(root.locator('[data-kpi="escrow"]')).toContainText('480.000đ');
  await expect(root.locator('[data-kpi="platform"]')).toContainText('1.250.000đ');
  await expect(root.locator('[data-kpi="charity"]')).toContainText('310.000đ');
  await expect(root.locator('[data-kpi="reconcile"]')).toContainText('KHỚP');
  await expect(root.locator('[data-kpi="reconcile"]')).toContainText('0 ví lệch');
  const rows = root.locator('[data-role="ledger-table"] tbody tr');
  await expect(rows.first()).toContainText('Khách trả (giữ chờ)');
  await expect(rows.first()).toContainText('FS-0042');
  await expect(rows.first()).toContainText('Bên ngoài');
  await expect(rows.first()).toContainText('Tiền giữ chờ');
  await expect(rows.first()).toContainText('62.000đ');
  await expect(rows.nth(1)).toContainText('Ví Tiệm bánh Mẫu');
  await expect(rows.nth(1)).toContainText('Hoàn tất');
  await expect(rows.nth(3)).toContainText('Rút tiền');
  expect(await root.innerText()).not.toMatch(RAW);
  expect(query(ledgerCalls(calls)[0].path).get('page')).toBe('1');
  expect(query(ledgerCalls(calls)[0].path).get('limit')).toBe('25');
  expect(errors).toEqual([]);
});

test('ledger: đối soát lệch hiện LỆCH kèm số ví lệch', async ({ page }) => {
  const { errors } = await setup(page, { state: { summary: 'mismatch' } });
  await page.goto(`${PAGE}#/ledger`);
  const kpi = page.locator('#screen [data-kpi="reconcile"]');
  await expect(kpi).toContainText('LỆCH');
  await expect(kpi).toContainText('2 ví lệch');
  expect(errors).toEqual([]);
});

test('ledger: bộ lọc gửi đúng query (ngày → ISO +07:00) và lưu vào hash', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/ledger`);
  await expect(page.locator('#screen [data-role="ledger-table"] tbody tr')).toHaveCount(4);
  await page.selectOption('#screen [name="type"]', 'refund');
  await page.fill('#screen [name="order"]', 'FS-0042');
  await page.fill('#screen [name="from"]', '2026-11-01');
  await page.fill('#screen [name="to"]', '2026-11-20');
  await page.click('#screen [data-act="filter"]');
  await expect.poll(() => ledgerCalls(calls).length).toBe(2);
  const q = query(ledgerCalls(calls)[1].path);
  expect(q.get('type')).toBe('refund');
  expect(q.get('order_number')).toBe('FS-0042');
  expect(q.get('from')).toBe('2026-11-01T00:00:00+07:00');
  expect(q.get('to')).toBe('2026-11-20T23:59:59.999+07:00');
  expect(q.get('page')).toBe('1');
  expect(page.url()).toContain('type=refund');
  await expect(page.locator('#screen [name="type"]')).toHaveValue('refund');
  await expect(page.locator('#screen [name="order"]')).toHaveValue('FS-0042');
  expect(errors).toEqual([]);
});

test('ledger: Từ ngày sau Đến ngày → báo lỗi và không gọi API (cả khi nhập tay lẫn từ hash)', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/ledger`);
  await expect(page.locator('#screen [data-role="ledger-table"] tbody tr')).toHaveCount(4);
  await page.fill('#screen [name="from"]', '2026-11-20');
  await page.fill('#screen [name="to"]', '2026-11-01');
  await page.click('#screen [data-act="filter"]');
  await expect(page.locator('#screen [data-role="range-error"]')).toHaveText('Từ ngày phải trước Đến ngày.');
  expect(ledgerCalls(calls)).toHaveLength(1);
  await page.goto(`${PAGE}#/ledger?from=2026-11-20&to=2026-11-01`);
  await page.reload();
  await expect(page.locator('#screen [data-role="ledger-body"]')).toContainText('Từ ngày phải trước Đến ngày');
  expect(ledgerCalls(calls)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('ledger: hash lạ bị bỏ; phân trang đổi page trong hash và lời gọi API', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/ledger?type=hack&from=abc&page=-3`);
  await expect(page.locator('#screen [data-role="ledger-table"] tbody tr')).toHaveCount(4);
  const q = query(ledgerCalls(calls)[0].path);
  expect(q.get('type')).toBeNull();
  expect(q.get('from')).toBeNull();
  expect(q.get('page')).toBe('1');

  const pager = page.locator('#screen [data-role="pager"]');
  await expect(pager).toContainText('Trang 1/3');
  await expect(pager).toContainText('60 bút toán');
  await pager.locator('[data-act="next"]').click();
  await expect(pager).toContainText('Trang 2/3');
  expect(query(ledgerCalls(calls).at(-1).path).get('page')).toBe('2');
  expect(page.url()).toContain('page=2');
  expect(errors).toEqual([]);
});

test('ledger: chạy đối soát cần xác nhận, gửi POST đúng, báo KHỚP/LỆCH/lỗi và tải lại tổng quan', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/ledger`);
  await expect(page.locator('#screen [data-kpi="reconcile"]')).toContainText('KHỚP');
  const before = summaryCalls(calls).length;
  await page.click('#screen [data-act="reconcile"]');
  await page.click('#modal [data-role="cancel"]');
  expect(reconcileCalls(calls)).toHaveLength(0);

  await page.click('#screen [data-act="reconcile"]');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('bù 3 đơn');
  await expect(page.locator('#toasts')).toContainText('KHỚP');
  expect(reconcileCalls(calls)).toHaveLength(1);
  await expect.poll(() => summaryCalls(calls).length).toBeGreaterThan(before);

  state.reconcile = 'mismatch';
  await page.click('#screen [data-act="reconcile"]');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('LỆCH');

  state.reconcile = 'error';
  await page.click('#screen [data-act="reconcile"]');
  await page.click('#modal [data-role="ok"]');
  await expect(page.locator('#toasts')).toContainText('Đối soát thất bại');
  await expect(page.locator('#screen [data-act="reconcile"]')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('ledger: sổ cái trống và lỗi 500 trên tổng quan / sổ cái đều có Thử lại', async ({ page }) => {
  const { state, errors } = await setup(page, { state: { summary: 'error', ledger: 'empty' }, ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/ledger`);
  await expect(page.locator('#screen [data-role="ledger-body"]')).toContainText('Không có bút toán phù hợp');
  const sumBox = page.locator('#screen [data-role="summary-body"]');
  await expect(sumBox.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  state.summary = 'ok';
  await sumBox.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('#screen [data-kpi="escrow"]')).toContainText('480.000đ');
  expect(errors).toEqual([]);
});

test('ledger: tab Sự kiện thanh toán (#/ledger?tab=payments) hiện KPI cổng/trạng thái, lọc provider/status, phân trang, không lộ mã thô', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/ledger`);
  await page.click('[data-act="tab"][data-tab="payments"]');
  await expect(page).toHaveURL(/#\/ledger\?tab=payments$/);

  const root = page.locator('#screen [data-screen="ledger"]');
  await expect(root.locator('[data-kpi="pay-total"]')).toContainText('30');
  await expect(root.locator('[data-kpi="pay-total"]')).toContainText('1.980.000đ');
  await expect(root.locator('[data-kpi="pay-processed"]')).toContainText('25');
  await expect(root.locator('[data-kpi="pay-received"]')).toContainText('3');
  await expect(root.locator('[data-kpi="pay-rejected"]')).toContainText('2');
  await expect(root.locator('[data-role="provider-chips"]')).toContainText('MoMo: 20 giao dịch · 1.400.000đ');
  await expect(root.locator('[data-role="provider-chips"]')).toContainText('VNPay: 10 giao dịch · 580.000đ');

  const rows = root.locator('[data-role="payments-table"] tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('MoMo');
  await expect(rows.nth(0)).toContainText('MM-9001');
  await expect(rows.nth(0)).toContainText('FS-0042');
  await expect(rows.nth(0)).toContainText('62.000đ');
  await expect(rows.nth(0)).toContainText('Đã xử lý');
  await expect(rows.nth(1)).toContainText('VNPay');
  await expect(rows.nth(1)).toContainText('Đã tiếp nhận');
  await expect(rows.nth(2)).toContainText('Bị từ chối');
  expect(await root.innerText()).not.toMatch(RAW);
  expect(paymentCalls(calls)[0].path).toBe('/admin/payments?page=1&limit=25');

  // Lọc theo cổng MoMo và trạng thái Đã xử lý
  await page.selectOption('#screen [data-role="payments-filter"] [name="provider"]', 'momo');
  await page.selectOption('#screen [data-role="payments-filter"] [name="status"]', 'processed');
  await page.click('#screen [data-act="pay-filter"]');
  await expect(rows).toHaveCount(1);
  expect(paymentCalls(calls).at(-1).path).toBe('/admin/payments?page=1&limit=25&provider=momo&status=processed');
  expect(page.url()).toContain('provider=momo');
  expect(page.url()).toContain('status=processed');

  // Xóa lọc và phân trang
  await page.click('#screen [data-act="pay-clear"]');
  await expect(rows).toHaveCount(3);
  await page.click('#screen [data-act="pay-next"]');
  await expect.poll(() => paymentCalls(calls).at(-1).path).toBe('/admin/payments?page=2&limit=25');
  expect(errors).toEqual([]);
});

test('ledger: tab Sự kiện thanh toán lỗi 500 → Thử lại và escape XSS', async ({ page }) => {
  const { state, calls, errors } = await setup(page, { state: { paySummary: 'error', payments: 'error' }, ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/ledger?tab=payments`);
  const sumBox = page.locator('#screen [data-role="payments-summary"]');
  const listBox = page.locator('#screen [data-role="payments-body"]');
  await expect(sumBox.getByRole('button', { name: 'Thử lại' })).toBeVisible();
  await expect(listBox.getByRole('button', { name: 'Thử lại' })).toBeVisible();

  state.paySummary = 'ok';
  state.payments = 'ok';
  state.paymentItems[0].provider_txn_id = '<img src=x onerror="window.__xss=1">';
  await sumBox.getByRole('button', { name: 'Thử lại' }).click();
  await listBox.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('#screen [data-kpi="pay-total"]')).toContainText('30');
  await expect(page.locator('#screen [data-role="payments-table"] tbody tr')).toHaveCount(3);
  expect(paySummaryCalls(calls).length).toBe(2);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('ledger: ?demo=1 mở được cả hai tab Sổ cái và Sự kiện thanh toán, không gọi API thật', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.addInitScript(() => { window.__FAKE_SB = { noSession: true }; });
  await page.goto(`${PAGE}?demo=1#/ledger`);
  const root = page.locator('#screen [data-screen="ledger"]');
  await expect(root.locator('[data-kpi="escrow"]')).toContainText('480.000đ');
  await expect(root.locator('[data-role="ledger-table"] tbody tr').first()).toContainText('Khách trả (giữ chờ)');
  expect(await root.innerText()).not.toMatch(RAW);

  await page.click('[data-act="tab"][data-tab="payments"]');
  await expect(root.locator('[data-kpi="pay-total"]')).toContainText('4');
  await expect(root.locator('[data-role="payments-table"] tbody tr')).toHaveCount(4);
  expect(await root.innerText()).not.toMatch(RAW);
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
