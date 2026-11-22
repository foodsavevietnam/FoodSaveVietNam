// Dữ liệu mẫu cho GET /admin/esg (shape của adminOpsService.esgReport).
const sums = (kg, co2, water, meals, money) => ({
  food_saved_kg: kg, co2_avoided_kg: co2, water_saved_liters: water, meals_equivalent: meals, money_saved_cents: money,
});
export default {
  month: '2026-11',
  from: '2026-10-31T17:00:00.000Z',
  to: '2026-11-30T17:00:00.000Z',
  total: sums(412.5, 1031.3, 61875, 1650, 9800000),
  previous: sums(366.2, 915.5, 54930, 1465, 8700000),
  by_source: {
    order: sums(300.1, 750.3, 45015, 1200, 9800000),
    donation: sums(112.4, 281, 16860, 450, 0),
    manual_adjustment: sums(0, 0, 0, 0, 0),
  },
  top_stores: [
    { store_id: 's-101', store_name: 'Tiệm Bánh Nắng', food_saved_kg: 96.4, meals_equivalent: 385 },
    { store_id: 's-102', store_name: 'Cửa hàng An Lành', food_saved_kg: 71.2, meals_equivalent: 285 },
  ],
  orders_completed: 188,
  donations_delivered: 24,
  has_data: true,
  note: 'Số liệu lấy từ bảng eco_impact_events (hệ số quy đổi ở bảng eco_impact_factors). Tháng không có sự kiện thì hiển thị 0.',
};
