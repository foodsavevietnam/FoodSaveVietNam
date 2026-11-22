// Dữ liệu mẫu cho GET /admin/withdrawals (shape của ledgerService.listAllWithdrawals: dòng withdrawals + stores(name)).
// REVEAL_SAMPLE là kết quả giả của POST /admin/withdrawals/:id/reveal-account (số giả, không phải tài khoản thật).
export const REVEAL_SAMPLE = { bank_name: 'Vietcombank', account_holder_name: 'NGUYEN THI HOA', account_number: '0123456789014321' };

export default [
  { id: 'wd-1', store_id: 's-1', stores: { name: 'Tiệm bánh Hoa Sữa' }, status: 'requested', amount_cents: 1500000, bank_name: 'Vietcombank', account_last4: '4321', requested_at: '2026-11-23T01:30:00.000Z', failure_reason: null, admin_note: null, bank_txn_ref: null },
  { id: 'wd-2', store_id: 's-2', stores: { name: 'Siêu thị Xanh' }, status: 'approved', amount_cents: 820000, bank_name: 'Techcombank', account_last4: '9876', requested_at: '2026-11-22T09:00:00.000Z', failure_reason: null, admin_note: null, bank_txn_ref: null },
  { id: 'wd-3', store_id: 's-3', stores: { name: 'Bếp Nhà Lan' }, status: 'processing', amount_cents: 450000, bank_name: 'ACB', account_last4: '1122', requested_at: '2026-11-22T03:00:00.000Z', failure_reason: null, admin_note: null, bank_txn_ref: null },
  { id: 'wd-4', store_id: 's-1', stores: { name: 'Tiệm bánh Hoa Sữa' }, status: 'paid', amount_cents: 600000, bank_name: 'Vietcombank', account_last4: '4321', requested_at: '2026-11-20T03:00:00.000Z', failure_reason: null, admin_note: null, bank_txn_ref: 'FT2026112000123' },
  { id: 'wd-5', store_id: 's-3', stores: { name: 'Bếp Nhà Lan' }, status: 'failed', amount_cents: 300000, bank_name: 'ACB', account_last4: '1122', requested_at: '2026-11-19T03:00:00.000Z', failure_reason: 'Sai số tài khoản', admin_note: null, bank_txn_ref: null },
  { id: 'wd-6', store_id: 's-2', stores: { name: 'Siêu thị Xanh' }, status: 'rejected', amount_cents: 200000, bank_name: 'Techcombank', account_last4: '9876', requested_at: '2026-11-18T03:00:00.000Z', failure_reason: null, admin_note: 'Chưa đủ số dư khả dụng', bank_txn_ref: null },
];
