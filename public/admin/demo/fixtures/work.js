// Dữ liệu mẫu cho GET /admin/dashboard/work (shape của adminOpsService.workStrip) và GET /admin/dashboard/overview.
const DAY_MS = 86400000;

export function buildOverview(daysInput = 7) {
  const days = Number(daysInput) === 30 ? 30 : 7;
  const baseDate = Date.parse('2026-11-24T00:00:00Z');
  const series = [];
  let orders = 0;
  let ordersCompleted = 0;
  let ordersCancelled = 0;
  let ordersNoShow = 0;
  let gmvCents = 0;
  let donations = 0;
  let donationsCompleted = 0;
  let complaints = 0;
  let newUsers = 0;

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(baseDate - i * DAY_MS).toISOString().slice(0, 10);
    const dayOrders = 10 + ((i * 3) % 9);
    const completed = Math.max(1, dayOrders - 2);
    const cancelled = 1;
    const noShow = i % 4 === 0 ? 1 : 0;
    const dayGmv = completed * 45000;
    const dayDonations = 1 + (i % 3);
    const dayComplaints = i % 5 === 0 ? 1 : 0;
    const dayUsers = 2 + (i % 4);
    orders += dayOrders;
    ordersCompleted += completed;
    ordersCancelled += cancelled;
    ordersNoShow += noShow;
    gmvCents += dayGmv;
    donations += dayDonations;
    donationsCompleted += Math.max(0, dayDonations - (i % 2));
    complaints += dayComplaints;
    newUsers += dayUsers;
    series.push({
      date,
      orders: dayOrders,
      gmv_cents: dayGmv,
      donations: dayDonations,
      complaints: dayComplaints,
      new_users: dayUsers,
    });
  }

  return {
    days,
    timezone: 'Asia/Ho_Chi_Minh',
    totals: {
      orders,
      orders_completed: ordersCompleted,
      orders_cancelled: ordersCancelled,
      orders_no_show: ordersNoShow,
      gmv_cents: gmvCents,
      donations,
      donations_completed: donationsCompleted,
      complaints,
      new_users: newUsers,
    },
    series,
  };
}

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
