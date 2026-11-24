// Dữ liệu mẫu cho GET /admin/fraud-alerts (shape của adminOpsService.fraudAlerts).
export default {
  alerts: [
    { key: 'high_cancel_rate:c-101', type: 'high_cancel_rate', severity: 'high', subject_type: 'customer', subject_id: 'c-101', subject_name: 'Trần Văn Bình', description: '5/6 đơn trong 30 ngày bị hủy hoặc vắng mặt (83%)', metrics: { orders_30d: 6, cancelled_or_no_show: 5 }, status: 'open', handled_at: null, note: null },
    { key: 'repeat_no_show:c-102', type: 'repeat_no_show', severity: 'high', subject_type: 'customer', subject_id: 'c-102', subject_name: 'Lê Thị Cúc', description: 'Vắng mặt 3 lần trong 60 ngày', metrics: { no_show_60d: 3 }, status: 'open', handled_at: null, note: null },
    { key: 'repeat_no_show:c-103', type: 'repeat_no_show', severity: 'medium', subject_type: 'customer', subject_id: 'c-103', subject_name: 'Phạm Quốc Dũng', description: 'Vắng mặt 2 lần trong 60 ngày', metrics: { no_show_60d: 2 }, status: 'open', handled_at: null, note: null },
    { key: 'shared_ip:10.0.0.7', type: 'shared_ip', severity: 'medium', subject_type: 'ip', subject_id: '10.0.0.7', subject_name: '10.0.0.7', description: '5 tài khoản đăng nhập từ cùng một địa chỉ IP trong 7 ngày (có thể chỉ là wifi dùng chung)', metrics: { accounts: 5 }, status: 'open', handled_at: null, note: null },
    { key: 'long_pending_payment:o-501', type: 'long_pending_payment', severity: 'low', subject_type: 'order', subject_id: 'o-501', subject_name: '#1042', description: 'Đơn #1042 chờ thanh toán hơn 30 phút (đã quá hạn nhưng chưa bị hủy)', metrics: { minutes_pending: 45, total_cents: 65000 }, status: 'open', handled_at: null, note: null },
    { key: 'high_cancel_rate:c-104', type: 'high_cancel_rate', severity: 'medium', subject_type: 'customer', subject_id: 'c-104', subject_name: 'Hoàng Mai', description: '3/5 đơn trong 30 ngày bị hủy hoặc vắng mặt (60%)', metrics: { orders_30d: 5, cancelled_or_no_show: 3 }, status: 'handled', handled_at: '2026-11-22T09:30:00.000Z', note: 'Đã nhắn nhở khách' },
    { key: 'shared_ip:192.168.1.9', type: 'shared_ip', severity: 'low', subject_type: 'ip', subject_id: '192.168.1.9', subject_name: '192.168.1.9', description: '3 tài khoản đăng nhập từ cùng một địa chỉ IP trong 7 ngày (có thể chỉ là wifi dùng chung)', metrics: { accounts: 3 }, status: 'dismissed', handled_at: '2026-11-21T10:00:00.000Z', note: null },
  ],
  not_detected: [
    'Thiết bị dùng chung / vân tay thiết bị: hệ thống chưa thu thập nên không phát hiện được.',
    'Địa chỉ IP chỉ là tín hiệu yếu (wifi công cộng, mạng nhà dùng chung có thể trùng).',
  ],
};
