// Dữ liệu mẫu cho GET /admin/vouchers (shape của adminOpsService.listVouchers).
// Mốc thời gian tính theo lúc nạp để trạng thái (đang bật / hết hạn) luôn đúng với ngày xem thử.
const DAY = 86400000;
const at = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();
const base = {
  description: '', percent_off: null, fixed_discount_cents: null, min_order_cents: 0, max_redemptions: null,
  redemption_count: 0, is_active: true, created_at: at(-40),
};
export default [
  { ...base, id: 'v-1', store_id: null, store_name: 'Toàn sàn', code: 'GIOVANG10', name: 'Giờ vàng giảm 10%', percent_off: 10,
    min_order_cents: 50000, max_redemptions: 200, redemption_count: 37, starts_at: at(-30), expires_at: at(60), state: 'live' },
  { ...base, id: 'v-2', store_id: null, store_name: 'Toàn sàn', code: 'MIO20K', name: 'Giảm thẳng 20.000đ', fixed_discount_cents: 20000,
    redemption_count: 112, starts_at: at(-20), expires_at: at(30), state: 'live' },
  { ...base, id: 'v-3', store_id: null, store_name: 'Toàn sàn', code: 'KHAITRUONG', name: 'Khai trương tháng 10', percent_off: 15,
    max_redemptions: 100, redemption_count: 100, starts_at: at(-60), expires_at: at(-10), state: 'expired' },
  { ...base, id: 'v-4', store_id: null, store_name: 'Toàn sàn', code: 'TAMDUNG', name: 'Tạm dừng thử nghiệm', percent_off: 5,
    redemption_count: 4, is_active: false, starts_at: at(-15), expires_at: at(45), state: 'off' },
  { ...base, id: 'v-5', store_id: 's-101', store_name: 'Tiệm Bánh Nắng', code: 'NANG5', name: 'Bánh chiều giảm 5%', percent_off: 5,
    redemption_count: 9, starts_at: at(-5), expires_at: at(20), state: 'live' },
  { ...base, id: 'v-6', store_id: null, store_name: 'Toàn sàn', code: 'HETLUOT', name: 'Đã phát hết lượt', percent_off: 12,
    max_redemptions: 50, redemption_count: 50, starts_at: at(-10), expires_at: at(25), state: 'used_up' },
  { ...base, id: 'v-7', store_id: null, store_name: 'Toàn sàn', code: 'SAPDIENRA', name: 'Sắp diễn ra', fixed_discount_cents: 15000,
    starts_at: at(5), expires_at: at(35), state: 'scheduled' },
];
