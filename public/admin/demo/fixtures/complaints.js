// Dữ liệu mẫu cho GET /admin/complaints (mảng đã bổ sung order_number, order_total, customer_name, store_name)
// và cho GET /orders/:id/messages (named export `messages`).
const base = { reason_code: 'spoiled_expired', image_urls: [], store_response: null, store_response_action: null, store_response_images: [], store_responded_at: null, response_due_at: null, escalated_at: null, decision: null, refund_cents: null, is_false_claim: false, admin_note: null, resolution: null };

export default [
  { ...base, id: 'c0a1b2c3-0001', order_id: 'o-1001', order_number: '1001', order_total: 120000, customer_name: 'Nguyễn Văn An', store_name: 'Tiệm bánh Hoa Sữa', status: 'in_review', priority: 'high', issue: 'Bánh mì có mùi chua, đã hết hạn từ hôm qua.', image_urls: ['https://example.com/anh-1.jpg'], store_response_action: 'dispute', store_response: 'Bánh còn hạn đến cuối ngày.', store_responded_at: '2026-11-23T05:00:00.000Z', escalated_at: '2026-11-23T05:00:00.000Z', created_at: '2026-11-23T02:00:00.000Z' },
  { ...base, id: 'c0a1b2c3-0002', order_id: 'o-1002', order_number: '1002', order_total: 85000, customer_name: 'Trần Thị Bình', store_name: 'Tiệm bánh Hoa Sữa', status: 'open', priority: 'medium', reason_code: 'missing_items', issue: 'Thiếu một túi rau.', image_urls: ['https://example.com/anh-2.jpg'], response_due_at: '2099-01-01T00:00:00.000Z', created_at: '2026-11-23T06:00:00.000Z' },
  { ...base, id: 'c0a1b2c3-0003', order_id: 'o-1003', order_number: '1003', order_total: 60000, customer_name: 'Lê Minh Châu', store_name: 'Siêu thị Xanh', status: 'resolved', priority: 'low', reason_code: 'wrong_item', issue: 'Giao sai món.', decision: 'refund_full', refund_cents: 60000, admin_note: 'Đã hoàn đủ.', created_at: '2026-11-21T06:00:00.000Z' },
];

export const messages = [
  { id: 'm1', sender_role: 'customer', body: 'Cửa hàng ơi, bánh bị chua.', created_at: '2026-11-23T02:10:00.000Z' },
  { id: 'm2', sender_role: 'partner', body: 'Bánh còn hạn nhé bạn.', created_at: '2026-11-23T02:20:00.000Z' },
  { id: 'm3', sender_role: 'system', body: 'Khiếu nại đã được tạo.', created_at: '2026-11-23T02:30:00.000Z' },
];
