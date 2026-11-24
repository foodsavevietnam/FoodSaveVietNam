-- ============================================================================
-- INSPECT_live_security_G1.sql (Giai đoạn 0 — G-1: Kiểm tra trạng thái an ninh DB live)
-- CHỈ ĐỌC (SELECT 100%) — TUYỆT ĐỐI KHÔNG GHI, KHÔNG ĐỔI SCHEMA, KHÔNG ĐỔI DỮ LIỆU.
--
-- Cách dùng trong Supabase SQL Editor:
--   - Có thể bôi đen (highlight) từng mục (a), (b), (c), (d), (e) và bấm Run để xem
--     chi tiết từng phần (đặc biệt mục (b) có toàn bộ mã nguồn hàm handle_new_user).
--   - Hoặc bấm Run toàn bộ tệp: bảng kết quả cuối cùng (mục TỔNG HỢP G-1) sẽ tóm tắt
--     trạng thái ĐẠT / CẦN VÁ cho tất cả các hạng mục trên cùng một bảng.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (a) Kiểm tra trigger & hàm protect_profile_privileged_columns trên public.profiles
--     Yêu cầu đạt chuẩn P0-2 (sau bản vá 039):
--       - Hàm public.protect_profile_privileged_columns() tồn tại, SECURITY DEFINER, search_path=public.
--       - Trigger đang bật (tgenabled = 'O'), chặn CẢ BEFORE INSERT LẪN BEFORE UPDATE
--         (fires_before = true, fires_on_insert = true, fires_on_update = true).
--         Nếu fires_on_insert = false nghĩa là đang ở bản 014 cũ (còn hở hướng INSERT).
-- ----------------------------------------------------------------------------
SELECT
  'a_profiles_trigger' AS check_group,
  t.tgname AS trigger_name,
  t.tgenabled AS trigger_enabled_code,
  (t.tgenabled <> 'D') AS is_enabled,
  ((t.tgtype & 2) <> 0) AS fires_before,
  ((t.tgtype & 4) <> 0) AS fires_on_insert,
  ((t.tgtype & 16) <> 0) AS fires_on_update,
  p.prosecdef AS function_security_definer,
  p.proconfig AS function_config,
  pg_get_triggerdef(t.oid) AS trigger_definition,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_trigger t
  ON t.tgrelid = c.oid
 AND t.tgname = 'protect_profile_privileged_columns'
 AND NOT t.tgisinternal
LEFT JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND c.relname = 'profiles';

-- ----------------------------------------------------------------------------
-- (b) Kiểm tra định nghĩa public.handle_new_user() và trigger on_auth_user_created
--     Các dấu hiệu cần kiểm tra:
--       - still_allows_admin_from_metadata = true  -> NGUY HIỂM (bản 001/003/008/010 cũ, chưa chạy 014!)
--       - has_volunteer_otp_bypass = true          -> Đã có nhánh TNV của 039
--       - overwrites_role_on_conflict = true       -> Còn `on conflict (id) do update set role = excluded.role` (cần vá 039)
--       - uses_random_md5_charity_slug = true      -> Còn dùng `md5(random())` dễ đụng độ ngẫu nhiên (cần vá 039)
-- ----------------------------------------------------------------------------
SELECT
  'b_handle_new_user' AS check_group,
  p.proname AS function_name,
  p.prosecdef AS security_definer,
  p.proconfig AS function_config,
  EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace tn ON tn.oid = c.relnamespace
    WHERE tn.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created'
      AND t.tgenabled <> 'D'
      AND NOT t.tgisinternal
  ) AS auth_users_trigger_active,
  (pg_get_functiondef(p.oid) ~* '''customer''\s*,\s*''partner''\s*,\s*''charity''\s*,\s*''admin''') AS still_allows_admin_from_metadata,
  (pg_get_functiondef(p.oid) ILIKE '%account_type%' AND pg_get_functiondef(p.oid) ILIKE '%volunteer%') AS has_volunteer_otp_bypass,
  (pg_get_functiondef(p.oid) ~* 'on\s+conflict\s*\(\s*id\s*\)\s*do\s+update[\s\S]*\brole\s*=\s*excluded\.role') AS overwrites_role_on_conflict,
  (pg_get_functiondef(p.oid) ILIKE '%md5(random()%') AS uses_random_md5_charity_slug,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'handle_new_user';

-- ----------------------------------------------------------------------------
-- (c) Kiểm tra các RLS policy nguy hiểm từ 001 / 013 trên charity_profiles & partner_profiles
--     Danh sách policy KHÔNG ĐƯỢC TỒN TẠI sau khi khóa bảo mật:
--       1. "Allow public update for testing" (charity_profiles — ai cũng sửa/tự duyệt được)
--       2. admin_view_partner_profiles       (partner_profiles — lộ CCCD/MST/ngân hàng cho mọi user đăng nhập)
--       3. admin_view_partners               (partner_profiles / partners — điều kiện JWT role sai từ 013)
--       4. charity_profiles_public_select_active (charity_profiles — lộ cột metadata chứa CCCD cho anon & authenticated)
--     Kèm kiểm tra quyền SELECT cấp bảng của role `anon` trên charity_profiles.
-- ----------------------------------------------------------------------------
SELECT
  'c_dangerous_policies' AS check_group,
  pol.schemaname,
  pol.tablename,
  pol.policyname,
  pol.permissive,
  pol.roles,
  pol.cmd,
  pol.qual AS using_expression,
  pol.with_check AS with_check_expression
FROM pg_policies pol
WHERE pol.schemaname = 'public'
  AND (
    pol.policyname IN (
      'Allow public update for testing',
      'admin_view_partner_profiles',
      'admin_view_partners',
      'charity_profiles_public_select_active'
    )
    OR pol.tablename IN ('charity_profiles', 'partner_profiles')
  )
ORDER BY
  CASE
    WHEN pol.policyname IN (
      'Allow public update for testing',
      'admin_view_partner_profiles',
      'admin_view_partners',
      'charity_profiles_public_select_active'
    ) THEN 0
    ELSE 1
  END,
  pol.tablename,
  pol.policyname;

-- ----------------------------------------------------------------------------
-- (d) Kiểm tra trigger_auto_create_store_on_approval & hàm handle_partner_approval (từ 013 cũ)
--     Nếu trigger này còn gắn trên partner_profiles và hàm là SECURITY DEFINER,
--     đối tác tự đổi cột (khi chưa có trigger 040) có thể kích hoạt tạo/duyệt cửa hàng trái phép.
-- ----------------------------------------------------------------------------
SELECT
  'd_legacy_013_trigger_and_fn' AS check_group,
  'trigger' AS object_kind,
  c.relname AS table_name,
  t.tgname AS object_name,
  (t.tgenabled <> 'D') AS is_active,
  p.prosecdef AS security_definer,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND (
    t.tgname = 'trigger_auto_create_store_on_approval'
    OR p.proname = 'handle_partner_approval'
  )
UNION ALL
SELECT
  'd_legacy_013_trigger_and_fn' AS check_group,
  'function' AS object_kind,
  NULL AS table_name,
  p.proname AS object_name,
  true AS is_active,
  p.prosecdef AS security_definer,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'handle_partner_approval';

-- ----------------------------------------------------------------------------
-- (e) Kiểm tra trạng thái áp dụng 038, 039, 040 và bảng sao lưu withdrawals_backup_035
--     - 038: anon/authenticated KHÔNG còn quyền INSERT/UPDATE/DELETE trên orders, order_items;
--            trigger protect_charity_approval_status đang bật trên charity_profiles.
--     - 039: các bảng live_locations, location_consents, auth_otp_attempts tồn tại & bật RLS;
--            chỉ mục volunteers_email_lower_idx tồn tại.
--     - withdrawals_backup_035: nếu tồn tại mà relrowsecurity = false (tạo bằng CREATE TABLE AS)
--            thì có nguy cơ lộ lịch sử rút tiền qua PostgREST — cần bật RLS hoặc xóa sau khi đối soát.
-- ----------------------------------------------------------------------------
SELECT
  'e_migrations_038_039_and_backup' AS check_group,
  item.name AS object_name,
  item.category,
  item.exists_in_db,
  item.rls_enabled,
  item.anon_can_select,
  item.anon_can_write,
  item.authenticated_can_write,
  item.note
FROM (
  SELECT
    tbl.table_name AS name,
    'table_rls_and_grants' AS category,
    (c.oid IS NOT NULL) AS exists_in_db,
    c.relrowsecurity AS rls_enabled,
    CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('anon', c.oid, 'SELECT') ELSE NULL END AS anon_can_select,
    CASE WHEN c.oid IS NOT NULL THEN (
      has_table_privilege('anon', c.oid, 'INSERT')
      OR has_table_privilege('anon', c.oid, 'UPDATE')
      OR has_table_privilege('anon', c.oid, 'DELETE')
    ) ELSE NULL END AS anon_can_write,
    CASE WHEN c.oid IS NOT NULL THEN (
      has_table_privilege('authenticated', c.oid, 'INSERT')
      OR has_table_privilege('authenticated', c.oid, 'UPDATE')
      OR has_table_privilege('authenticated', c.oid, 'DELETE')
    ) ELSE NULL END AS authenticated_can_write,
    tbl.expected_note AS note
  FROM (
    VALUES
      ('orders', '038: anon_can_write=false & authenticated_can_write=false'),
      ('order_items', '038: anon_can_write=false & authenticated_can_write=false'),
      ('charity_profiles', '040: anon_can_select=false; authenticated giữ quyền có kiểm soát qua RLS + trigger 038'),
      ('live_locations', '039: exists=true, rls_enabled=true, không có policy client'),
      ('location_consents', '039: exists=true, rls_enabled=true, không có policy client'),
      ('auth_otp_attempts', '039: exists=true, rls_enabled=true, không có policy client'),
      ('withdrawals_backup_035', '035 backup: nếu exists=true mà rls_enabled=false => CẦN BẬT RLS HOẶC XÓA NGAY')
  ) AS tbl(table_name, expected_note)
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = tbl.table_name
) AS item;

-- ----------------------------------------------------------------------------
-- BẢNG TỔNG HỢP G-1 (Hiển thị ở tab kết quả cuối khi bấm Run toàn bộ file)
-- ----------------------------------------------------------------------------
WITH checks AS (
  SELECT
    1 AS seq,
    '(a) Trigger protect_profile_privileged_columns (INSERT + UPDATE)' AS check_item,
    CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'profiles'
          AND t.tgname = 'protect_profile_privileged_columns'
          AND t.tgenabled <> 'D' AND NOT t.tgisinternal
      ) THEN 'CHƯA CÓ (CẦN CHẠY 014 + 039)'
      WHEN EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'profiles'
          AND t.tgname = 'protect_profile_privileged_columns'
          AND t.tgenabled <> 'D' AND NOT t.tgisinternal
          AND (t.tgtype & 4) <> 0 AND (t.tgtype & 16) <> 0
      ) THEN 'ĐẠT (ĐÃ BẢO VỆ INSERT + UPDATE)'
      ELSE 'CẦN VÁ P0-2 (MỚI CHẶN UPDATE, CHƯA CHẶN INSERT — CHẠY 039)'
    END AS status_summary

  UNION ALL
  SELECT
    2,
    '(b) Hàm handle_new_user() không cấp admin & không ghi đè role',
    CASE
      WHEN to_regprocedure('public.handle_new_user()') IS NULL THEN 'THIẾU HÀM handle_new_user()'
      WHEN pg_get_functiondef(to_regprocedure('public.handle_new_user()')) ~* '''customer''\s*,\s*''partner''\s*,\s*''charity''\s*,\s*''admin'''
        THEN 'NGUY HIỂM KHẨN CẤP (CÒN CHO ĐĂNG KÝ ADMIN QUA METADATA!)'
      WHEN pg_get_functiondef(to_regprocedure('public.handle_new_user()')) ~* 'on\s+conflict\s*\(\s*id\s*\)\s*do\s+update[\s\S]*\brole\s*=\s*excluded\.role'
        OR pg_get_functiondef(to_regprocedure('public.handle_new_user()')) ILIKE '%md5(random()%'
        THEN 'ĐÃ CHẶN ADMIN (014), CẦN CHẠY 039 ĐỂ GỘP CỘT 008 + TNV + SLUG XÁC ĐỊNH + BỎ GHI ĐÈ ROLE'
      ELSE 'ĐẠT (BẢN 039 ĐẦY ĐỦ)'
    END

  UNION ALL
  SELECT
    3,
    '(c1) Các policy nguy hiểm cũ (Allow public update / admin_view_partner*)',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND policyname IN ('Allow public update for testing', 'admin_view_partner_profiles', 'admin_view_partners')
      ) THEN 'NGUY HIỂM (CÒN POLICY MỞ RỘNG CŨ — CẦN GỠ NGAY)'
      ELSE 'ĐẠT (ĐÃ GỠ)'
    END

  UNION ALL
  SELECT
    4,
    '(c2) Chống lộ CCCD trên charity_profiles (P0-3)',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'charity_profiles'
          AND policyname = 'charity_profiles_public_select_active'
      ) OR (
        to_regclass('public.charity_profiles') IS NOT NULL
        AND has_table_privilege('anon', 'public.charity_profiles', 'SELECT')
      ) THEN 'CẦN VÁ P0-3 (charity_profiles VẪN ĐỌC ĐƯỢC CÔNG KHAI — CHẠY 040)'
      ELSE 'ĐẠT (ĐÃ KHÓA charity_profiles & DÙNG VIEW charity_profiles_public)'
    END

  UNION ALL
  SELECT
    5,
    '(d) Trigger cũ trigger_auto_create_store_on_approval (013)',
    CASE
      WHEN EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND NOT t.tgisinternal
          AND t.tgname = 'trigger_auto_create_store_on_approval'
      ) THEN 'CẦN GỠ (CÒN TRIGGER 013 TRÊN partner_profiles — CHẠY 040)'
      ELSE 'ĐẠT (KHÔNG TỒN TẠI TRIGGER 013)'
    END

  UNION ALL
  SELECT
    6,
    '(e1) Migration 038 (khóa ghi trực tiếp orders/order_items + protect_charity_approval_status)',
    CASE
      WHEN to_regclass('public.orders') IS NULL OR to_regclass('public.charity_profiles') IS NULL THEN 'THIẾU BẢNG GỐC'
      WHEN NOT has_table_privilege('anon', 'public.orders', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.orders', 'INSERT')
       AND NOT has_table_privilege('authenticated', 'public.orders', 'UPDATE')
       AND NOT has_table_privilege('authenticated', 'public.order_items', 'INSERT')
       AND EXISTS (
         SELECT 1 FROM pg_trigger t
         WHERE t.tgrelid = to_regclass('public.charity_profiles')
           AND t.tgname = 'protect_charity_approval_status'
           AND t.tgenabled <> 'D' AND NOT t.tgisinternal
       ) THEN 'ĐẠT (038 ĐÃ ÁP DỤNG)'
      ELSE 'CHƯA ÁP DỤNG ĐẦY ĐỦ 038 (CẦN CHẠY 038 TRƯỚC 040)'
    END

  UNION ALL
  SELECT
    7,
    '(e2) Migration 039 (live_locations, location_consents, auth_otp_attempts, volunteers_email_lower_idx)',
    CASE
      WHEN to_regclass('public.live_locations') IS NOT NULL
       AND to_regclass('public.location_consents') IS NOT NULL
       AND to_regclass('public.auth_otp_attempts') IS NOT NULL
       AND to_regclass('public.volunteers_email_lower_idx') IS NOT NULL
      THEN 'ĐẠT (039 ĐÃ ÁP DỤNG ĐẦY ĐỦ)'
      WHEN to_regclass('public.live_locations') IS NOT NULL
      THEN 'ĐÃ CÓ BẢNG 039 NHƯNG CHƯA CÓ BẢN VÁ MỚI (THIẾU INDEX / TRIGGER P0-2)'
      ELSE 'CHƯA ÁP DỤNG 039'
    END

  UNION ALL
  SELECT
    8,
    '(e3) Bảng sao lưu public.withdrawals_backup_035',
    CASE
      WHEN to_regclass('public.withdrawals_backup_035') IS NULL THEN 'ĐẠT (KHÔNG TỒN TẠI BẢNG SAO LƯU TẠM)'
      WHEN EXISTS (
        SELECT 1 FROM pg_class
        WHERE oid = to_regclass('public.withdrawals_backup_035')
          AND relrowsecurity = true
      ) THEN 'TỒN TẠI (ĐÃ BẬT RLS)'
      ELSE 'CẢNH BÁO: TỒN TẠI NHƯNG CHƯA BẬT RLS — CHẠY ALTER TABLE public.withdrawals_backup_035 ENABLE ROW LEVEL SECURITY; REVOKE ALL ON public.withdrawals_backup_035 FROM anon, authenticated;'
    END
)
SELECT seq, check_item, status_summary
FROM checks
ORDER BY seq;
