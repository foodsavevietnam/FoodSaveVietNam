// Dữ liệu xem thử (?demo=1) cho màn "Tiền & sổ cái" (gồm cả tab Sổ cái bút toán và Sự kiện thanh toán).
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

const RECONCILE = { total_balance: 0, mismatched_wallets: 0, entry_count: 1842, ok: true };

const PAYMENT_EVENTS = [
  { id: 'pe-1', provider: 'momo', provider_txn_id: 'MM-20261123-001', order_id: 'a0000001-0000-4000-8000-000000000001', order_number: 'MIO-2001', amount_cents: 130000, status: 'processed', created_at: ago(12), processed_at: ago(12) },
  { id: 'pe-2', provider: 'zalopay', provider_txn_id: 'ZP-20261123-002', order_id: 'a0000003-0000-4000-8000-000000000003', order_number: 'MIO-2003', amount_cents: 68000, status: 'processed', created_at: ago(45), processed_at: ago(45) },
  { id: 'pe-3', provider: 'vnpay', provider_txn_id: 'VN-20261123-003', order_id: 'a0000002-0000-4000-8000-000000000002', order_number: 'MIO-2002', amount_cents: 60000, status: 'received', created_at: ago(90), processed_at: null },
  { id: 'pe-4', provider: 'momo', provider_txn_id: 'MM-20261123-004', order_id: null, order_number: 'MIO-2099', amount_cents: 99000, status: 'rejected', created_at: ago(180), processed_at: ago(180) },
];

export const routes = {
  'GET /admin/ledger': {
    total: 7,
    items: [
      { id: 'e1000001-0000-4000-8000-000000000001', type: 'charge', order_number: 'FS-20261123-0042', from: 'Bên ngoài (khách / ngân hàng)', to: 'Giữ chờ (escrow)', amount: 62000, reason: null, created_at: ago(8) },
      { id: 'e1000001-0000-4000-8000-000000000002', type: 'release', order_number: 'FS-20261123-0039', from: 'Giữ chờ (escrow)', to: 'Ví Tiệm bánh Mẫu', amount: 54000, reason: 'completed', created_at: ago(35) },
      { id: 'e1000001-0000-4000-8000-000000000003', type: 'release', order_number: 'FS-20261123-0039', from: 'Giữ chờ (escrow)', to: 'Doanh thu nền tảng', amount: 2000, reason: 'completed', created_at: ago(35) },
      { id: 'e1000001-0000-4000-8000-000000000004', type: 'release', order_number: 'FS-20261123-0039', from: 'Giữ chờ (escrow)', to: 'Quỹ từ thiện', amount: 1000, reason: 'completed', created_at: ago(35) },
      { id: 'e1000001-0000-4000-8000-000000000005', type: 'refund', order_number: 'FS-20261122-0031', from: 'Giữ chờ (escrow)', to: 'Bên ngoài (khách / ngân hàng)', amount: 30000, reason: 'complaint_partial', created_at: ago(260) },
      { id: 'e1000001-0000-4000-8000-000000000006', type: 'withdraw', order_number: null, from: 'Ví Quán cơm Mẫu', to: 'Bên ngoài (khách / ngân hàng)', amount: 500000, reason: null, created_at: ago(900) },
      { id: 'e1000001-0000-4000-8000-000000000007', type: 'release', order_number: 'FS-20261121-0017', from: 'Giữ chờ (escrow)', to: 'Ví Quán cơm Mẫu', amount: 18000, reason: 'no_show', created_at: ago(1500) },
    ],
  },
  'GET /admin/payments/summary': {
    total_events: PAYMENT_EVENTS.length,
    total_amount_cents: 357000,
    processed_amount_cents: 198000,
    by_status: {
      processed: { count: 2, amount_cents: 198000 },
      received: { count: 1, amount_cents: 60000 },
      rejected: { count: 1, amount_cents: 99000 },
    },
    by_provider: {
      momo: { count: 2, amount_cents: 229000 },
      zalopay: { count: 1, amount_cents: 68000 },
      vnpay: { count: 1, amount_cents: 60000 },
    },
  },
};

function paramsOf(rawPath) {
  const qs = String(rawPath || '').split('?')[1] || '';
  return new URLSearchParams(qs);
}

export function resolve(method, path, _body, rawPath) {
  if (method === 'POST' && path === '/admin/finance/reconcile') return { synced_orders: 0, ...RECONCILE };

  if (method === 'GET' && path === '/admin/payments') {
    const sp = paramsOf(rawPath);
    const provider = (sp.get('provider') || '').toLowerCase();
    const status = (sp.get('status') || '').toLowerCase();
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit')) || 25));
    const filtered = PAYMENT_EVENTS.filter((p) => {
      if (provider && p.provider !== provider) return false;
      if (status && p.status !== status) return false;
      return true;
    });
    const start = (page - 1) * limit;
    return {
      items: filtered.slice(start, start + limit),
      total: filtered.length,
      page,
      limit,
    };
  }

  return undefined;
}
