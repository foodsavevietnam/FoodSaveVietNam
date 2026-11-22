// Dữ liệu xem thử (?demo=1) cho màn "Tiền & sổ cái" (dữ liệu mẫu, không phải số thật).
// routes: khóa 'METHOD /đường-dẫn' (không query) → dữ liệu trả về.
// resolve(method, path, body): cho đường dẫn động hoặc POST; trả undefined nếu không khớp.
// Shape theo ledgerService.financeSummary + reconcile và ledgerService.listEntries (tên ví đã là nhãn từ máy chủ). Tiền tính bằng đồng.
const ago = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();

// Tổng quan tiền (GET /admin/finance/summary) dùng fixture chung finance.js; ở đây chỉ có sổ cái và kết quả đối soát.
const RECONCILE = { total_balance: 0, mismatched_wallets: 0, entry_count: 1842, ok: true };

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
};

export function resolve(method, path) {
  if (method === 'POST' && path === '/admin/finance/reconcile') return { synced_orders: 0, ...RECONCILE };
  return undefined;
}
