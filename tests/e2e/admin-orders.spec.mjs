import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import work from '../../public/admin/demo/fixtures/work.js';
import { routes as demoRoutes, resolve as demoResolve } from '../../public/admin/demo/fixtures/orders.js';

// Màn Đơn hàng của cổng quản trị mới (chỉ xem). Auth Supabase và API đều được stub.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };

const NOW = Date.now();
const iso = (minutes) => new Date(NOW + minutes * 60000).toISOString();
const ID1 = '11111111-aaaa-4000-8000-000000000001';
const ID2 = '22222222-bbbb-4000-8000-000000000002';
const ID3 = '33333333-cccc-4000-8000-000000000003';

const ORDERS = [
  {
    id: ID1, order_number: 'MIO-1001', status: 'confirmed', payment_status: 'paid', payment_method: 'momo',
    subtotal_cents: 150000, discount_cents: 30000, platform_fee_cents: 0, donation_cents: 5000, total_cents: 125000,
    policy_label: 'yellow', pickup_deadline: iso(50), created_at: iso(-120), paid_at: iso(-118),
    stores: { id: 's1', name: 'Tiệm bánh Hoa Sữa' }, customer: { full_name: 'Nguyễn Văn An', phone: '0901234567' },
    order_items: [
      { id: 'i1', product_name: 'Bánh mì que', quantity: 2, unit_price_cents: 30000 },
      { id: 'i2', product_name: 'Bánh su kem', quantity: 3, unit_price_cents: 30000 },
    ],
  },
  {
    id: ID2, order_number: 'MIO-1002', status: 'awaiting_payment', payment_status: 'pending', payment_method: 'vnpay',
    subtotal_cents: 60000, discount_cents: 0, platform_fee_cents: 0, donation_cents: 0, total_cents: 60000,
    policy_label: null, pickup_deadline: null, created_at: iso(-10),
    stores: { id: 's2', name: 'Siêu thị Xanh' }, customer: { full_name: 'Trần Thị Bình', phone: '0912345678' },
    order_items: [{ id: 'i3', product_name: 'Rau cải', quantity: 1, unit_price_cents: 60000 }],
  },
  {
    id: ID3, order_number: 'MIO-1003', status: 'cancelled', payment_status: 'refunded', payment_method: 'card',
    subtotal_cents: 40000, discount_cents: 0, platform_fee_cents: 0, donation_cents: 0, total_cents: 40000,
    policy_label: 'red', pickup_deadline: iso(-300), created_at: iso(-600), paid_at: iso(-598), cancelled_at: iso(-200),
    cancel_reason: 'late_cancel', cancelled_by: 'customer',
    stores: { id: 's1', name: 'Tiệm bánh Hoa Sữa' }, customer: { full_name: 'Lê Minh Châu', phone: '0933333333' },
    order_items: [{ id: 'i4', product_name: 'Cơm hộp', quantity: 1, unit_price_cents: 40000 }],
  },
];
const MESSAGES = [
  { id: 'm1', sender_role: 'customer', body: 'Cửa hàng ơi, bánh bị chua.', created_at: iso(-100) },
  { id: 'm2', sender_role: 'partner', body: 'Bánh còn hạn nhé bạn.', created_at: iso(-90) },
];

// state.list = 'ok' | 'error'; state.chat = 'ok' | 'forbidden'; state.hasNext = true/false
function makeApi(state) {
  return async (route, { path }) => {
    const [bare, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok(work));
    if (bare === '/orders') {
      if (state.list === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const status = params.get('status');
      const items = status ? ORDERS.filter((o) => o.status === status) : ORDERS;
      return route.fulfill(ok({ items, pagination: { page: Number(params.get('page') || 1), limit: 20, total: items.length, has_next_page: Boolean(state.hasNext) } }));
    }
    if (/^\/orders\/[^/]+\/messages$/.test(bare)) {
      if (state.chat === 'forbidden') return route.fulfill(fail(403, 'CHAT_FORBIDDEN', 'Bạn không có quyền xem chat này'));
      return route.fulfill(ok({ messages: MESSAGES, can_send: false }));
    }
    const one = /^\/orders\/([^/]+)$/.exec(bare);
    if (one) {
      if (state.slowDetail) await new Promise((r) => setTimeout(r, state.slowDetail));
      const order = ORDERS.find((o) => o.id === one[1]);
      const { customer: _c, ...detail } = order || {};
      return route.fulfill(order ? ok(detail) : fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy đơn'));
    }
    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', `Không có route ${bare}`));
  };
}

async function setup(page, { ignoreStatuses = [], fakeSb = {}, ...state } = {}) {
  const stub = await stubAdmin(page, { api: makeApi(state), fakeSb, ignoreStatuses });
  return { state, ...stub };
}
const listCalls = (calls) => calls.filter((c) => c.path.split('?')[0] === '/orders');
const RAW = /awaiting_payment|\bpending\b|\bconfirmed\b|no_show|\bcancelled\b|\bmomo\b|\bvnpay\b|late_cancel|payment_timeout/;

test('orders: bảng đơn thật, nhãn Việt, tiền, hạn lấy hàng; không lộ mã thô; chỉ gọi GET', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/orders`);
  const rows = page.locator('[data-role="orders-table"] tbody tr[data-id]');
  await expect(rows).toHaveCount(3);
  const first = rows.nth(0);
  await expect(first).toContainText('MIO-1001');
  await expect(first).toContainText('Nguyễn Văn An');
  await expect(first).toContainText('Tiệm bánh Hoa Sữa');
  await expect(first).toContainText('125.000đ');
  await expect(first).toContainText('Cửa hàng đã nhận');
  await expect(first).toContainText('Vàng −50%');
  await expect(first).toContainText(/còn \d+ phút/);
  await expect(rows.nth(1)).toContainText('Chờ thanh toán');
  await expect(rows.nth(2)).toContainText('Đã hủy');
  await expect(rows.nth(2)).toContainText('Đỏ −80%');
  expect(await page.locator('#screen').innerText()).not.toMatch(RAW);
  expect(listCalls(calls)[0].path).toBe('/orders?page=1&limit=20');
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
  expect(errors).toEqual([]);
});

test('orders: tab trạng thái lưu trong hash và lọc theo API; hash lạ bị bỏ; phân trang Sau/Trước', async ({ page }) => {
  const { calls, errors } = await setup(page, { hasNext: true });
  await page.goto(`${PAGE}#/orders?status=hack`);
  await expect(page.locator('[data-role="orders-table"] tbody tr[data-id]')).toHaveCount(3);
  expect(listCalls(calls)[0].path).toBe('/orders?page=1&limit=20');

  await page.click('[data-act="tab"][data-status="awaiting_payment"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/orders?status=awaiting_payment');
  await expect(page.locator('[data-role="orders-table"] tbody tr[data-id]')).toHaveCount(1);
  await expect(page.locator('[data-role="orders-table"]')).toContainText('MIO-1002');
  expect(listCalls(calls).at(-1).path).toBe('/orders?page=1&limit=20&status=awaiting_payment');

  await page.click('[data-act="next"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/orders?status=awaiting_payment&page=2');
  await expect.poll(() => listCalls(calls).at(-1).path).toBe('/orders?page=2&limit=20&status=awaiting_payment');
  await page.click('[data-act="prev"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/orders?status=awaiting_payment');
  expect(errors).toEqual([]);
});

test('orders: API lỗi 500 → ui.error có nút Thử lại, bấm lại thì tải được', async ({ page }) => {
  const { state, errors } = await setup(page, { list: 'error', ignoreStatuses: [500] });
  await page.goto(`${PAGE}#/orders`);
  await expect(page.locator('#screen [data-role="retry"]')).toBeVisible();
  state.list = 'ok';
  await page.click('#screen [data-role="retry"]');
  await expect(page.locator('[data-role="orders-table"] tbody tr[data-id]')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('orders: drawer chi tiết hiện món, tiền, tiến trình, thanh toán, chat chỉ đọc; nút ghi chỉ là "Sắp có"', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/orders`);
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer).toContainText('Bánh mì que');
  await expect(drawer).toContainText('Bánh su kem');
  await expect(drawer).toContainText('150.000đ');
  await expect(drawer).toContainText('30.000đ');
  await expect(drawer).toContainText('125.000đ');
  await expect(drawer).toContainText('Tạo đơn');
  await expect(drawer).toContainText('Đã thanh toán');
  await expect(drawer).toContainText('MoMo');
  await expect(drawer).toContainText('090***567');
  await expect(drawer.locator('[data-role="chat"]')).toContainText('Bánh còn hạn nhé bạn.');
  await expect(drawer.locator('[data-role="chat"]')).toContainText('Cửa hàng');
  await expect(drawer).toContainText('Sắp có');
  const soon = drawer.locator('button[data-soon]');
  expect(await soon.count()).toBeGreaterThanOrEqual(4);
  for (const b of await soon.all()) await expect(b).toBeDisabled();
  expect(await drawer.innerText()).not.toMatch(RAW);
  expect(calls.map((c) => c.path.split('?')[0])).toContain(`/orders/${ID1}`);
  expect(calls.every((c) => c.method === 'GET')).toBe(true);
  expect(errors).toEqual([]);
});

test('orders: chat bị CHAT_FORBIDDEN → thông báo chỉ xem được khi có khiếu nại, không phải lỗi màn; đơn đã hủy hiện lý do', async ({ page }) => {
  const { errors } = await setup(page, { chat: 'forbidden', ignoreStatuses: [403] });
  await page.goto(`${PAGE}#/orders`);
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID3}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer.locator('[data-role="chat"]')).toContainText('Chỉ xem được chat khi đơn có khiếu nại');
  await expect(drawer).toContainText('Đã hoàn tiền');
  await expect(drawer).toContainText('Hủy muộn');
  await expect(drawer).toContainText('Khách hủy');
  await expect(drawer.locator('[data-role="retry"]')).toHaveCount(0);
  expect(await drawer.innerText()).not.toMatch(RAW);
  expect(errors).toEqual([]);
});

test('orders: ?demo=1 mở được màn, mở drawer, không gọi /api/v1/**', async ({ page }) => {
  const { calls, errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/orders`);
  const rows = page.locator('[data-role="orders-table"] tbody tr[data-id]');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(5);
  expect(await page.locator('#screen').innerText()).not.toMatch(RAW);
  await rows.first().click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#drawer [data-role="items"]')).toBeVisible();
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('orders: fixture xem thử đúng shape API (>= 5 đơn, chi tiết theo id, không kèm khách)', () => {
  const list = demoRoutes['GET /orders'];
  expect(list.items.length).toBeGreaterThanOrEqual(5);
  expect(list.pagination.has_next_page).toBe(false);
  const detail = demoResolve('GET', '/orders/' + list.items[0].id);
  expect(detail.order_items.length).toBeGreaterThan(0);
  expect(detail.customer).toBeUndefined();
  expect(demoResolve('GET', '/orders/khong-co')).toBeUndefined();
  expect(demoResolve('POST', '/orders/' + list.items[0].id)).toBeUndefined();
});

test('orders: đóng drawer khi chi tiết còn đang tải thì drawer không tự mở lại', async ({ page }) => {
  const { errors } = await setup(page, { slowDetail: 1000 });
  await page.goto(`${PAGE}#/orders`);
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID1}"]`).click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await page.click('#drawer [data-role="drawer-close"]');
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  await page.waitForTimeout(1500);
  await expect(page.locator('#drawer')).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});
