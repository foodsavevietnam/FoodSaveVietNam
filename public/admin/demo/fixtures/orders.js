// Dữ liệu xem thử (?demo=1) cho màn "Đơn hàng" (hỗ trợ cả /admin/orders* Đợt 3 và đường dẫn cũ /orders*).
const AT = (iso) => `2026-11-23T${iso}:00.000Z`;

const SEED_ORDERS = [
  {
    id: 'a0000001-0000-4000-8000-000000000001',
    order_number: 'MIO-2001',
    status: 'confirmed',
    payment_status: 'paid',
    payment_method: 'momo',
    subtotal_cents: 150000,
    discount_cents: 30000,
    platform_fee_cents: 5000,
    donation_cents: 5000,
    total_cents: 130000,
    policy_label: 'yellow',
    pickup_deadline: AT('13:30'),
    created_at: AT('03:00'),
    paid_at: AT('03:02'),
    settlement_status: 'held',
    stores: { id: 's-1', name: 'Tiệm bánh Hoa Sữa (mẫu)' },
    customer: { id: 'c-1', full_name: 'Nguyễn Văn An (mẫu)', phone: '0901234567' },
    order_items: [
      { id: 'i-1', product_name: 'Bánh mì que', quantity: 2, unit_price_cents: 30000 },
      { id: 'i-2', product_name: 'Bánh su kem', quantity: 3, unit_price_cents: 30000 },
    ],
  },
  {
    id: 'a0000002-0000-4000-8000-000000000002',
    order_number: 'MIO-2002',
    status: 'awaiting_payment',
    payment_status: 'pending',
    payment_method: 'vnpay',
    subtotal_cents: 60000,
    discount_cents: 0,
    platform_fee_cents: 0,
    donation_cents: 0,
    total_cents: 60000,
    policy_label: 'green',
    pickup_deadline: null,
    created_at: AT('05:10'),
    stores: { id: 's-2', name: 'Siêu thị Xanh (mẫu)' },
    customer: { id: 'c-2', full_name: 'Trần Thị Bình (mẫu)', phone: '0912345678' },
    order_items: [{ id: 'i-3', product_name: 'Rau cải', quantity: 1, unit_price_cents: 60000 }],
  },
  {
    id: 'a0000003-0000-4000-8000-000000000003',
    order_number: 'MIO-2003',
    status: 'completed',
    payment_status: 'paid',
    payment_method: 'zalopay',
    subtotal_cents: 85000,
    discount_cents: 17000,
    platform_fee_cents: 0,
    donation_cents: 0,
    total_cents: 68000,
    policy_label: 'green',
    pickup_deadline: AT('08:00'),
    created_at: AT('01:00'),
    paid_at: AT('01:03'),
    completed_at: AT('07:20'),
    settlement_status: 'released',
    stores: { id: 's-1', name: 'Tiệm bánh Hoa Sữa (mẫu)' },
    customer: { id: 'c-3', full_name: 'Lê Minh Châu (mẫu)', phone: '0933333333' },
    order_items: [{ id: 'i-4', product_name: 'Bánh croissant', quantity: 4, unit_price_cents: 21250 }],
  },
  {
    id: 'a0000004-0000-4000-8000-000000000004',
    order_number: 'MIO-2004',
    status: 'cancelled',
    payment_status: 'refunded',
    payment_method: 'card',
    subtotal_cents: 40000,
    discount_cents: 0,
    platform_fee_cents: 0,
    donation_cents: 0,
    total_cents: 40000,
    policy_label: 'red',
    pickup_deadline: AT('06:00'),
    created_at: AT('00:30'),
    paid_at: AT('00:32'),
    cancelled_at: AT('02:00'),
    cancel_reason: 'late_cancel',
    cancelled_by: 'customer',
    settlement_status: 'refunded',
    stores: { id: 's-2', name: 'Siêu thị Xanh (mẫu)' },
    customer: { id: 'c-4', full_name: 'Phạm Quốc Dũng (mẫu)', phone: '0944444444' },
    order_items: [{ id: 'i-5', product_name: 'Cơm hộp', quantity: 1, unit_price_cents: 40000 }],
  },
  {
    id: 'a0000005-0000-4000-8000-000000000005',
    order_number: 'MIO-2005',
    status: 'no_show',
    payment_status: 'paid',
    payment_method: 'vietqr',
    subtotal_cents: 90000,
    discount_cents: 45000,
    platform_fee_cents: 0,
    donation_cents: 0,
    total_cents: 45000,
    policy_label: 'yellow',
    pickup_deadline: AT('04:00'),
    created_at: AT('00:10'),
    paid_at: AT('00:12'),
    no_show_at: AT('04:10'),
    stores: { id: 's-3', name: 'Cửa hàng Bình An (mẫu)' },
    customer: { id: 'c-5', full_name: 'Hoàng Thu Hà (mẫu)', phone: '0955555555' },
    order_items: [{ id: 'i-6', product_name: 'Sữa chua', quantity: 6, unit_price_cents: 15000 }],
  },
  {
    id: 'a0000006-0000-4000-8000-000000000006',
    order_number: 'MIO-2006',
    status: 'ready',
    payment_status: 'paid',
    payment_method: 'momo',
    subtotal_cents: 72000,
    discount_cents: 0,
    platform_fee_cents: 0,
    donation_cents: 2000,
    total_cents: 74000,
    policy_label: null,
    pickup_deadline: AT('14:30'),
    created_at: AT('06:00'),
    paid_at: AT('06:01'),
    settlement_status: 'held',
    stores: { id: 's-3', name: 'Cửa hàng Bình An (mẫu)' },
    customer: { id: 'c-6', full_name: 'Võ Thanh Tùng (mẫu)', phone: '0966666666' },
    order_items: [{ id: 'i-7', product_name: 'Bánh bao', quantity: 6, unit_price_cents: 12000 }],
  },
];

const ORDERS = SEED_ORDERS.map((o) => ({ ...o, events: [] }));

export const orders = ORDERS;

export const routes = {
  'GET /orders': { items: ORDERS, pagination: { page: 1, limit: 20, total: ORDERS.length, has_next_page: false } },
};

function paramsOf(rawPath) {
  const qs = String(rawPath || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

function buildAdminDetail(found) {
  const canCancelRefund = ['pending', 'confirmed', 'ready'].includes(found.status) && found.payment_status === 'paid';
  return {
    ...found,
    items: found.order_items,
    events: found.events || [],
    payment_events: found.paid_at
      ? [{ id: `pe-${found.id.slice(0, 8)}`, provider: found.payment_method, provider_txn_id: `TXN-${found.order_number}`, amount_cents: found.total_cents, status: 'processed', created_at: found.paid_at, processed_at: found.paid_at }]
      : [],
    ledger_entries: found.paid_at
      ? [{ id: `le-${found.id.slice(0, 8)}`, type: 'charge', from: 'Bên ngoài (khách / ngân hàng)', to: 'Giữ chờ (escrow)', amount: found.total_cents, created_at: found.paid_at }]
      : [],
    complaints: [],
    messages: [
      { id: 'dm-1', sender_role: 'customer', body: 'Mình ghé lấy lúc 13h nhé cửa hàng (mẫu).', created_at: AT('03:10') },
      { id: 'dm-2', sender_role: 'partner', body: 'Cửa hàng đã chuẩn bị sẵn đơn cho bạn (mẫu).', created_at: AT('03:12') },
    ],
    refund_capability: {
      can_cancel_refund: canCancelRefund,
      can_mark_no_show: ['confirmed', 'ready'].includes(found.status),
      can_complete: ['confirmed', 'ready'].includes(found.status),
      refundable_cents: canCancelRefund ? found.total_cents : 0,
      via_complaint_only: found.status === 'completed',
    },
  };
}

export function resolve(method, path, body, rawPath) {
  if (method === 'GET' && path === '/admin/orders') {
    const sp = paramsOf(rawPath);
    const status = sp.get('status');
    const q = (sp.get('q') || '').trim().toLowerCase();
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 20));
    const filtered = ORDERS.filter((o) => {
      if (status && o.status !== status) return false;
      if (q && ![o.order_number, o.customer?.full_name, o.customer?.phone, o.stores?.name].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const start = (page - 1) * limit;
    const slice = filtered.slice(start, start + limit);
    return {
      items: slice,
      total: filtered.length,
      page,
      limit,
      pagination: { page, limit, total: filtered.length, has_next_page: start + limit < filtered.length },
    };
  }

  const adminDetail = method === 'GET' ? /^\/admin\/orders\/([^/]+)$/.exec(path) : null;
  if (adminDetail) {
    const found = ORDERS.find((o) => o.id === adminDetail[1]);
    return found ? buildAdminDetail(found) : undefined;
  }

  const adminStatus = method === 'POST' ? /^\/admin\/orders\/([^/]+)\/status$/.exec(path) : null;
  if (adminStatus) {
    const found = ORDERS.find((o) => o.id === adminStatus[1]);
    if (!found) return undefined;
    const next = body?.status;
    const now = new Date().toISOString();
    if (next === 'cancelled') {
      found.status = 'cancelled';
      found.cancelled_at = now;
      found.cancelled_by = 'admin';
      found.cancel_reason = body?.reason || 'admin_cancel';
      if (found.payment_status === 'paid') {
        found.payment_status = 'refunded';
        found.settlement_status = 'refunded';
      }
    } else if (next === 'no_show') {
      found.status = 'no_show';
      found.no_show_at = now;
      found.settlement_status = 'forfeited';
    } else if (next === 'completed') {
      found.status = 'completed';
      found.completed_at = now;
      found.settlement_status = 'released';
    }
    found.events = [...(found.events || []), { id: `ev-${Date.now()}`, event_type: 'admin_action', detail: { reason: body?.reason || '' }, created_at: now }];
    return { id: found.id, status: found.status };
  }

  const adminNote = method === 'POST' ? /^\/admin\/orders\/([^/]+)\/note$/.exec(path) : null;
  if (adminNote) {
    const found = ORDERS.find((o) => o.id === adminNote[1]);
    if (!found) return undefined;
    const now = new Date().toISOString();
    found.events = [...(found.events || []), { id: `ev-${Date.now()}`, event_type: 'admin_note', detail: { note: body?.note || '' }, created_at: now }];
    return { ok: true, id: found.id };
  }

  const legacyDetail = method === 'GET' ? /^\/orders\/([^/]+)$/.exec(path) : null;
  if (legacyDetail) {
    const found = ORDERS.find((o) => o.id === legacyDetail[1]);
    if (!found) return undefined;
    const { customer: _customer, events: _events, ...detail } = found;
    return detail;
  }

  return undefined;
}
