// Danh mục 19 màn của thanh bên (spec mục 3). Không import config.js (chạm window) để Node đọc được.
export const GROUPS = ['HÔM NAY', 'CẦN QUYẾT ĐỊNH', 'HỒ SƠ', 'HOẠT ĐỘNG', 'TĂNG TRƯỞNG', 'HỆ THỐNG'];

const n = (v) => Number(v) || 0;
const sum = (w, ...keys) => keys.reduce((total, key) => total + n(w?.[key]), 0);
const pending = () => import('./_pending.js');

export const SCREENS = [
  { id: 'today', title: 'Hôm nay', group: 'HÔM NAY', load: () => import('./today.js'),
    badge: (w) => sum(w, 'verification_pending', 'complaints_waiting_admin', 'withdrawals_requested', 'payout_accounts_pending', 'fraud_open') },
  { id: 'complaints', title: 'Khiếu nại', group: 'CẦN QUYẾT ĐỊNH', load: () => import('./complaints.js'), badge: (w) => sum(w, 'complaints_waiting_admin') },
  { id: 'verify', title: 'Duyệt hồ sơ', group: 'CẦN QUYẾT ĐỊNH', load: () => import('./verify.js'), badge: (w) => sum(w, 'verification_pending', 'payout_accounts_pending') },
  { id: 'payouts', title: 'Rút tiền & chi trả', group: 'CẦN QUYẾT ĐỊNH', load: () => import('./payouts.js'), badge: (w) => sum(w, 'withdrawals_requested') },
  { id: 'alerts', title: 'Cảnh báo gian lận', group: 'CẦN QUYẾT ĐỊNH', load: () => import('./alerts.js'), badge: (w) => sum(w, 'fraud_open') },
  { id: 'customers', title: 'Người mua', group: 'HỒ SƠ', load: () => import('./customers.js') },
  { id: 'stores', title: 'Cửa hàng', group: 'HỒ SƠ', load: () => import('./stores.js') },
  { id: 'charities', title: 'Tổ chức & tình nguyện viên', group: 'HỒ SƠ', load: () => import('./charities.js') },
  { id: 'orders', title: 'Đơn hàng', group: 'HOẠT ĐỘNG', load: () => import('./orders.js') },
  { id: 'donations', title: 'Lô tặng & ghép đơn', group: 'HOẠT ĐỘNG', load: () => import('./donations.js') },
  { id: 'tracking', title: 'Bản đồ theo dõi', group: 'HOẠT ĐỘNG', load: () => import('./tracking.js') },
  { id: 'inventory', title: 'Hàng đang bán', group: 'HOẠT ĐỘNG', load: () => import('./inventory.js') },
  { id: 'ledger', title: 'Tiền & sổ cái', group: 'HOẠT ĐỘNG', load: () => import('./ledger.js'), badge: (w) => sum(w, 'ledger_unbalanced') },
  { id: 'vouchers', title: 'Khuyến mãi', group: 'TĂNG TRƯỞNG', load: () => import('./vouchers.js') },
  { id: 'marketing', title: 'Đăng bài tự động', group: 'TĂNG TRƯỞNG', load: () => import('./marketing.js'), badge: (w) => sum(w, 'marketing_queue') },
  { id: 'esg', title: 'Tác động ESG', group: 'TĂNG TRƯỞNG', load: () => import('./esg.js') },
  { id: 'rules', title: 'Quy tắc & tự động', group: 'HỆ THỐNG', load: () => import('./rules.js'), badge: (w) => sum(w, 'automation_failed') },
  { id: 'audit', title: 'Nhật ký', group: 'HỆ THỐNG', load: () => import('./audit.js') },
  { id: 'settings', title: 'Cài đặt', group: 'HỆ THỐNG', load: () => import('./settings.js') },
];
