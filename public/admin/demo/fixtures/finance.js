// Dữ liệu mẫu cho GET /admin/finance/summary (fs_finance_summary + reconcile). Tiền tính bằng đồng.
export default {
  wallets: { platform: 1250000, escrow: 480000 },
  store_wallets_total: 3620000,
  refunded_total: 215000,
  forfeited_total: 64000,
  released_total: 4180000,
  pending_withdrawals_count: 1,
  pending_withdrawals_total: 650000,
  withdrawn_total: 2900000,
  accounts_pending: 1,
  reconcile: { total_balance: 0, mismatched_wallets: 0, entry_count: 1842, ok: true },
};
