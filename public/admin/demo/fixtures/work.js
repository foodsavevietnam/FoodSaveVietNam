// Dữ liệu mẫu cho GET /admin/dashboard/work (shape của adminOpsService.workStrip).
export default {
  verification_pending: 2,
  complaints_waiting_admin: 3,
  withdrawals_requested: 1,
  payout_accounts_pending: 1,
  withdrawals_pending: 2,
  fraud_open: 1,
  customers_locked: 0,
  orders_today: { new: 18, completed: 11, no_show: 1 },
  donations_open: 2,
  tracking_active: 3,
  ledger_unbalanced: 0,
  automation_failed: 1,
};
