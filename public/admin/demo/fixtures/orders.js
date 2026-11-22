// Dữ liệu xem thử (?demo=1) cho màn "Đơn hàng".
// routes: khóa 'METHOD /đường-dẫn' (không query) → dữ liệu trả về.
// resolve(method, path, body): cho đường dẫn động (ví dụ /orders/:id); trả undefined nếu không khớp.
// Shape đúng GET /orders ({ items, pagination }) và GET /orders/:id (đơn, không nhúng khách). Tên là dữ liệu mẫu.
const AT = (iso) => `2026-11-23T${iso}:00.000Z`;

const ORDERS = [
  { id: 'a0000001-0000-4000-8000-000000000001', order_number: 'MIO-2001', status: 'confirmed', payment_status: 'paid', payment_method: 'momo', subtotal_cents: 150000, discount_cents: 30000, platform_fee_cents: 0, donation_cents: 5000, total_cents: 125000, policy_label: 'yellow', pickup_deadline: AT('13:30'), created_at: AT('03:00'), paid_at: AT('03:02'), settlement_status: 'held', stores: { id: 's-1', name: 'Tiệm bánh Hoa Sữa (mẫu)' }, customer: { full_name: 'Nguyễn Văn An (mẫu)', phone: '0901234567' }, order_items: [{ id: 'i-1', product_name: 'Bánh mì que', quantity: 2, unit_price_cents: 30000 }, { id: 'i-2', product_name: 'Bánh su kem', quantity: 3, unit_price_cents: 30000 }] },
  { id: 'a0000002-0000-4000-8000-000000000002', order_number: 'MIO-2002', status: 'awaiting_payment', payment_status: 'pending', payment_method: 'vnpay', subtotal_cents: 60000, discount_cents: 0, platform_fee_cents: 0, donation_cents: 0, total_cents: 60000, policy_label: 'green', pickup_deadline: null, created_at: AT('05:10'), stores: { id: 's-2', name: 'Siêu thị Xanh (mẫu)' }, customer: { full_name: 'Trần Thị Bình (mẫu)', phone: '0912345678' }, order_items: [{ id: 'i-3', product_name: 'Rau cải', quantity: 1, unit_price_cents: 60000 }] },
  { id: 'a0000003-0000-4000-8000-000000000003', order_number: 'MIO-2003', status: 'completed', payment_status: 'paid', payment_method: 'zalopay', subtotal_cents: 85000, discount_cents: 17000, platform_fee_cents: 0, donation_cents: 0, total_cents: 68000, policy_label: 'green', pickup_deadline: AT('08:00'), created_at: AT('01:00'), paid_at: AT('01:03'), completed_at: AT('07:20'), settlement_status: 'released', stores: { id: 's-1', name: 'Tiệm bánh Hoa Sữa (mẫu)' }, customer: { full_name: 'Lê Minh Châu (mẫu)', phone: '0933333333' }, order_items: [{ id: 'i-4', product_name: 'Bánh croissant', quantity: 4, unit_price_cents: 21250 }] },
  { id: 'a0000004-0000-4000-8000-000000000004', order_number: 'MIO-2004', status: 'cancelled', payment_status: 'refunded', payment_method: 'card', subtotal_cents: 40000, discount_cents: 0, platform_fee_cents: 0, donation_cents: 0, total_cents: 40000, policy_label: 'red', pickup_deadline: AT('06:00'), created_at: AT('00:30'), paid_at: AT('00:32'), cancelled_at: AT('02:00'), cancel_reason: 'late_cancel', cancelled_by: 'customer', settlement_status: 'refunded', stores: { id: 's-2', name: 'Siêu thị Xanh (mẫu)' }, customer: { full_name: 'Phạm Quốc Dũng (mẫu)', phone: '0944444444' }, order_items: [{ id: 'i-5', product_name: 'Cơm hộp', quantity: 1, unit_price_cents: 40000 }] },
  { id: 'a0000005-0000-4000-8000-000000000005', order_number: 'MIO-2005', status: 'no_show', payment_status: 'paid', payment_method: 'vietqr', subtotal_cents: 90000, discount_cents: 45000, platform_fee_cents: 0, donation_cents: 0, total_cents: 45000, policy_label: 'yellow', pickup_deadline: AT('04:00'), created_at: AT('00:10'), paid_at: AT('00:12'), no_show_at: AT('04:10'), stores: { id: 's-3', name: 'Cửa hàng Bình An (mẫu)' }, customer: { full_name: 'Hoàng Thu Hà (mẫu)', phone: '0955555555' }, order_items: [{ id: 'i-6', product_name: 'Sữa chua', quantity: 6, unit_price_cents: 15000 }] },
  { id: 'a0000006-0000-4000-8000-000000000006', order_number: 'MIO-2006', status: 'ready', payment_status: 'paid', payment_method: 'momo', subtotal_cents: 72000, discount_cents: 0, platform_fee_cents: 0, donation_cents: 2000, total_cents: 74000, policy_label: null, pickup_deadline: AT('14:30'), created_at: AT('06:00'), paid_at: AT('06:01'), settlement_status: 'held', stores: { id: 's-3', name: 'Cửa hàng Bình An (mẫu)' }, customer: { full_name: 'Võ Thanh Tùng (mẫu)', phone: '0966666666' }, order_items: [{ id: 'i-7', product_name: 'Bánh bao', quantity: 6, unit_price_cents: 12000 }] },
];

export const routes = {
  'GET /orders': { items: ORDERS, pagination: { page: 1, limit: 20, total: ORDERS.length, has_next_page: false } },
};

export function resolve(method, path) {
  const m = method === 'GET' ? /^\/orders\/([^/]+)$/.exec(path) : null;
  if (!m) return undefined;
  const found = ORDERS.find((o) => o.id === m[1]);
  if (!found) return undefined;
  const { customer: _customer, ...detail } = found;
  return detail;
}
