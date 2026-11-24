import { expect, test } from '@playwright/test';
import { stubAdmin } from './helpers/fake-supabase.mjs';
import work from '../../public/admin/demo/fixtures/work.js';
import { routes as demoRoutes, resolve as demoResolve } from '../../public/admin/demo/fixtures/orders.js';

// Màn Đơn hàng (Đợt 3): GET /admin/orders, GET /admin/orders/:id, POST /admin/orders/:id/status, POST /admin/orders/:id/note.
const PAGE = '/admin/index.html';
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
const fail = (status, code, message) => ({ status, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code, message } }) });
const ADMIN = { id: 'a1', role: 'admin', status: 'active', full_name: 'Admin Thử', email: 'admin@mio.vn' };

const NOW = Date.now();
const iso = (minutes) => new Date(NOW + minutes * 60000).toISOString();
const ID1 = '11111111-aaaa-4000-8000-000000000001';
const ID2 = '22222222-bbbb-4000-8000-000000000002';
const ID3 = '33333333-cccc-4000-8000-000000000003';
const ID4 = '44444444-dddd-4000-8000-000000000004';
const SECRET_CODE = 'PK9Z4Q';

const seedOrders = () => [
  {
    id: ID1, order_number: 'MIO-1001', status: 'confirmed', payment_status: 'paid', payment_method: 'momo',
    subtotal_cents: 150000, discount_cents: 30000, platform_fee_cents: 5000, donation_cents: 5000, total_cents: 130000,
    policy_label: 'yellow', pickup_deadline: iso(50), created_at: iso(-120), paid_at: iso(-118), settlement_status: 'held',
    pickup_code: SECRET_CODE,
    stores: { id: 's1', name: 'Tiệm bánh Hoa Sữa' }, customer: { id: 'c1', full_name: 'Nguyễn Văn An', phone: '0901234567' },
    order_items: [
      { id: 'i1', product_name: 'Bánh mì que', quantity: 2, unit_price_cents: 30000 },
      { id: 'i2', product_name: 'Bánh su kem', quantity: 3, unit_price_cents: 30000 },
    ],
    events: [],
  },
  {
    id: ID2, order_number: 'MIO-1002', status: 'awaiting_payment', payment_status: 'pending', payment_method: 'vnpay',
    subtotal_cents: 60000, discount_cents: 0, platform_fee_cents: 0, donation_cents: 0, total_cents: 60000,
    policy_label: null, pickup_deadline: null, created_at: iso(-10), pickup_code: SECRET_CODE,
    stores: { id: 's2', name: 'Siêu thị Xanh' }, customer: { id: 'c2', full_name: 'Trần Thị Bình', phone: '0912345678' },
    order_items: [{ id: 'i3', product_name: 'Rau cải', quantity: 1, unit_price_cents: 60000 }],
    events: [],
  },
  {
    id: ID3, order_number: 'MIO-1003', status: 'cancelled', payment_status: 'refunded', payment_method: 'card',
    subtotal_cents: 40000, discount_cents: 0, platform_fee_cents: 0, donation_cents: 0, total_cents: 40000,
    policy_label: 'red', pickup_deadline: iso(-300), created_at: iso(-600), paid_at: iso(-598), cancelled_at: iso(-200),
    cancel_reason: 'late_cancel', cancelled_by: 'customer', settlement_status: 'refunded',
    stores: { id: 's1', name: 'Tiệm bánh Hoa Sữa' }, customer: { id: 'c3', full_name: 'Lê Minh Châu', phone: '0933333333' },
    order_items: [{ id: 'i4', product_name: 'Cơm hộp', quantity: 1, unit_price_cents: 40000 }],
    events: [],
  },
  {
    id: ID4, order_number: 'MIO-1004', status: 'ready', payment_status: 'paid', payment_method: 'vietqr',
    subtotal_cents: 80000, discount_cents: 0, platform_fee_cents: 0, donation_cents: 0, total_cents: 80000,
    policy_label: 'green', pickup_deadline: iso(25), created_at: iso(-40), paid_at: iso(-39), settlement_status: 'held',
    pickup_code: SECRET_CODE,
    stores: { id: 's2', name: 'Siêu thị Xanh' }, customer: { id: 'c4', full_name: 'Phạm Quốc Dũng', phone: '0944555666' },
    order_items: [{ id: 'i5', product_name: 'Sữa hạt', quantity: 2, unit_price_cents: 40000 }],
    events: [],
  },
];

const MESSAGES = [
  { id: 'm1', sender_role: 'customer', body: 'Cửa hàng ơi, bánh bị chua.', created_at: iso(-100) },
  { id: 'm2', sender_role: 'partner', body: 'Bánh còn hạn nhé bạn.', created_at: iso(-90) },
];

function makeApi(state) {
  return async (route, { path, method, body }) => {
    const [bare, query = ''] = path.split('?');
    const params = new URLSearchParams(query);
    if (bare === '/profile/me') return route.fulfill(ok(ADMIN));
    if (bare === '/admin/dashboard/work') return route.fulfill(ok(work));

    if (bare === '/admin/orders' && method === 'GET') {
      if (state.list === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Lỗi máy chủ'));
      const status = params.get('status');
      const q = (params.get('q') || '').trim().toLowerCase();
      const items = state.orders.filter((o) => {
        if (status && o.status !== status) return false;
        if (q && ![o.order_number, o.customer?.full_name, o.customer?.phone].some((v) => String(v || '').toLowerCase().includes(q))) return false;
        return true;
      });
      const page = Number(params.get('page') || 1);
      return route.fulfill(ok({
        items,
        total: state.hasNext ? 45 : items.length,
        page,
        limit: 20,
        pagination: { page, limit: 20, total: state.hasNext ? 45 : items.length, has_next_page: Boolean(state.hasNext) },
      }));
    }

    const detailMatch = method === 'GET' ? /^\/admin\/orders\/([^/]+)$/.exec(bare) : null;
    if (detailMatch) {
      if (state.slowDetail) await new Promise((r) => setTimeout(r, state.slowDetail));
      const order = state.orders.find((o) => o.id === detailMatch[1]);
      if (!order) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy đơn'));
      const canCancelRefund = ['pending', 'confirmed', 'ready'].includes(order.status) && order.payment_status === 'paid';
      return route.fulfill(ok({
        ...order,
        items: order.order_items,
        payment_events: order.paid_at
          ? [{ id: 'pe-1', provider: order.payment_method, provider_txn_id: `TXN-${order.order_number}`, amount_cents: order.total_cents, status: 'processed', created_at: order.paid_at }]
          : [],
        ledger_entries: order.paid_at
          ? [{ id: 'le-1', type: 'charge', from: 'Bên ngoài (khách / ngân hàng)', to: 'Giữ chờ (escrow)', amount: order.total_cents, created_at: order.paid_at }]
          : [],
        complaints: order.id === ID1
          ? [{ id: 'cmp-1', status: 'in_review', reason_code: 'spoiled_expired', issue: 'Bánh có mùi lạ', refund_cents: 0 }]
          : [],
        messages: state.chat === 'forbidden' ? [] : MESSAGES,
        chat_forbidden: state.chat === 'forbidden',
        refund_capability: {
          can_cancel_refund: canCancelRefund,
          can_mark_no_show: ['confirmed', 'ready'].includes(order.status),
          can_complete: ['confirmed', 'ready'].includes(order.status),
          refundable_cents: canCancelRefund ? order.total_cents : 0,
          via_complaint_only: order.status === 'completed',
        },
      }));
    }

    const statusMatch = method === 'POST' ? /^\/admin\/orders\/([^/]+)\/status$/.exec(bare) : null;
    if (statusMatch) {
      if (state.write === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Không đổi được trạng thái'));
      const order = state.orders.find((o) => o.id === statusMatch[1]);
      if (!order) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy đơn'));
      order.status = body.status;
      if (body.status === 'cancelled') {
        order.cancelled_at = iso(0);
        order.cancelled_by = 'admin';
        order.cancel_reason = body.reason;
        order.payment_status = 'refunded';
        order.settlement_status = 'refunded';
      } else if (body.status === 'no_show') {
        order.no_show_at = iso(0);
        order.settlement_status = 'forfeited';
      } else if (body.status === 'completed') {
        order.completed_at = iso(0);
        order.settlement_status = 'released';
      }
      order.events.push({ id: `ev-${order.events.length + 1}`, event_type: 'admin_action', detail: { reason: body.reason }, created_at: iso(0) });
      return route.fulfill(ok({ id: order.id, status: order.status }));
    }

    const noteMatch = method === 'POST' ? /^\/admin\/orders\/([^/]+)\/note$/.exec(bare) : null;
    if (noteMatch) {
      if (state.write === 'error') return route.fulfill(fail(500, 'INTERNAL', 'Không lưu được ghi chú'));
      const order = state.orders.find((o) => o.id === noteMatch[1]);
      if (!order) return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', 'Không tìm thấy đơn'));
      order.events.push({ id: `ev-${order.events.length + 1}`, event_type: 'admin_note', detail: { note: body.note }, created_at: iso(0) });
      return route.fulfill(ok({ ok: true }));
    }

    return route.fulfill(fail(404, 'RESOURCE_NOT_FOUND', `Không có route ${bare}`));
  };
}

async function setup(page, { ignoreStatuses = [], fakeSb = {}, ...over } = {}) {
  const state = { orders: seedOrders(), list: 'ok', chat: 'ok', write: 'ok', hasNext: false, ...over };
  const stub = await stubAdmin(page, { api: makeApi(state), fakeSb, ignoreStatuses });
  return { state, ...stub };
}

const listCalls = (calls) => calls.filter((c) => c.path.split('?')[0] === '/admin/orders' && c.method === 'GET');
const statusCalls = (calls) => calls.filter((c) => c.method === 'POST' && /^\/admin\/orders\/[^/]+\/status$/.test(c.path));
const noteCalls = (calls) => calls.filter((c) => c.method === 'POST' && /^\/admin\/orders\/[^/]+\/note$/.test(c.path));
const RAW = /awaiting_payment|\bpending\b|\bconfirmed\b|no_show|\bcancelled\b|\bin_review\b|\bmomo\b|\bvnpay\b|late_cancel|payment_timeout|\bcents\b/;

test('orders: bảng đơn từ GET /admin/orders, nhãn Việt, tiền, hạn lấy hàng; không lộ mã thô hay pickup_code hay Sắp có', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/orders`);
  const rows = page.locator('[data-role="orders-table"] tbody tr[data-id]');
  await expect(rows).toHaveCount(4);
  const first = rows.nth(0);
  await expect(first).toContainText('MIO-1001');
  await expect(first).toContainText('Nguyễn Văn An');
  await expect(first).toContainText('090***567');
  await expect(first).toContainText('Tiệm bánh Hoa Sữa');
  await expect(first).toContainText('130.000đ');
  await expect(first).toContainText('Cửa hàng đã nhận');
  await expect(first).toContainText('Vàng −50%');
  await expect(first).toContainText(/còn \d+ phút/);
  await expect(rows.nth(1)).toContainText('Chờ thanh toán');
  await expect(rows.nth(2)).toContainText('Đã hủy');
  await expect(rows.nth(2)).toContainText('Đỏ −80%');
  const screenText = await page.locator('#screen').innerText();
  expect(screenText).not.toMatch(RAW);
  expect(screenText).not.toContain('Sắp có');
  expect(await page.content()).not.toContain(SECRET_CODE);
  expect(listCalls(calls)[0].path).toBe('/admin/orders?page=1&limit=20');
  expect(errors).toEqual([]);
});

test('orders: tìm kiếm q (mã đơn / SĐT / tên khách), tab trạng thái trong hash, phân trang Sau/Trước', async ({ page }) => {
  const { calls, errors } = await setup(page, { hasNext: true });
  await page.goto(`${PAGE}#/orders?status=hack`);
  await expect(page.locator('[data-role="orders-table"] tbody tr[data-id]')).toHaveCount(4);
  expect(listCalls(calls)[0].path).toBe('/admin/orders?page=1&limit=20');

  await page.fill('#screen [data-role="search"]', '0944555666');
  await expect(page.locator('[data-role="orders-table"] tbody tr[data-id]')).toHaveCount(1);
  await expect(page.locator('[data-role="orders-table"]')).toContainText('MIO-1004');
  expect(listCalls(calls).at(-1).path).toBe('/admin/orders?page=1&limit=20&q=0944555666');
  expect(await page.evaluate(() => location.hash)).toContain('q=0944555666');

  await page.fill('#screen [data-role="search"]', '');
  await expect(page.locator('[data-role="orders-table"] tbody tr[data-id]')).toHaveCount(4);

  await page.click('[data-act="tab"][data-status="awaiting_payment"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/orders?status=awaiting_payment');
  await expect(page.locator('[data-role="orders-table"] tbody tr[data-id]')).toHaveCount(1);
  await expect(page.locator('[data-role="orders-table"]')).toContainText('MIO-1002');
  expect(listCalls(calls).at(-1).path).toBe('/admin/orders?page=1&limit=20&status=awaiting_payment');

  await page.click('[data-act="next"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/orders?status=awaiting_payment&page=2');
  await expect.poll(() => listCalls(calls).at(-1).path).toBe('/admin/orders?page=2&limit=20&status=awaiting_payment');
  await page.click('[data-act="prev"]');
  expect(await page.evaluate(() => location.hash)).toBe('#/orders?status=awaiting_payment');
  expect(errors).toEqual([]);
});

test('orders: API lỗi 500 → Thử lại; escape XSS dữ liệu độc; deep-link #/orders?id= mở thẳng ngăn kéo', async ({ page }) => {
  const { state, errors } = await setup(page, { list: 'error', ignoreStatuses: [500, 404] });
  await page.goto(`${PAGE}#/orders`);
  await expect(page.locator('#screen [data-role="retry"]')).toBeVisible();
  state.list = 'ok';
  state.orders[0].customer.full_name = '<img src=x onerror="window.__xss=1">';
  await page.click('#screen [data-role="retry"]');
  await expect(page.locator('[data-role="orders-table"] tbody tr[data-id]')).toHaveCount(4);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();

  await page.goto(`${PAGE}#/orders?id=${ID4}`);
  await expect(page.locator('#drawer [data-role="order-detail"]')).toContainText('Sữa hạt');
  await expect(page.locator('#drawer')).toContainText('MIO-1004');
  expect(await page.content()).not.toContain(SECRET_CODE);

  await page.goto(`${PAGE}#/orders?id=00000000-0000-4000-8000-000000000999`);
  await expect(page.locator('#screen [data-role="notice"]')).toContainText('Không tìm thấy đơn hàng');
  expect(errors).toEqual([]);
});

test('orders: drawer GET /admin/orders/:id hiện đủ items, tiền, payment_events, ledger_entries, complaints, messages, refund_capability', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/orders`);
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer).toContainText('Bánh mì que');
  await expect(drawer).toContainText('150.000đ');
  await expect(drawer).toContainText('130.000đ');
  await expect(drawer).toContainText('Có thể hủy & hoàn tiền (130.000đ)');
  await expect(drawer.locator('[data-role="payment-events"]')).toContainText('TXN-MIO-1001');
  await expect(drawer.locator('[data-role="payment-events"]')).toContainText('Đã xử lý');
  await expect(drawer.locator('[data-role="ledger-entries"]')).toContainText('Khách trả (giữ chờ)');
  await expect(drawer.locator('[data-role="ledger-entries"]')).toContainText('Tiền giữ chờ');
  await expect(drawer.locator('[data-role="complaints"]')).toContainText('Chờ Admin');
  await expect(drawer.locator('[data-role="complaints"]')).toContainText('Hư hỏng / hết hạn');
  await expect(drawer.locator('[data-role="chat"]')).toContainText('Bánh còn hạn nhé bạn.');
  await expect(drawer).not.toContainText('Sắp có');
  expect(await drawer.innerText()).not.toMatch(RAW);
  expect(await page.content()).not.toContain(SECRET_CODE);
  expect(calls.map((c) => c.path.split('?')[0])).toContain(`/admin/orders/${ID1}`);
  expect(errors).toEqual([]);
});

test('orders: 4 thao tác can thiệp trực tiếp (Hủy & hoàn, Vắng mặt, Hoàn tất thay, Thêm ghi chú) bắt buộc lý do ≥ 3 ký tự', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/orders`);

  // 1. Thêm ghi chú + Hủy & hoàn tiền trên đơn ID1 (confirmed)
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID1}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer.locator('[data-act="order-status"]')).toHaveCount(3);

  await drawer.locator('[data-act="order-note"]').click();
  const modal = page.locator('#modal');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('ab');
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('Đã gọi xác nhận với khách');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã thêm ghi chú');
  expect(noteCalls(calls)[0]).toMatchObject({ path: `/admin/orders/${ID1}/note`, body: { note: 'Đã gọi xác nhận với khách' } });
  await expect(drawer).toContainText('Đã gọi xác nhận với khách');

  await drawer.locator('[data-act="order-status"][data-status="cancelled"]').click();
  await expect(modal.locator('[data-role="ok"]')).toBeDisabled();
  await modal.locator('[data-role="reason"]').fill('Cửa hàng hết bánh đột xuất');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã hủy đơn');
  expect(statusCalls(calls)[0]).toMatchObject({ path: `/admin/orders/${ID1}/status`, body: { status: 'cancelled', reason: 'Cửa hàng hết bánh đột xuất' } });
  // Sau khi đã hủy, 3 nút đổi trạng thái ẩn đi, chỉ còn Thêm ghi chú
  await expect(drawer.locator('[data-act="order-status"]')).toHaveCount(0);
  await expect(drawer.locator('[data-act="order-note"]')).toBeVisible();
  await page.click('#drawer [data-role="drawer-close"]');

  // 2. Đánh dấu vắng mặt trên đơn ID4 (ready)
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID4}"]`).click();
  await drawer.locator('[data-act="order-status"][data-status="no_show"]').click();
  await modal.locator('[data-role="reason"]').fill('Quá hạn lấy 45 phút không liên lạc được');
  await modal.locator('[data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã đánh dấu khách vắng mặt');
  expect(statusCalls(calls)[1]).toMatchObject({ path: `/admin/orders/${ID4}/status`, body: { status: 'no_show', reason: 'Quá hạn lấy 45 phút không liên lạc được' } });
  expect(errors).toEqual([]);
});

test('orders: Hoàn tất thay cửa hàng gửi status=completed và cập nhật drawer', async ({ page }) => {
  const { calls, errors } = await setup(page);
  await page.goto(`${PAGE}#/orders`);
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID4}"]`).click();
  const drawer = page.locator('#drawer');
  await drawer.locator('[data-act="order-status"][data-status="completed"]').click();
  await page.locator('#modal [data-role="reason"]').fill('Khách đã nhận hàng nhưng tiệm quên bấm');
  await page.locator('#modal [data-role="ok"]').click();
  await expect(page.locator('#toasts')).toContainText('Đã hoàn tất đơn hàng');
  expect(statusCalls(calls)[0]).toMatchObject({ path: `/admin/orders/${ID4}/status`, body: { status: 'completed', reason: 'Khách đã nhận hàng nhưng tiệm quên bấm' } });
  await expect(drawer).toContainText('chỉ hoàn tiền qua Khiếu nại');
  expect(errors).toEqual([]);
});

test('orders: chat bị giới hạn → thông báo chỉ xem được khi có khiếu nại; đóng drawer khi đang tải chậm không tự mở lại', async ({ page }) => {
  const { state, errors } = await setup(page, { chat: 'forbidden' });
  await page.goto(`${PAGE}#/orders`);
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID3}"]`).click();
  const drawer = page.locator('#drawer');
  await expect(drawer.locator('[data-role="chat"]')).toContainText('Chỉ xem được chat khi đơn có khiếu nại');
  await expect(drawer).toContainText('Hủy muộn');
  await page.click('#drawer [data-role="drawer-close"]');

  state.slowDetail = 900;
  await page.locator(`[data-role="orders-table"] tr[data-id="${ID1}"]`).click();
  await expect(drawer).toHaveClass(/open/);
  await page.click('#drawer [data-role="drawer-close"]');
  await expect(drawer).not.toHaveClass(/open/);
  await page.waitForTimeout(1200);
  await expect(drawer).not.toHaveClass(/open/);
  expect(errors).toEqual([]);
});

test('orders: ?demo=1 mở được màn, tìm kiếm, mở drawer và can thiệp mẫu mà không gọi /api/v1/**', async ({ page }) => {
  const { calls, errors } = await setup(page, { fakeSb: { noSession: true } });
  await page.goto(`${PAGE}?demo=1#/orders`);
  const rows = page.locator('[data-role="orders-table"] tbody tr[data-id]');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(5);
  expect(await page.locator('#screen').innerText()).not.toMatch(RAW);
  await rows.first().click();
  await expect(page.locator('#drawer')).toHaveClass(/open/);
  await expect(page.locator('#drawer [data-role="items"]')).toBeVisible();
  await expect(page.locator('#drawer [data-act="order-note"]')).toBeVisible();
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('orders: fixture xem thử phục vụ đủ /admin/orders* và giữ tương thích /orders*', () => {
  const adminList = demoResolve('GET', '/admin/orders', undefined, '/admin/orders?page=1&limit=20');
  expect(adminList.items.length).toBeGreaterThanOrEqual(5);
  const adminDetail = demoResolve('GET', `/admin/orders/${adminList.items[0].id}`);
  expect(adminDetail.items.length).toBeGreaterThan(0);
  expect(Array.isArray(adminDetail.payment_events)).toBe(true);
  expect(Array.isArray(adminDetail.ledger_entries)).toBe(true);
  expect(adminDetail.refund_capability).toBeTruthy();

  const legacyList = demoRoutes['GET /orders'];
  expect(legacyList.items.length).toBeGreaterThanOrEqual(5);
  const legacyDetail = demoResolve('GET', `/orders/${legacyList.items[0].id}`);
  expect(legacyDetail.customer).toBeUndefined();
});
