-- ============================================================================
-- 040_charity_rls_and_hardening.sql (Gộp P0-3 + G-4: Chống lộ CCCD & khóa cột đặc quyền)
-- Chạy SAU các migration 001 -> 039 (bắt buộc đã chạy 008, 011, 014, 017, 038, 039).
-- Chạy lại nhiều lần an toàn (idempotent 100%). Không xóa / không sửa dữ liệu hiện có.
--
-- Nội dung thực hiện:
--   (a) P0-3 — Khóa lộ dữ liệu nhạy cảm / CCCD trên public.charity_profiles:
--       - Thu hồi quyền đọc cấp bảng của `anon` trên public.charity_profiles (`REVOKE SELECT` cấp bảng).
--       - Gỡ policy `charity_profiles_public_select_active` (đang cho mọi tài khoản đọc toàn bộ cột,
--         kể cả `metadata` chứa số CCCD và ảnh CCCD 2 mặt) và policy cũ `"Allow public update for testing"`.
--       - Đảm bảo chủ sở hữu (`owner_id = auth.uid()`) VÀ Admin (`public.is_admin()`) trên `authenticated`
--         vẫn đọc/ghi hợp lệ hồ sơ của mình (bản 011 cũ thiếu nhánh `OR public.is_admin()` ở SELECT).
--       - Tạo view công khai `public.charity_profiles_public` (`security_barrier = true`, chỉ chiếu các cột
--         công khai cho tổ chức `status = 'active'`, tuyệt đối không chiếu `metadata`, `phone`, `email`,
--         `address`, `owner_id`, `approved_by`, `rejection_reason`), khóa toàn bộ quyền ghi qua view và
--         chỉ cấp `SELECT` cho `anon`, `authenticated`, `service_role`.
--   (b) G-4 — Khóa các cột đặc quyền & thu hồi quyền ghi trực tiếp không còn dùng trên trình duyệt:
--       - Bổ sung policy `stores_owner_select` trên `public.stores` (`owner_id = auth.uid() OR public.is_admin()`)
--         để chủ cửa hàng đọc lại được dòng cửa hàng `status = 'pending'`/`'rejected'` của chính mình
--         trong luồng onboarding/nộp lại (`foodsave-auth-client.js:4310-4334`).
--       - Trigger `protect_store_privileged_columns` (`BEFORE INSERT OR UPDATE` trên `public.stores`):
--         cho phép onboarding đặt `status='pending'`, `onboarding_status='pending'`, `is_verified=false`,
--         `commission_rate=15.00`, `rating=5.00`, `service_tier='Starter'` khi INSERT; khi UPDATE chặn mọi
--         thay đổi cột đặc quyền bởi người dùng thường, chỉ cho phép ngoại lệ duy nhất `'rejected' -> 'pending'`
--         trên `status` / `onboarding_status` khi đối tác nộp lại hồ sơ bị từ chối.
--       - Trigger `protect_partner_profile_privileged_columns` (`BEFORE INSERT OR UPDATE` trên
--         `public.partner_profiles`): cho phép `onboarding_status='pending'` khi INSERT/upsert lần đầu;
--         khi UPDATE chỉ cho phép ngoại lệ duy nhất `'rejected' -> 'pending'`, chặn mọi chuyển đổi khác.
--       - Gỡ `trigger_auto_create_store_on_approval` trên `public.partner_profiles` (nếu còn sót từ 013).
--       - Gỡ policy `notifications_recipient_update` trên `public.notifications`.
--       - Thu hồi quyền `INSERT, UPDATE, DELETE` trực tiếp của `anon, authenticated` trên 6 bảng đã
--         đi qua Backend Express (`products`, `donations`, `vouchers`, `reviews`, `notifications`, `volunteers`).
--       - Cố định `SET search_path = public` cho 2 hàm trigger `public.set_updated_at()` (001) và
--         `public.set_seller_reputation_updated_at()` (002).
--
-- Hướng dẫn hoàn tác (chỉ dùng khi khẩn cấp cần quay lui từng phần — KHÔNG khuyến nghị mở lại lộ CCCD):
--   BEGIN;
--   DROP POLICY IF EXISTS stores_owner_select ON public.stores;
--   DROP TRIGGER IF EXISTS protect_store_privileged_columns ON public.stores;
--   DROP FUNCTION IF EXISTS public.protect_store_privileged_columns();
--   DROP TRIGGER IF EXISTS protect_partner_profile_privileged_columns ON public.partner_profiles;
--   DROP FUNCTION IF EXISTS public.protect_partner_profile_privileged_columns();
--   DROP VIEW IF EXISTS public.charity_profiles_public;
--   -- Nếu cần khôi phục quyền ghi client cho 1 trong 6 bảng (không khuyến nghị vì API dùng service_role):
--   -- GRANT INSERT, UPDATE, DELETE ON TABLE public.<ten_bang> TO authenticated;
--   COMMIT;
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ───────── 0. Kiểm tra điều kiện tiên quyết ─────────
DO $$
BEGIN
  IF to_regclass('public.stores') IS NULL
     OR to_regclass('public.partner_profiles') IS NULL
     OR to_regclass('public.charity_profiles') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Cần áp dụng các migration nền tảng (001, 008, 010, 011, 014) trước khi chạy 040'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'stores'
      AND column_name = 'onboarding_status'
  ) THEN
    RAISE EXCEPTION 'Thiếu cột public.stores.onboarding_status — cần chạy database/Seller/008_split_customer_partner_profiles.sql trước 040'
      USING ERRCODE = '55000';
  END IF;

  IF to_regprocedure('public.protect_charity_approval_status()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'public.charity_profiles'::regclass
         AND tgname = 'protect_charity_approval_status'
         AND tgenabled <> 'D'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'Cần áp dụng database/User/038_api_write_hardening.sql trước khi chạy 040'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Đảm bảo các cột công khai từ 011 và 017 trên charity_profiles có mặt đầy đủ trước khi tạo view
ALTER TABLE public.charity_profiles
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS service_radius_km numeric(6,2) NOT NULL DEFAULT 5;

-- ───────── (a) P0-3: Khóa lộ CCCD trên public.charity_profiles & mở view công khai an toàn ─────────
ALTER TABLE public.charity_profiles ENABLE ROW LEVEL SECURITY;

-- Thu hồi quyền cấp bảng của anon (KHÔNG dùng REVOKE theo cột vì grant cũ ở 001 là cấp bảng)
REVOKE ALL ON TABLE public.charity_profiles FROM anon;

-- Gỡ policy đọc công khai toàn bảng và các policy mở rộng cũ (nếu còn sót từ 001/013)
DROP POLICY IF EXISTS charity_profiles_public_select_active ON public.charity_profiles;
DROP POLICY IF EXISTS "Allow public update for testing" ON public.charity_profiles;
DROP POLICY IF EXISTS admin_view_partner_profiles ON public.partner_profiles;
DROP POLICY IF EXISTS admin_view_partners ON public.partner_profiles;

-- Đảm bảo chủ sở hữu (owner_id = auth.uid()) VÀ Admin (public.is_admin()) giữ nguyên quyền trên authenticated
DROP POLICY IF EXISTS charity_profiles_owner_select ON public.charity_profiles;
CREATE POLICY charity_profiles_owner_select
  ON public.charity_profiles
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS charity_profiles_owner_insert ON public.charity_profiles;
CREATE POLICY charity_profiles_owner_insert
  ON public.charity_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS charity_profiles_owner_update ON public.charity_profiles;
CREATE POLICY charity_profiles_owner_update
  ON public.charity_profiles
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS charity_profiles_owner_delete ON public.charity_profiles;
CREATE POLICY charity_profiles_owner_delete
  ON public.charity_profiles
  FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.charity_profiles TO authenticated, service_role;

-- View công khai chỉ chứa cột hiển thị an toàn của tổ chức đã duyệt (status = 'active').
-- Mặc định security_invoker = false để anon/authenticated đọc được view mà không cần quyền đọc bảng gốc;
-- bật security_barrier = true và thu hồi mọi quyền INSERT/UPDATE/DELETE trên view để chặn ghi xuyên qua
-- auto-updatable view dưới default privileges của Supabase.
CREATE OR REPLACE VIEW public.charity_profiles_public
WITH (security_barrier = true)
AS
SELECT
  id,
  name,
  slug,
  district,
  city,
  rating,
  latitude,
  longitude,
  avatar_url,
  status,
  beneficiaries_count,
  service_radius_km,
  is_open
FROM public.charity_profiles
WHERE status = 'active'::public.profile_status;

REVOKE ALL ON TABLE public.charity_profiles_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.charity_profiles_public TO anon, authenticated, service_role;

-- ───────── (b1) G-4: Policy đọc cửa hàng của chủ sở hữu & bảo vệ cột đặc quyền trên public.stores ─────────
-- Trong 001_foodsave_schema.sql:598 mới chỉ có stores_public_select_active (status = 'active'),
-- nên cần bổ sung stores_owner_select để chủ cửa hàng vừa đăng ký / nộp lại (status = 'pending'/'rejected')
-- đọc lại được dòng của mình ở foodsave-auth-client.js:4310-4334 (INSERT/UPDATE ... RETURNING * và SELECT id).
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stores_owner_select ON public.stores;
CREATE POLICY stores_owner_select
  ON public.stores
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin());

-- Tương thích 100% với foodsave-auth-client.js:4093-4118 & 4286-4343:
--   storePayload gửi status='pending', onboarding_status='pending', is_verified=false,
--   service_tier='Starter' (và để mặc định commission_rate=15.00, rating=5.00, reviewed_at=NULL).
CREATE OR REPLACE FUNCTION public.protect_store_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated')
     AND NOT coalesce(public.is_admin(), false) THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IS DISTINCT FROM 'pending'::public.profile_status THEN
        RAISE EXCEPTION 'Cửa hàng mới đăng ký phải ở trạng thái chờ duyệt (pending)'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.onboarding_status IS DISTINCT FROM 'pending'::public.profile_status THEN
        RAISE EXCEPTION 'Trạng thái tiếp nhận cửa hàng mới phải là chờ duyệt (pending)'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.is_verified IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được xác minh cửa hàng'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.commission_rate IS DISTINCT FROM 15.00 THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được thiết lập mức chiết khấu khác mặc định'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.rating IS DISTINCT FROM 5.00 THEN
        RAISE EXCEPTION 'Không được tự đặt điểm đánh giá cửa hàng'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.service_tier IS DISTINCT FROM 'Starter' THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được gán gói dịch vụ khác Starter'
          USING ERRCODE = '42501';
      END IF;

      IF (to_jsonb(NEW) ->> 'reviewed_at') IS NOT NULL
         OR (to_jsonb(NEW) ->> 'rejection_reason') IS NOT NULL THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được ghi thông tin xét duyệt cửa hàng'
          USING ERRCODE = '42501';
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- Ngoại lệ duy nhất: cửa hàng bị từ chối ('rejected') nộp lại hồ sơ về 'pending' (foodsave-auth-client.js:4116)
        IF NOT (
          OLD.status::text = 'rejected'
          AND NEW.status = 'pending'::public.profile_status
        ) THEN
          RAISE EXCEPTION 'Chỉ quản trị viên mới được thay đổi trạng thái duyệt cửa hàng'
            USING ERRCODE = '42501';
        END IF;
      END IF;

      IF NEW.onboarding_status IS DISTINCT FROM OLD.onboarding_status THEN
        -- Ngoại lệ duy nhất: cửa hàng bị từ chối nộp lại về 'pending' (cấm khi cửa hàng đang active/suspended)
        IF NOT (
          OLD.onboarding_status::text = 'rejected'
          AND NEW.onboarding_status = 'pending'::public.profile_status
          AND OLD.status::text IN ('rejected', 'pending')
        ) THEN
          RAISE EXCEPTION 'Chỉ quản trị viên mới được thay đổi trạng thái tiếp nhận cửa hàng'
            USING ERRCODE = '42501';
        END IF;
      END IF;

      IF NEW.is_verified IS DISTINCT FROM OLD.is_verified THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được thay đổi trạng thái xác minh cửa hàng'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.commission_rate IS DISTINCT FROM OLD.commission_rate THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được thay đổi mức chiết khấu cửa hàng'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.rating IS DISTINCT FROM OLD.rating THEN
        RAISE EXCEPTION 'Không được tự thay đổi điểm đánh giá cửa hàng'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.service_tier IS DISTINCT FROM OLD.service_tier THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được thay đổi gói dịch vụ cửa hàng'
          USING ERRCODE = '42501';
      END IF;

      IF (to_jsonb(NEW) -> 'reviewed_at') IS DISTINCT FROM (to_jsonb(OLD) -> 'reviewed_at')
         OR (to_jsonb(NEW) -> 'rejection_reason') IS DISTINCT FROM (to_jsonb(OLD) -> 'rejection_reason') THEN
        RAISE EXCEPTION 'Chỉ quản trị viên mới được cập nhật kết quả xét duyệt cửa hàng'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_store_privileged_columns ON public.stores;
CREATE TRIGGER protect_store_privileged_columns
  BEFORE INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.protect_store_privileged_columns();

-- ───────── (b2) G-4: Bảo vệ onboarding_status trên public.partner_profiles & gỡ trigger 013 ─────────
-- Tương thích 100% với foodsave-auth-client.js:4120-4143 & 4345-4373:
--   savePartnerProfileDetails gọi upsert(partnerProfilePayload, { onConflict: 'profile_id' })
--   với onboarding_status='pending'.
CREATE OR REPLACE FUNCTION public.protect_partner_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated')
     AND NOT coalesce(public.is_admin(), false) THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.onboarding_status IS DISTINCT FROM 'pending'::public.profile_status THEN
        RAISE EXCEPTION 'Hồ sơ đối tác mới phải ở trạng thái chờ duyệt (pending)'
          USING ERRCODE = '42501';
      END IF;

      IF (to_jsonb(NEW) ? 'status')
         AND (to_jsonb(NEW) ->> 'status') IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Hồ sơ đối tác mới phải ở trạng thái chờ duyệt (pending)'
          USING ERRCODE = '42501';
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.onboarding_status IS DISTINCT FROM OLD.onboarding_status THEN
        -- Ngoại lệ duy nhất: hồ sơ đối tác bị từ chối ('rejected') nộp lại về 'pending' (foodsave-auth-client.js:4140)
        IF NOT (
          OLD.onboarding_status::text = 'rejected'
          AND NEW.onboarding_status = 'pending'::public.profile_status
        ) THEN
          RAISE EXCEPTION 'Chỉ quản trị viên mới được thay đổi trạng thái duyệt hồ sơ đối tác'
            USING ERRCODE = '42501';
        END IF;
      END IF;

      IF (to_jsonb(NEW) -> 'status') IS DISTINCT FROM (to_jsonb(OLD) -> 'status') THEN
        IF NOT (
          (to_jsonb(OLD) ->> 'status') = 'rejected'
          AND (to_jsonb(NEW) ->> 'status') = 'pending'
        ) THEN
          RAISE EXCEPTION 'Chỉ quản trị viên mới được thay đổi trạng thái hồ sơ đối tác'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_partner_profile_privileged_columns ON public.partner_profiles;
CREATE TRIGGER protect_partner_profile_privileged_columns
  BEFORE INSERT OR UPDATE ON public.partner_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_partner_profile_privileged_columns();

-- Gỡ trigger SECURITY DEFINER cũ từ 013 (nếu tồn tại trên DB live) để triệt tiêu đường tự tạo/duyệt store
DROP TRIGGER IF EXISTS trigger_auto_create_store_on_approval ON public.partner_profiles;

-- ───────── (b3) G-4: Gỡ policy sửa thông báo & thu hồi quyền ghi trực tiếp 6 bảng qua API ─────────
-- Đã xác minh toàn bộ thư mục public/: không còn trang HTML/JS nào gọi .insert/.update/.upsert/.delete
-- trực tiếp lên 6 bảng products, donations, vouchers, reviews, notifications, volunteers
-- (chỉ còn truy vấn .select() trên products, donations, volunteers). Mọi thao tác ghi đều đi qua
-- Backend Express dùng service_role.
DROP POLICY IF EXISTS notifications_recipient_update ON public.notifications;

REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.products,
  public.donations,
  public.vouchers,
  public.reviews,
  public.notifications,
  public.volunteers
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.products,
  public.donations,
  public.vouchers,
  public.reviews,
  public.notifications,
  public.volunteers
TO service_role;

-- ───────── (b4) G-4: Cố định search_path = public cho 2 hàm trigger từ 001 & 002 ─────────
DO $$
BEGIN
  IF to_regprocedure('public.set_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.set_updated_at() SET search_path = public;
  END IF;

  IF to_regprocedure('public.set_seller_reputation_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.set_seller_reputation_updated_at() SET search_path = public;
  END IF;
END;
$$;

COMMIT;
