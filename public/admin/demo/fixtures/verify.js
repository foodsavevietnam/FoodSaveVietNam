// Dữ liệu mẫu cho GET /admin/verification (shape của adminOpsService.verificationQueue)
// và GET /admin/payout-accounts (named export `accounts`, shape của payoutAccountService.listForAdmin).
export default {
  stores: [
    { id: 's-2001', kind: 'store', name: 'Tiệm bánh Hoa Sữa', address: '12 Lê Lợi, Quận 1', district: 'Quận 1', owner_id: 'u-1', owner_name: 'Nguyễn Thị Hoa', phone: '0901234567', created_at: '2026-11-22T03:00:00.000Z' },
  ],
  charities: [
    { id: 'ch-3001', kind: 'charity', name: 'Quỹ Bếp Yêu Thương', address: '45 Nguyễn Huệ, Quận 1', district: 'Quận 1', phone: '0912345678', email: 'bep@yeuthuong.vn', beneficiaries_count: 120, created_at: '2026-11-21T04:00:00.000Z' },
  ],
  history: [
    { id: 'h-1', actor_name: 'Admin Thử', action: 'verification.approve', target_type: 'store', target_id: 's-1999', detail: { name: 'Siêu thị Xanh', reason: null }, created_at: '2026-11-22T08:00:00.000Z' },
    { id: 'h-2', actor_name: 'Admin Thử', action: 'verification.reject', target_type: 'charity', target_id: 'ch-2999', detail: { name: 'Nhóm Từ Thiện A', reason: 'Thiếu giấy phép' }, created_at: '2026-11-21T08:00:00.000Z' },
  ],
};

export const accounts = [
  { id: 'pa-1', store_id: 's-1', store_name: 'Tiệm bánh Hoa Sữa', bank_name: 'Vietcombank', account_holder_name: 'TRAN VAN B', account_last4: '4321', status: 'pending_verification', warning: 'name_mismatch', registered_name: 'NGUYEN THI HOA', created_at: '2026-11-22T05:00:00.000Z' },
  { id: 'pa-2', store_id: 's-2', store_name: 'Siêu thị Xanh', bank_name: 'Techcombank', account_holder_name: 'LE MINH CHAU', account_last4: '9876', status: 'pending_verification', warning: null, registered_name: 'LE MINH CHAU', created_at: '2026-11-22T06:00:00.000Z' },
];
