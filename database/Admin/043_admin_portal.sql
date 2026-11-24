-- ============================================================================
-- 043_admin_portal.sql (Wave 4A — Admin Portal Đợt 2: cột tạm khóa/ẩn & chỉ mục tìm kiếm)
-- Chạy SAU các migration 001 -> 042b (bắt buộc 001, 003, 008, 009, 010, 014, 016, 034, 036, 038, 039, 040).
-- Chạy lại nhiều lần an toàn (idempotent 100%). KHÔNG xóa / KHÔNG sửa dữ liệu hiện có.
-- KHÔNG động vào hàm public.handle_new_user().
--
-- Làm gì:
--   1. Thêm cột tạm khóa/tạm ngưng cho profiles, stores, charity_profiles.
--   2. Thêm cột ẩn bởi Admin cho products (admin_hidden_*) và reviews (hidden_*).
--   3. Thêm cột ghi chú/người xử lý cho contact_messages và applications (bảo vệ IF EXISTS).
--   4. Cập nhật policy reviews_public_select: ẩn các đánh giá đã bị Admin ẩn trừ public.is_admin().
--   5. Bật extension pg_trgm (an toàn nếu thiếu quyền) và tạo các chỉ mục btree/trgm phục vụ
--      liệt kê, phân trang và tìm kiếm trên cổng quản trị.
--
-- Hướng dẫn hoàn tác (chỉ khi thật sự cần quay lui):
--   BEGIN;
--   DROP INDEX IF EXISTS
--     public.profiles_role_status_created_idx,
--     public.profiles_full_name_trgm_idx,
--     public.profiles_phone_trgm_idx,
--     public.profiles_email_trgm_idx,
--     public.stores_status_created_idx,
--     public.stores_name_trgm_idx,
--     public.charity_profiles_status_created_idx,
--     public.charity_profiles_name_trgm_idx,
--     public.volunteers_status_created_idx,
--     public.volunteers_full_name_trgm_idx,
--     public.orders_status_created_idx,
--     public.orders_order_number_trgm_idx,
--     public.products_admin_hidden_idx,
--     public.products_store_label_idx,
--     public.donations_status_created_idx,
--     public.notifications_admin_type_created_idx,
--     public.admin_audit_log_target_idx,
--     public.admin_audit_log_actor_idx,
--     public.payment_events_created_idx,
--     public.reviews_hidden_created_idx,
--     public.applications_status_created_idx;
--   DROP POLICY IF EXISTS reviews_public_select ON public.reviews;
--   CREATE POLICY reviews_public_select ON public.reviews FOR SELECT USING (true);
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS suspended_at, DROP COLUMN IF EXISTS suspended_reason;
--   ALTER TABLE public.stores DROP COLUMN IF EXISTS suspended_at, DROP COLUMN IF EXISTS suspended_reason, DROP COLUMN IF EXISTS suspended_by;
--   ALTER TABLE public.charity_profiles DROP COLUMN IF EXISTS suspended_at, DROP COLUMN IF EXISTS suspended_reason;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS admin_hidden_at, DROP COLUMN IF EXISTS admin_hidden_reason, DROP COLUMN IF EXISTS admin_hidden_by;
--   ALTER TABLE public.reviews DROP COLUMN IF EXISTS hidden_at, DROP COLUMN IF EXISTS hidden_reason, DROP COLUMN IF EXISTS hidden_by;
--   ALTER TABLE IF EXISTS public.contact_messages DROP COLUMN IF EXISTS admin_note, DROP COLUMN IF EXISTS handled_by, DROP COLUMN IF EXISTS handled_at;
--   ALTER TABLE IF EXISTS public.applications DROP COLUMN IF EXISTS admin_note, DROP COLUMN IF EXISTS handled_by, DROP COLUMN IF EXISTS handled_at;
--   COMMIT;
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ───────── 0. Kiểm tra các đối tượng nền tảng ─────────
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.stores') IS NULL
     OR to_regclass('public.charity_profiles') IS NULL
     OR to_regclass('public.products') IS NULL
     OR to_regclass('public.reviews') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Cần áp dụng các migration nền tảng (001..040) trước khi chạy 043_admin_portal.sql'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- ───────── 1. Cột tạm khóa / tạm ngưng ─────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.charity_profiles
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

-- ───────── 2. Cột ẩn bởi Admin trên sản phẩm & đánh giá ─────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS admin_hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_hidden_reason text,
  ADD COLUMN IF NOT EXISTS admin_hidden_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS hidden_reason text,
  ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ───────── 3. Cột xử lý hỗ trợ trên contact_messages & applications ─────────
DO $$
BEGIN
  IF to_regclass('public.contact_messages') IS NOT NULL THEN
    ALTER TABLE public.contact_messages
      ADD COLUMN IF NOT EXISTS admin_note text,
      ADD COLUMN IF NOT EXISTS handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS handled_at timestamptz;
  END IF;

  IF to_regclass('public.applications') IS NOT NULL THEN
    ALTER TABLE public.applications
      ADD COLUMN IF NOT EXISTS admin_note text,
      ADD COLUMN IF NOT EXISTS handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS handled_at timestamptz;
  END IF;
END;
$$;

-- ───────── 4. Policy đọc đánh giá công khai: ẩn đánh giá bị Admin ẩn trừ Admin ─────────
DROP POLICY IF EXISTS reviews_public_select ON public.reviews;
CREATE POLICY reviews_public_select
  ON public.reviews
  FOR SELECT
  USING (hidden_at IS NULL OR public.is_admin());

-- ───────── 5. Bật pg_trgm an toàn & tạo chỉ mục liệt kê / tìm kiếm ─────────
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END;
$$;

-- Chỉ mục B-tree hỗ trợ lọc & phân trang trên cổng quản trị
CREATE INDEX IF NOT EXISTS profiles_role_status_created_idx
  ON public.profiles (role, status, created_at DESC);

CREATE INDEX IF NOT EXISTS stores_status_created_idx
  ON public.stores (status, created_at DESC);

CREATE INDEX IF NOT EXISTS charity_profiles_status_created_idx
  ON public.charity_profiles (status, created_at DESC);

CREATE INDEX IF NOT EXISTS volunteers_status_created_idx
  ON public.volunteers (status, created_at DESC);

CREATE INDEX IF NOT EXISTS orders_status_created_idx
  ON public.orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS products_admin_hidden_idx
  ON public.products (admin_hidden_at)
  WHERE admin_hidden_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_store_label_idx
  ON public.products (store_id, label);

CREATE INDEX IF NOT EXISTS donations_status_created_idx
  ON public.donations (status, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_admin_type_created_idx
  ON public.notifications (type, created_at DESC)
  WHERE type LIKE 'admin-%';

CREATE INDEX IF NOT EXISTS reviews_hidden_created_idx
  ON public.reviews (hidden_at, created_at DESC);

DO $$
BEGIN
  IF to_regclass('public.admin_audit_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx
      ON public.admin_audit_log (target_type, target_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx
      ON public.admin_audit_log (actor_id, created_at DESC);
  END IF;

  IF to_regclass('public.payment_events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS payment_events_created_idx
      ON public.payment_events (created_at DESC);
  END IF;

  IF to_regclass('public.applications') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS applications_status_created_idx
      ON public.applications (status, created_at DESC);
  END IF;
END;
$$;

-- Chỉ mục GIN trigram hỗ trợ ilike tìm kiếm nhanh (chỉ tạo khi pg_trgm sẵn sàng)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS profiles_full_name_trgm_idx
      ON public.profiles USING gin (full_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS profiles_phone_trgm_idx
      ON public.profiles USING gin (phone gin_trgm_ops);
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email'
    ) THEN
      CREATE INDEX IF NOT EXISTS profiles_email_trgm_idx
        ON public.profiles USING gin (email gin_trgm_ops);
    END IF;
    CREATE INDEX IF NOT EXISTS stores_name_trgm_idx
      ON public.stores USING gin (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS charity_profiles_name_trgm_idx
      ON public.charity_profiles USING gin (name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS volunteers_full_name_trgm_idx
      ON public.volunteers USING gin (full_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS orders_order_number_trgm_idx
      ON public.orders USING gin (order_number gin_trgm_ops);
  END IF;
END;
$$;

COMMIT;
