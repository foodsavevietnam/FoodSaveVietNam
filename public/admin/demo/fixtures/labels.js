// Dữ liệu mẫu cho GET /admin/labels (shape của adminOpsService.labelOverview).
export default {
  counts: { green: 12, yellow: 5, red: 2 },
  total: 19,
  lots: [
    { id: 'p-1', name: 'Bánh mì que pate', store_name: 'Tiệm Bánh Nắng', label: 'red', stock_quantity: 6, expires_at: '2026-11-23T14:00:00.000Z', effective_deadline_at: '2026-11-23T13:30:00.000Z', price_cents: 8000, original_price_cents: 16000, label_changed_at: '2026-11-23T06:00:00.000Z' },
    { id: 'p-2', name: 'Sữa chua nếp cẩm', store_name: 'Cửa hàng An Lành', label: 'yellow', stock_quantity: 14, expires_at: '2026-11-24T09:00:00.000Z', effective_deadline_at: null, price_cents: 12000, original_price_cents: 18000, label_changed_at: null },
    { id: 'p-3', name: 'Rau cải thìa hữu cơ', store_name: 'Cửa hàng An Lành', label: 'green', stock_quantity: 30, expires_at: '2026-11-26T09:00:00.000Z', effective_deadline_at: null, price_cents: 25000, original_price_cents: 30000, label_changed_at: null },
  ],
};
