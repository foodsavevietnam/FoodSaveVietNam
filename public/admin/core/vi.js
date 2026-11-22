// Từ vựng tiếng Việt cho mã trạng thái: không hiện mã thô lên giao diện.
import { html, raw } from './ui.js';

export const VI = {
  order: { awaiting_payment: ['Chờ thanh toán', 'm'], pending: ['Chờ cửa hàng nhận', 'w'], confirmed: ['Cửa hàng đã nhận', 'i'], ready: ['Sẵn sàng lấy', 'i'], completed: ['Hoàn thành', 'ok'], cancelled: ['Đã hủy', 'm'], no_show: ['Khách vắng mặt', 'e'] },
  complaint: { open: ['Chờ cửa hàng', 'w'], in_review: ['Chờ Admin', 'e'], resolved: ['Đã hoàn tiền', 'ok'], rejected: ['Đã bác bỏ', 'm'] },
  withdrawal: { requested: ['Chờ duyệt', 'w'], approved: ['Đã duyệt', 'i'], processing: ['Đang chuyển', 'i'], paid: ['Đã chuyển', 'ok'], failed: ['Chuyển lỗi', 'e'], rejected: ['Từ chối', 'm'] },
  payoutAccount: { pending_verification: ['Chờ xác minh', 'w'], verified: ['Đã xác minh', 'ok'], rejected: ['Từ chối', 'm'], replaced: ['Đã thay', 'm'] },
  payoutWarning: { name_mismatch: ['Tên chủ tài khoản khác tên chủ cửa hàng', 'w'], no_registered_name: ['Chưa có tên đăng ký kinh doanh', 'w'] },
  label: { green: ['Xanh −20%', 'ok'], yellow: ['Vàng −50%', 'w'], red: ['Đỏ −80%', 'e'] },
  ledger: { charge: 'Khách trả (giữ chờ)', release: 'Giải ngân cửa hàng', refund: 'Hoàn khách', refund_clawback: 'Thu hồi từ cửa hàng', withdraw: 'Rút tiền', adjustment: 'Điều chỉnh tay' },
  fraud: { high_cancel_rate: 'Hủy nhiều', repeat_no_show: 'Vắng mặt lặp lại', long_pending_payment: 'Treo thanh toán', shared_ip: 'Nhiều tài khoản cùng mạng' },
  complaintReason: { wrong_item: 'Giao sai sản phẩm', spoiled_expired: 'Hư hỏng / hết hạn', missing_items: 'Thiếu sản phẩm', other: 'Lý do khác' },
  complaintDecision: { refund_full: 'Hoàn đủ', refund_partial: 'Hoàn một phần', reject: 'Bác bỏ' },
  fraudStatus: { open: ['Chưa xử lý', 'w'], handled: ['Đã xử lý', 'ok'], dismissed: ['Đã bỏ qua', 'm'] },
  voucher: { live: ['Đang bật', 'ok'], off: ['Đã tắt', 'm'], expired: ['Hết hạn', 'm'], scheduled: ['Chưa bắt đầu', 'i'], used_up: ['Hết lượt', 'w'] },
  severity: { high: ['Cao', 'e'], medium: ['Trung bình', 'w'], low: ['Thấp', 'm'] },
};

export function badge(group, code) {
  const entry = Object.prototype.hasOwnProperty.call(VI[group] || {}, code) ? VI[group][code] : null;
  const [text, level] = Array.isArray(entry) ? entry : [typeof entry === 'string' ? entry : code, 'm'];
  return html`<span class="b b-${raw(level)}">${text}</span>`;
}

// Tên hành động trong nhật ký (`<đối_tượng>.<động_từ>`) → chữ tiếng Việt.
export const ACTIONS = {
  'verification.approve': 'Duyệt hồ sơ',
  'verification.reject': 'Từ chối hồ sơ',
  'customer.unlock': 'Mở khóa nhãn đỏ cho khách',
  'automation.run': 'Chạy tác vụ tự động',
  'voucher.create': 'Tạo khuyến mãi',
  'voucher.enable': 'Bật khuyến mãi',
  'voucher.disable': 'Tắt khuyến mãi',
  'fraud.handled': 'Xử lý cảnh báo gian lận',
  'fraud.dismissed': 'Bỏ qua cảnh báo gian lận',
  'policy.update': 'Cập nhật quy tắc đơn hàng',
  'settings.update': 'Cập nhật cài đặt',
  'complaint.resolve': 'Quyết định khiếu nại',
  'complaint.refund_full': 'Khiếu nại: hoàn đủ',
  'complaint.refund_partial': 'Khiếu nại: hoàn một phần',
  'complaint.reject': 'Khiếu nại: bác bỏ',
  'withdrawal.approve': 'Duyệt lệnh rút',
  'withdrawal.reject': 'Từ chối lệnh rút',
  'withdrawal.start': 'Bắt đầu chi tiền rút',
  'withdrawal.pay': 'Xác nhận đã chi tiền rút',
  'withdrawal.fail': 'Đánh dấu chi tiền rút thất bại',
  'payout_account.verify': 'Xác minh tài khoản nhận tiền',
  'payout_account.reject': 'Từ chối tài khoản nhận tiền',
  'payout_account.reveal': 'Xem số tài khoản đầy đủ',
};

// Action lạ (chưa có trong bảng) hiện nguyên văn; nơi dựng HTML tự escape qua tag `html`.
export function actionLabel(action) {
  if (action == null || action === '') return '—';
  const key = String(action);
  return Object.prototype.hasOwnProperty.call(ACTIONS, key) ? ACTIONS[key] : key;
}
