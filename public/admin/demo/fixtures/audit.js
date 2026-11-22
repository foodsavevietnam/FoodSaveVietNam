// Dữ liệu mẫu cho GET /admin/audit-log (mảng dòng của adminAuditService.list).
export default [
  { id: 'au-1', actor_id: 'a1', actor_name: 'Quản trị viên (xem thử)', action: 'verification.approve', target_type: 'store', target_id: 's-101', detail: { reason: null }, created_at: '2026-11-23T08:15:00.000Z' },
  { id: 'au-2', actor_id: 'a1', actor_name: 'Quản trị viên (xem thử)', action: 'complaint.resolve', target_type: 'complaint', target_id: 'cp-22', detail: { decision: 'refund' }, created_at: '2026-11-23T07:40:00.000Z' },
  { id: 'au-3', actor_id: null, actor_name: null, action: 'automation.run', target_type: 'automation', target_id: 'order-automation', detail: {}, created_at: '2026-11-22T17:05:00.000Z' },
];
