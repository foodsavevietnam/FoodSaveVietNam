-- ============================================================================
-- 039_live_location.sql (Vá bảo mật P0-2: Chống leo thang Admin & đồng bộ hồ sơ)
-- Chạy SAU các migration 001 -> 038 (đặc biệt cần 003, 008, 014, 029).
-- Chạy lại nhiều lần an toàn (idempotent 100%). Không xóa / không ghi đè dữ liệu hiện có.
--
-- Làm gì:
--   1. Tạo các bảng chia sẻ vị trí nhiệm vụ (live_locations, location_consents) và chống dò OTP
--      (auth_otp_attempts), bật RLS và thu hồi toàn bộ quyền trực tiếp của anon/authenticated
--      (chỉ Backend dùng service_role đọc/ghi).
--   2. Bổ sung chỉ mục chuẩn hóa email cho tình nguyện viên (volunteers_email_lower_idx) phục vụ
--      cả trigger handle_new_user() lẫn volunteerService.
--   3. Mở rộng protect_profile_privileged_columns() sang BEFORE INSERT OR UPDATE trên public.profiles:
--      - Chặn tuyệt đối người dùng thường (anon/authenticated không phải admin) tự INSERT role='admin',
--        tự đặt status='active' cho partner/charity, hoặc tự đặt points/rank/red_ban_until bất thường.
--      - Giữ kiểm tra UPDATE của 014 (role, status, is_verified nếu có) và khóa thêm points, rank,
--        red_ban_until bằng IS DISTINCT FROM; chỉ cho phép ngoại lệ duy nhất OLD.status='rejected' ->
--        NEW.status='pending' khi OLD.role IN ('partner','charity') để nộp lại hồ sơ bị từ chối.
--   4. Hợp nhất public.handle_new_user():
--      - Giữ nhánh bỏ qua tạo hồ sơ cho TNV đăng nhập OTP email khi khớp bảng public.volunteers.
--      - Giữ nguyên tắc 014: KHÔNG BAO GIỜ cấp role='admin' từ raw_user_meta_data.
--      - Khôi phục đầy đủ các cột hồ sơ từ 008 (profiles, customer_profiles, partner_profiles) +
--        nhánh charity_profiles từ 010/014 với slug xác định theo new.id (không dùng md5(random())).
--      - KHÔNG ghi đè cột role/status khi ON CONFLICT (id) DO UPDATE trên public.profiles.
--
-- Hướng dẫn hoàn tác (chỉ khi thật sự cần quay lui về trạng thái ngay sau 014/038):
--   BEGIN;
--   DROP INDEX IF EXISTS public.volunteers_email_lower_idx;
--   DROP TABLE IF EXISTS public.live_locations, public.location_consents, public.auth_otp_attempts;
--   -- Lưu ý: KHÔNG nên hạ trigger protect_profile_privileged_columns về chỉ BEFORE UPDATE vì sẽ mở lại
--   -- lỗ hổng P0-2 (tự chèn role='admin' qua profiles_insert_self_or_admin). Nếu buộc khôi phục bản 014,
--   -- chạy lại phần 1 & 2 của database/Admin/014_admin_login_security.sql.
--   COMMIT;
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- Kiểm tra các đối tượng nền tảng bắt buộc trước khi chạy
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.customer_profiles') IS NULL
     OR to_regclass('public.partner_profiles') IS NULL
     OR to_regclass('public.charity_profiles') IS NULL
     OR to_regclass('public.volunteers') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Cần áp dụng các migration nền tảng (001, 003, 008, 010, 014) trước khi chạy 039_live_location.sql'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- Đảm bảo cột red_ban_until (từ 029) và metadata/avatar_url trên charity_profiles (từ 011) tồn tại an toàn
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS red_ban_until timestamptz;

ALTER TABLE public.charity_profiles
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- ───────── 1. Bảng vị trí trực tuyến & chống dò OTP (chỉ Backend service_role truy cập) ─────────
CREATE TABLE IF NOT EXISTS public.live_locations (
  actor_kind text NOT NULL CHECK (actor_kind IN ('volunteer', 'customer')),
  actor_id uuid NOT NULL,
  context_kind text NOT NULL CHECK (context_kind IN ('donation', 'order')),
  context_id uuid NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m real CHECK (accuracy_m IS NULL OR (accuracy_m >= 0 AND accuracy_m <= 2000)),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_kind, actor_id),
  CHECK (NOT (lat = 0 AND lng = 0))
);

CREATE INDEX IF NOT EXISTS live_locations_updated_at_idx ON public.live_locations (updated_at);
CREATE INDEX IF NOT EXISTS live_locations_context_idx ON public.live_locations (context_kind, context_id);

CREATE TABLE IF NOT EXISTS public.location_consents (
  actor_kind text NOT NULL CHECK (actor_kind IN ('volunteer', 'customer')),
  actor_id uuid NOT NULL,
  granted boolean NOT NULL,
  policy_version text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  PRIMARY KEY (actor_kind, actor_id)
);

CREATE TABLE IF NOT EXISTS public.auth_otp_attempts (
  key text PRIMARY KEY,
  failed_count int NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

ALTER TABLE public.live_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_otp_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.live_locations,
  public.location_consents,
  public.auth_otp_attempts
FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.live_locations,
  public.location_consents,
  public.auth_otp_attempts
TO service_role;

-- Chỉ mục phục vụ tra cứu email TNV trong cả handle_new_user() và volunteerService
CREATE INDEX IF NOT EXISTS volunteers_email_lower_idx
  ON public.volunteers (lower(trim(email)))
  WHERE email IS NOT NULL;

-- ───────── 2. Khóa leo thang đặc quyền trên public.profiles (P0-2: BEFORE INSERT OR UPDATE) ─────────
-- Lưu ý tương thích:
--   - Luồng đăng ký Customer (FOODSAVE_USER.html, foodsave-auth-client.js) gọi upsert profiles với
--     role='customer' và để mặc định status='active', points=100, rank='Tin cậy', red_ban_until=NULL.
--   - Luồng đăng ký Partner & Charity (foodsave-auth-client.js) gọi upsert profiles với
--     role='partner'|'charity' và status='pending'.
--   - Schema 001..038 không có cột profiles.is_verified (cột này nằm ở stores), nhưng hàm vẫn kiểm tra
--     qua to_jsonb(NEW)/to_jsonb(OLD) để bảo vệ an toàn nếu DB live từng thêm cột này thủ công mà không
--     gây lỗi 42703 trên schema chuẩn.
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated')
     AND NOT coalesce(public.is_admin(), false) THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.role = 'admin'::public.user_role
         OR NEW.role NOT IN ('customer'::public.user_role, 'partner'::public.user_role, 'charity'::public.user_role) THEN
        RAISE EXCEPTION 'Không được tự tạo tài khoản quản trị'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.role IN ('partner'::public.user_role, 'charity'::public.user_role) THEN
        IF NEW.status IS DISTINCT FROM 'pending'::public.profile_status THEN
          RAISE EXCEPTION 'Hồ sơ đối tác hoặc tổ chức từ thiện mới phải ở trạng thái chờ duyệt (pending)'
            USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.status IS DISTINCT FROM 'active'::public.profile_status THEN
        RAISE EXCEPTION 'Trạng thái khởi tạo tài khoản khách hàng không hợp lệ'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.points IS DISTINCT FROM 100 THEN
        RAISE EXCEPTION 'Không được tự đặt điểm uy tín tài khoản'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.rank IS DISTINCT FROM 'Tin cậy' THEN
        RAISE EXCEPTION 'Không được tự đặt hạng tài khoản'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.red_ban_until IS NOT NULL THEN
        RAISE EXCEPTION 'Không được tự đặt thời hạn khóa nhãn đỏ'
          USING ERRCODE = '42501';
      END IF;

      IF lower(coalesce(to_jsonb(NEW) ->> 'is_verified', 'false')) IN ('true', 't', '1') THEN
        RAISE EXCEPTION 'Không được tự xác minh tài khoản'
          USING ERRCODE = '42501';
      END IF;

    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'Không được tự thay đổi vai trò tài khoản'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.status IS DISTINCT FROM OLD.status THEN
        -- Ngoại lệ duy nhất: đối tác / tổ chức bị từ chối ('rejected') được nộp lại hồ sơ về 'pending'
        -- (khớp foodsave-auth-client.js:2783, 4254). Cấm tuyệt đối mọi chiều chuyển đổi khác.
        IF NOT (
          OLD.role IN ('partner'::public.user_role, 'charity'::public.user_role)
          AND OLD.status::text = 'rejected'
          AND NEW.status = 'pending'::public.profile_status
        ) THEN
          RAISE EXCEPTION 'Không được tự thay đổi trạng thái tài khoản'
            USING ERRCODE = '42501';
        END IF;
      END IF;

      IF (to_jsonb(NEW) -> 'is_verified') IS DISTINCT FROM (to_jsonb(OLD) -> 'is_verified') THEN
        RAISE EXCEPTION 'Không được tự thay đổi trạng thái xác minh tài khoản'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.points IS DISTINCT FROM OLD.points THEN
        RAISE EXCEPTION 'Không được tự thay đổi điểm uy tín tài khoản'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.rank IS DISTINCT FROM OLD.rank THEN
        RAISE EXCEPTION 'Không được tự thay đổi hạng tài khoản'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.red_ban_until IS DISTINCT FROM OLD.red_ban_until THEN
        RAISE EXCEPTION 'Không được tự thay đổi thời hạn khóa nhãn đỏ'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_privileged_columns ON public.profiles;
CREATE TRIGGER protect_profile_privileged_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_columns();

-- ───────── 3. Hợp nhất public.handle_new_user() (008 + 010 + 014 + 039) ─────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role public.user_role;
  effective_role public.user_role;
  normalized_email text;
  meta jsonb;
  resolved_full_name text;
  resolved_phone text;
  resolved_avatar text;
  accepted_at timestamptz;
  marketing_opt boolean;
BEGIN
  meta := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  normalized_email := lower(nullif(trim(coalesce(NEW.email, '')), ''));

  -- Auth user tạo khi TNV đăng nhập OTP email: không tạo profiles/customer_profiles
  -- (không biến thành tài khoản người mua; authMiddleware từ chối vì không có profile).
  -- Chỉ bỏ qua khi email thật sự thuộc một TNV trong bảng public.volunteers.
  IF meta ->> 'account_type' = 'volunteer'
     AND normalized_email IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.volunteers v
       WHERE v.email IS NOT NULL
         AND lower(trim(v.email)) = normalized_email
     ) THEN
    RETURN NEW;
  END IF;

  -- Tuyệt đối không nhận role = 'admin' từ raw_user_meta_data (quy tắc 014).
  requested_role := CASE
    WHEN meta ->> 'role' IN ('customer', 'partner', 'charity')
      THEN (meta ->> 'role')::public.user_role
    ELSE 'customer'::public.user_role
  END;

  resolved_full_name := coalesce(
    nullif(trim(coalesce(meta ->> 'full_name', '')), ''),
    nullif(trim(coalesce(meta ->> 'name', '')), '')
  );
  resolved_phone := nullif(trim(coalesce(meta ->> 'phone', '')), '');
  resolved_avatar := nullif(trim(coalesce(meta ->> 'avatar_url', '')), '');

  accepted_at := CASE
    WHEN lower(coalesce(meta ->> 'terms_accepted', '')) IN ('true', 't', '1', 'yes')
      THEN now()
    ELSE NULL
  END;

  marketing_opt := lower(coalesce(meta ->> 'marketing_opt_in', '')) IN ('true', 't', '1', 'yes');

  -- Không ghi đè role hoặc status khi ON CONFLICT (id) DO UPDATE để bảo toàn vai trò hiện có.
  INSERT INTO public.profiles (
    id,
    role,
    email,
    full_name,
    phone,
    avatar_url,
    status,
    metadata,
    terms_accepted_at,
    marketing_opt_in
  )
  VALUES (
    NEW.id,
    requested_role,
    normalized_email,
    resolved_full_name,
    resolved_phone,
    resolved_avatar,
    CASE
      WHEN requested_role IN ('partner'::public.user_role, 'charity'::public.user_role)
        THEN 'pending'::public.profile_status
      ELSE 'active'::public.profile_status
    END,
    meta,
    accepted_at,
    marketing_opt
  )
  ON CONFLICT (id) DO UPDATE
  SET email = coalesce(EXCLUDED.email, public.profiles.email),
      full_name = coalesce(public.profiles.full_name, EXCLUDED.full_name),
      phone = coalesce(public.profiles.phone, EXCLUDED.phone),
      avatar_url = coalesce(public.profiles.avatar_url, EXCLUDED.avatar_url),
      terms_accepted_at = coalesce(public.profiles.terms_accepted_at, EXCLUDED.terms_accepted_at),
      marketing_opt_in = public.profiles.marketing_opt_in OR EXCLUDED.marketing_opt_in,
      metadata = public.profiles.metadata || EXCLUDED.metadata,
      updated_at = now()
  RETURNING role INTO effective_role;

  IF effective_role = 'customer'::public.user_role THEN
    INSERT INTO public.customer_profiles (
      profile_id,
      email,
      phone,
      display_name,
      date_of_birth,
      gender,
      referral_code,
      marketing_opt_in,
      metadata
    )
    VALUES (
      NEW.id,
      normalized_email,
      resolved_phone,
      resolved_full_name,
      nullif(trim(coalesce(meta ->> 'date_of_birth', '')), ''),
      nullif(trim(coalesce(meta ->> 'gender', '')), ''),
      nullif(trim(coalesce(meta ->> 'referral_code', '')), ''),
      marketing_opt,
      meta
    )
    ON CONFLICT (profile_id) DO UPDATE
    SET email = coalesce(EXCLUDED.email, public.customer_profiles.email),
        phone = coalesce(public.customer_profiles.phone, EXCLUDED.phone),
        display_name = coalesce(public.customer_profiles.display_name, EXCLUDED.display_name),
        date_of_birth = coalesce(public.customer_profiles.date_of_birth, EXCLUDED.date_of_birth),
        gender = coalesce(public.customer_profiles.gender, EXCLUDED.gender),
        referral_code = coalesce(public.customer_profiles.referral_code, EXCLUDED.referral_code),
        marketing_opt_in = public.customer_profiles.marketing_opt_in OR EXCLUDED.marketing_opt_in,
        metadata = public.customer_profiles.metadata || EXCLUDED.metadata,
        updated_at = now();

  ELSIF effective_role = 'partner'::public.user_role THEN
    INSERT INTO public.partner_profiles (
      profile_id,
      email,
      phone,
      representative_name,
      representative_title,
      cccd_number,
      legal_name,
      tax_code,
      business_license_number,
      business_type,
      public_hotline,
      admin_email,
      admin_phone,
      onboarding_status,
      terms_accepted_at,
      metadata
    )
    VALUES (
      NEW.id,
      normalized_email,
      resolved_phone,
      coalesce(nullif(trim(coalesce(meta ->> 'representative_name', '')), ''), resolved_full_name),
      nullif(trim(coalesce(meta ->> 'representative_title', '')), ''),
      nullif(trim(coalesce(meta ->> 'cccd_number', '')), ''),
      nullif(trim(coalesce(meta ->> 'legal_name', '')), ''),
      nullif(trim(coalesce(meta ->> 'tax_code', '')), ''),
      nullif(trim(coalesce(meta ->> 'business_license_number', '')), ''),
      coalesce(nullif(trim(coalesce(meta ->> 'business_type', '')), ''), 'other'),
      resolved_phone,
      normalized_email,
      resolved_phone,
      'pending'::public.profile_status,
      accepted_at,
      meta
    )
    ON CONFLICT (profile_id) DO UPDATE
    SET email = coalesce(EXCLUDED.email, public.partner_profiles.email),
        phone = coalesce(public.partner_profiles.phone, EXCLUDED.phone),
        representative_name = coalesce(public.partner_profiles.representative_name, EXCLUDED.representative_name),
        representative_title = coalesce(public.partner_profiles.representative_title, EXCLUDED.representative_title),
        cccd_number = coalesce(public.partner_profiles.cccd_number, EXCLUDED.cccd_number),
        legal_name = coalesce(public.partner_profiles.legal_name, EXCLUDED.legal_name),
        tax_code = coalesce(public.partner_profiles.tax_code, EXCLUDED.tax_code),
        business_license_number = coalesce(public.partner_profiles.business_license_number, EXCLUDED.business_license_number),
        business_type = CASE
          WHEN public.partner_profiles.business_type IS NULL OR public.partner_profiles.business_type = 'other'
            THEN EXCLUDED.business_type
          ELSE public.partner_profiles.business_type
        END,
        public_hotline = coalesce(public.partner_profiles.public_hotline, EXCLUDED.public_hotline),
        admin_email = coalesce(public.partner_profiles.admin_email, EXCLUDED.admin_email),
        admin_phone = coalesce(public.partner_profiles.admin_phone, EXCLUDED.admin_phone),
        terms_accepted_at = coalesce(public.partner_profiles.terms_accepted_at, EXCLUDED.terms_accepted_at),
        metadata = public.partner_profiles.metadata || EXCLUDED.metadata,
        updated_at = now();

  ELSIF effective_role = 'charity'::public.user_role THEN
    -- Dùng slug xác định theo NEW.id để triệt tiêu va chạm ngẫu nhiên của md5(random())
    -- và chống tạo trùng dòng cho cùng một owner_id.
    INSERT INTO public.charity_profiles (
      owner_id,
      email,
      phone,
      name,
      slug,
      address,
      status,
      metadata
    )
    SELECT
      NEW.id,
      coalesce(normalized_email, ''),
      coalesce(resolved_phone, ''),
      coalesce(
        nullif(trim(coalesce(meta ->> 'org_name', '')), ''),
        resolved_full_name,
        'Chưa cập nhật'
      ),
      'charity-' || replace(NEW.id::text, '-', ''),
      coalesce(nullif(trim(coalesce(meta ->> 'address', '')), ''), 'Chưa cập nhật'),
      'pending'::public.profile_status,
      meta
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.charity_profiles cp
      WHERE cp.owner_id = NEW.id
    )
    ON CONFLICT (slug) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Chỉ tạo trigger trên auth.users nếu chưa có để tránh giữ khóa ACCESS EXCLUSIVE không cần thiết trên auth.users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND tgname = 'on_auth_user_created'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- Kiểm chứng nhanh sau khi chạy (chỉ đọc):
--   SELECT tgname, (tgtype & 4) <> 0 AS on_insert, (tgtype & 16) <> 0 AS on_update
--   FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'protect_profile_privileged_columns';
-- ============================================================================
