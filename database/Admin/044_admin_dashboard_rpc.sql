-- ============================================================================
-- 044_admin_dashboard_rpc.sql (Wave 5B — Admin Portal Đợt 4: RPC tổng quan bảng điều khiển)
-- Chạy SAU các migration 001 -> 043 (bắt buộc 001, 008, 010, 019, 028, 029, 031, 043).
-- Chạy lại nhiều lần an toàn (idempotent 100%). KHÔNG xóa / KHÔNG sửa dữ liệu hiện có.
-- KHÔNG động vào hàm public.handle_new_user().
--
-- Làm gì:
--   1. Tạo hàm public.fs_admin_overview(p_days integer DEFAULT 7) RETURNS jsonb
--      (LANGUAGE plpgsql SECURITY DEFINER SET search_path = public):
--      - Giới hạn v_days := LEAST(GREATEST(COALESCE(p_days, 7), 1), 90).
--      - Nhóm theo ngày giờ Việt Nam ('Asia/Ho_Chi_Minh') từ hôm nay lùi về (v_days - 1) ngày.
--      - Tổng hợp orders (tổng, completed, cancelled, no_show, gmv_cents của đơn completed),
--        donations (tổng, completed), complaints và người dùng mới (profiles).
--   2. Khóa quyền thực thi: REVOKE ALL khỏi PUBLIC, anon, authenticated;
--      chỉ GRANT EXECUTE cho service_role.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ───────── 0. Kiểm tra các bảng nền tảng bắt buộc ─────────
DO $$
BEGIN
  IF to_regclass('public.orders') IS NULL
     OR to_regclass('public.donations') IS NULL
     OR to_regclass('public.complaints') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Cần áp dụng các migration nền tảng (001, 008, 010, 019, 029, 031) trước khi chạy 044_admin_dashboard_rpc.sql'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- ───────── 1. RPC tổng quan bảng điều khiển Admin theo múi giờ Việt Nam ─────────
CREATE OR REPLACE FUNCTION public.fs_admin_overview(p_days integer DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 7), 1), 90);
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_start_date date := v_today - (v_days - 1);
  v_start_ts timestamptz := (v_start_date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_end_ts timestamptz := ((v_today + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_totals jsonb;
  v_series jsonb;
BEGIN
  WITH
  days_series AS (
    SELECT gs::date AS bucket_date
    FROM generate_series(v_start_date, v_today, interval '1 day') AS gs
  ),
  order_agg AS (
    SELECT
      (o.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_date,
      COUNT(*)::bigint AS orders,
      COUNT(*) FILTER (WHERE o.status::text = 'completed')::bigint AS orders_completed,
      COUNT(*) FILTER (WHERE o.status::text = 'cancelled')::bigint AS orders_cancelled,
      COUNT(*) FILTER (WHERE o.status::text = 'no_show')::bigint AS orders_no_show,
      COALESCE(SUM(o.total_cents::bigint) FILTER (WHERE o.status::text = 'completed'), 0)::bigint AS gmv_cents
    FROM public.orders o
    WHERE o.created_at >= v_start_ts
      AND o.created_at < v_end_ts
    GROUP BY 1
  ),
  donation_agg AS (
    SELECT
      (d.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_date,
      COUNT(*)::bigint AS donations,
      COUNT(*) FILTER (WHERE d.status::text = 'completed')::bigint AS donations_completed
    FROM public.donations d
    WHERE d.created_at >= v_start_ts
      AND d.created_at < v_end_ts
    GROUP BY 1
  ),
  complaint_agg AS (
    SELECT
      (c.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_date,
      COUNT(*)::bigint AS complaints
    FROM public.complaints c
    WHERE c.created_at >= v_start_ts
      AND c.created_at < v_end_ts
    GROUP BY 1
  ),
  user_agg AS (
    SELECT
      (p.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS bucket_date,
      COUNT(*)::bigint AS new_users
    FROM public.profiles p
    WHERE p.created_at >= v_start_ts
      AND p.created_at < v_end_ts
    GROUP BY 1
  )
  SELECT
    jsonb_build_object(
      'orders', COALESCE(SUM(COALESCE(oa.orders, 0)), 0)::bigint,
      'orders_completed', COALESCE(SUM(COALESCE(oa.orders_completed, 0)), 0)::bigint,
      'orders_cancelled', COALESCE(SUM(COALESCE(oa.orders_cancelled, 0)), 0)::bigint,
      'orders_no_show', COALESCE(SUM(COALESCE(oa.orders_no_show, 0)), 0)::bigint,
      'gmv_cents', COALESCE(SUM(COALESCE(oa.gmv_cents, 0)), 0)::bigint,
      'donations', COALESCE(SUM(COALESCE(da.donations, 0)), 0)::bigint,
      'donations_completed', COALESCE(SUM(COALESCE(da.donations_completed, 0)), 0)::bigint,
      'complaints', COALESCE(SUM(COALESCE(ca.complaints, 0)), 0)::bigint,
      'new_users', COALESCE(SUM(COALESCE(ua.new_users, 0)), 0)::bigint
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'date', to_char(ds.bucket_date, 'YYYY-MM-DD'),
          'orders', COALESCE(oa.orders, 0),
          'gmv_cents', COALESCE(oa.gmv_cents, 0),
          'donations', COALESCE(da.donations, 0),
          'complaints', COALESCE(ca.complaints, 0),
          'new_users', COALESCE(ua.new_users, 0)
        )
        ORDER BY ds.bucket_date ASC
      ),
      '[]'::jsonb
    )
  INTO v_totals, v_series
  FROM days_series ds
  LEFT JOIN order_agg oa ON oa.bucket_date = ds.bucket_date
  LEFT JOIN donation_agg da ON da.bucket_date = ds.bucket_date
  LEFT JOIN complaint_agg ca ON ca.bucket_date = ds.bucket_date
  LEFT JOIN user_agg ua ON ua.bucket_date = ds.bucket_date;

  RETURN jsonb_build_object(
    'days', v_days,
    'timezone', 'Asia/Ho_Chi_Minh',
    'totals', v_totals,
    'series', v_series
  );
END;
$$;

COMMENT ON FUNCTION public.fs_admin_overview(integer) IS
  'Tổng hợp số liệu vận hành theo ngày giờ Việt Nam (Asia/Ho_Chi_Minh) cho bảng điều khiển Admin Portal; chỉ service_role được gọi.';

-- ───────── 2. Khóa quyền thực thi ─────────
REVOKE ALL ON FUNCTION public.fs_admin_overview(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fs_admin_overview(integer) TO service_role;

COMMIT;

-- ============================================================================
-- Hướng dẫn hoàn tác (Rollback — chỉ chạy khi thật sự cần gỡ RPC 044):
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.fs_admin_overview(integer);
--   COMMIT;
-- ============================================================================
