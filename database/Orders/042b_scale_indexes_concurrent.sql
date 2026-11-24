-- ============================================================================
-- 042b_scale_indexes_concurrent.sql (Wave 3A: P2-3b Chỉ mục nóng & dọn chỉ mục trùng)
-- Chạy SAU 041_atomic_order_ledger_rpcs.sql và 042_scale_outbox_and_rpcs.sql.
--
-- LƯU Ý QUAN TRỌNG KHI TRIỂN KHAI PRODUCTION:
--   - KHÔNG bọc trong khối giao dịch vì PostgreSQL CẤM CREATE/DROP INDEX CONCURRENTLY
--     bên trong transaction block (lỗi SQLSTATE 25001).
--   - Trong Supabase SQL Editor: chạy TỪNG LỆNH riêng lẻ (hoặc dùng psql chế độ autocommit)
--     để tạo/gỡ chỉ mục trực tuyến mà KHÔNG khóa ghi production.
--   - An toàn chạy lại nhiều lần nhờ IF NOT EXISTS / IF EXISTS.
--   - Nếu lệnh tạo chỉ mục CONCURRENTLY bị gián đoạn tạo chỉ mục INVALID, xóa bằng
--     DROP INDEX CONCURRENTLY IF EXISTS public.<ten_chi_muc>; rồi chạy lại lệnh đó.
--
-- Hướng dẫn hoàn tác (chạy từng lệnh rời, không bọc transaction):
--   DROP INDEX CONCURRENTLY IF EXISTS public.background_jobs_pending_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.complaints_pending_outcome_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.products_store_label_active_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.donations_open_expires_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.order_messages_unread_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.donation_photos_auto_approve_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.orders_status_updated_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.orders_created_desc_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.orders_ledger_sync_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.orders_store_settlement_held_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.notifications_broadcast_created_idx;
--   DROP INDEX CONCURRENTLY IF EXISTS public.notifications_recipient_created_idx;
-- ============================================================================

-- ───────── 1. Bộ chỉ mục nóng (truy vấn tần suất cao & cron tác vụ nền) ─────────
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications (recipient_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_broadcast_created_idx
  ON public.notifications (role_target, created_at DESC)
  WHERE recipient_id IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_store_settlement_held_idx
  ON public.orders (store_id, settlement_status)
  WHERE settlement_status = 'held';

CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_ledger_sync_idx
  ON public.orders (settlement_status, ledger_synced_status)
  WHERE settlement_status <> 'none';

CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_created_desc_idx
  ON public.orders (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_status_updated_idx
  ON public.orders (status, updated_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS donation_photos_auto_approve_idx
  ON public.donation_photos (review_deadline_at)
  WHERE status = 'pending' AND gps_flag = false;

CREATE INDEX CONCURRENTLY IF NOT EXISTS order_messages_unread_idx
  ON public.order_messages (order_id, sender_role)
  WHERE read_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS donations_open_expires_idx
  ON public.donations (offer_expires_at)
  WHERE status = 'open' AND offer_expires_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS products_store_label_active_idx
  ON public.products (store_id, label)
  WHERE is_active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS complaints_pending_outcome_idx
  ON public.complaints (id)
  WHERE status = 'resolved' AND outcome_applied_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS background_jobs_pending_idx
  ON public.background_jobs (status, run_at)
  WHERE status = 'pending';

-- ───────── 2. Dọn 2 chỉ mục trùng 100% với ràng buộc UNIQUE sẵn có ─────────
-- 001_foodsave_schema.sql: vouchers.code đã có UNIQUE (vouchers_code_key) -> vouchers_code_idx dư thừa
DROP INDEX CONCURRENTLY IF EXISTS public.vouchers_code_idx;

-- 006_eco_impact_tracker.sql: eco_impact_events đã có UNIQUE (source_type, source_id) -> idx_eco_impact_events_source dư thừa
DROP INDEX CONCURRENTLY IF EXISTS public.idx_eco_impact_events_source;
