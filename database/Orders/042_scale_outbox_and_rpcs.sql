-- ============================================================================
-- 042_scale_outbox_and_rpcs.sql (Wave 3A: P2-4 Outbox & Scale RPCs)
-- Chạy SAU các migration 001 -> 041 (bắt buộc đã chạy 036_admin_ops.sql và 039_live_location.sql).
-- Chạy lại nhiều lần an toàn (idempotent 100%). Không xóa / không sửa dữ liệu hiện có.
--
-- Nội dung thực hiện:
--   1. P2-4 — Bảng Outbox public.background_jobs:
--      - Lưu hàng đợi tác vụ nền bền vững (pending | processing | done | failed | dead),
--        hỗ trợ idempotency_key duy nhất và retry có giới hạn max_attempts.
--      - Bật RLS, KHÔNG tạo policy cho client (chỉ service_role truy cập).
--   2. public.fs_claim_background_jobs(p_job_type text DEFAULT NULL, p_limit integer DEFAULT 20):
--      - Nhận việc nguyên tử bằng FOR UPDATE SKIP LOCKED, chuyển status = 'processing',
--        đặt locked_at = now() và tăng attempts = attempts + 1.
--   3. public.fs_report_live_location(...):
--      - Gộp kiểm tra location_consents + throttle + upsert vào public.live_locations
--        trong 1 RPC nguyên tử (khớp đúng tên cột lat/lng/accuracy_m/context_kind/context_id
--        trong 039_live_location.sql; bổ sung cột tùy chọn heading, speed_mps).
--   4. public.fs_purge_old_automation_runs(p_retention_days integer DEFAULT 30, p_batch_limit integer DEFAULT 2000):
--      - Dọn lịch sử public.automation_runs cũ theo từng batch an toàn, không khóa bảng lâu.
--   5. Bảo mật: mọi hàm SECURITY DEFINER đặt SET search_path = public,
--      REVOKE ALL FROM public, anon, authenticated và chỉ GRANT EXECUTE TO service_role.
--
-- Hướng dẫn hoàn tác (chỉ khi thật sự cần quay lui):
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.fs_purge_old_automation_runs(integer, integer);
--   DROP FUNCTION IF EXISTS public.fs_report_live_location(text, uuid, double precision, double precision, real, real, real, integer, text, uuid, timestamptz);
--   DROP FUNCTION IF EXISTS public.fs_claim_background_jobs(text, integer);
--   DROP TABLE IF EXISTS public.background_jobs;
--   ALTER TABLE public.live_locations DROP COLUMN IF EXISTS heading, DROP COLUMN IF EXISTS speed_mps;
--   COMMIT;
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ───────── 0. Kiểm tra điều kiện tiên quyết ─────────
DO $$
BEGIN
  IF to_regclass('public.live_locations') IS NULL
     OR to_regclass('public.location_consents') IS NULL
     OR to_regclass('public.automation_runs') IS NULL THEN
    RAISE EXCEPTION 'Cần áp dụng 036_admin_ops.sql và 039_live_location.sql trước khi chạy 042_scale_outbox_and_rpcs.sql'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- ───────── 1. P2-4: Bảng Outbox public.background_jobs ─────────
CREATE TABLE IF NOT EXISTS public.background_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  last_error text,
  idempotency_key text UNIQUE,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Bật RLS và KHÔNG tạo policy nào để chỉ Backend (service_role) đọc/ghi
ALTER TABLE public.background_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.background_jobs FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.background_jobs TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.set_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS set_background_jobs_updated_at ON public.background_jobs;
    CREATE TRIGGER set_background_jobs_updated_at
      BEFORE UPDATE ON public.background_jobs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$$;

-- ───────── 2. Nhận việc Outbox nguyên tử (FOR UPDATE SKIP LOCKED) ─────────
CREATE OR REPLACE FUNCTION public.fs_claim_background_jobs(
  p_job_type text DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS SETOF public.background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(coalesce(p_limit, 20), 1), 500);
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT bj.id
    FROM public.background_jobs bj
    WHERE bj.status = 'pending'
      AND bj.run_at <= now()
      AND bj.attempts < bj.max_attempts
      AND (p_job_type IS NULL OR bj.job_type = p_job_type)
    ORDER BY bj.run_at ASC, bj.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.background_jobs bj
  SET status = 'processing',
      locked_at = now(),
      attempts = bj.attempts + 1,
      updated_at = now()
  FROM picked
  WHERE bj.id = picked.id
  RETURNING bj.*;
END;
$$;

-- ───────── 3. Báo cáo vị trí trực tuyến nguyên tử (consent + throttle + upsert) ─────────
-- Bổ sung 2 cột tùy chọn heading/speed_mps vào public.live_locations (không phá vỡ schema 039)
ALTER TABLE public.live_locations
  ADD COLUMN IF NOT EXISTS heading real CHECK (heading IS NULL OR (heading >= 0 AND heading <= 360)),
  ADD COLUMN IF NOT EXISTS speed_mps real CHECK (speed_mps IS NULL OR speed_mps >= 0);

-- Lưu ý tương thích 039_live_location.sql:
--   - public.live_locations dùng tên cột lat, lng, accuracy_m, context_kind, context_id, recorded_at, updated_at.
--   - public.location_consents dùng khóa chính (actor_kind, actor_id) và cột boolean granted.
--   - Tham số p_context_kind, p_context_id, p_recorded_at có DEFAULT NULL để giữ nguyên tương thích chữ ký
--     8 tham số đầu; khi đã có dòng trước đó sẽ kế thừa context nếu caller không truyền, còn lần ghi đầu tiên
--     bắt buộc truyền context_kind ('donation'|'order') và context_id.
CREATE OR REPLACE FUNCTION public.fs_report_live_location(
  p_actor_kind text,
  p_actor_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m real DEFAULT NULL,
  p_heading real DEFAULT NULL,
  p_speed_mps real DEFAULT NULL,
  p_min_interval_sec integer DEFAULT 55,
  p_context_kind text DEFAULT NULL,
  p_context_id uuid DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_consent_granted boolean;
  v_has_existing boolean := false;
  v_existing_context_kind text;
  v_existing_context_id uuid;
  v_existing_updated_at timestamptz;
  v_context_kind text;
  v_context_id uuid;
  v_min_interval integer := GREATEST(0, coalesce(p_min_interval_sec, 55));
  v_recorded_at timestamptz;
  v_updated_at timestamptz;
BEGIN
  IF p_actor_kind NOT IN ('volunteer', 'customer') OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'invalid_actor' USING ERRCODE = '22023';
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL
     OR p_latitude < -90 OR p_latitude > 90
     OR p_longitude < -180 OR p_longitude > 180
     OR (p_latitude = 0 AND p_longitude = 0) THEN
    RAISE EXCEPTION 'invalid_coordinates' USING ERRCODE = '22023';
  END IF;

  IF p_accuracy_m IS NOT NULL AND (p_accuracy_m < 0 OR p_accuracy_m > 2000) THEN
    RAISE EXCEPTION 'invalid_accuracy' USING ERRCODE = '22023';
  END IF;

  IF p_heading IS NOT NULL AND (p_heading < 0 OR p_heading > 360) THEN
    RAISE EXCEPTION 'invalid_heading' USING ERRCODE = '22023';
  END IF;

  IF p_speed_mps IS NOT NULL AND p_speed_mps < 0 THEN
    RAISE EXCEPTION 'invalid_speed' USING ERRCODE = '22023';
  END IF;

  -- Tuần tự hóa các lần báo vị trí đồng thời của cùng một người (kể cả lần ghi đầu tiên)
  PERFORM pg_advisory_xact_lock(hashtext('live_location:' || p_actor_kind || ':' || p_actor_id::text));

  SELECT granted
  INTO v_consent_granted
  FROM public.location_consents
  WHERE actor_kind = p_actor_kind
    AND actor_id = p_actor_id
  FOR SHARE;

  IF NOT FOUND THEN
    DELETE FROM public.live_locations
    WHERE actor_kind = p_actor_kind
      AND actor_id = p_actor_id;

    RETURN jsonb_build_object(
      'stored', false,
      'throttled', false,
      'reason', 'consent_required'
    );
  END IF;

  IF v_consent_granted IS NOT TRUE THEN
    DELETE FROM public.live_locations
    WHERE actor_kind = p_actor_kind
      AND actor_id = p_actor_id;

    RETURN jsonb_build_object(
      'stored', false,
      'throttled', false,
      'reason', 'consent_revoked'
    );
  END IF;

  SELECT context_kind, context_id, updated_at
  INTO v_existing_context_kind, v_existing_context_id, v_existing_updated_at
  FROM public.live_locations
  WHERE actor_kind = p_actor_kind
    AND actor_id = p_actor_id
  FOR UPDATE;

  v_has_existing := FOUND;
  v_context_kind := coalesce(p_context_kind, v_existing_context_kind);
  v_context_id := coalesce(p_context_id, v_existing_context_id);

  IF v_context_kind IS NULL OR v_context_kind NOT IN ('donation', 'order') OR v_context_id IS NULL THEN
    RAISE EXCEPTION 'context_required' USING ERRCODE = '22023';
  END IF;

  IF v_has_existing
     AND v_existing_context_kind = v_context_kind
     AND v_existing_context_id = v_context_id
     AND extract(epoch FROM (now() - v_existing_updated_at)) < v_min_interval THEN
    RETURN jsonb_build_object(
      'stored', false,
      'throttled', true,
      'reason', 'throttled',
      'updated_at', v_existing_updated_at
    );
  END IF;

  -- Kẹp giờ thiết bị sai lệch (tương lai hoặc quá 10 phút) về giờ máy chủ, khớp locationService.ts
  v_recorded_at := CASE
    WHEN p_recorded_at IS NULL
         OR p_recorded_at > now()
         OR p_recorded_at < now() - interval '10 minutes'
      THEN now()
    ELSE p_recorded_at
  END;

  INSERT INTO public.live_locations (
    actor_kind,
    actor_id,
    context_kind,
    context_id,
    lat,
    lng,
    accuracy_m,
    heading,
    speed_mps,
    recorded_at,
    updated_at
  )
  VALUES (
    p_actor_kind,
    p_actor_id,
    v_context_kind,
    v_context_id,
    p_latitude,
    p_longitude,
    p_accuracy_m,
    p_heading,
    p_speed_mps,
    v_recorded_at,
    now()
  )
  ON CONFLICT (actor_kind, actor_id) DO UPDATE
  SET context_kind = EXCLUDED.context_kind,
      context_id = EXCLUDED.context_id,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      accuracy_m = EXCLUDED.accuracy_m,
      heading = EXCLUDED.heading,
      speed_mps = EXCLUDED.speed_mps,
      recorded_at = EXCLUDED.recorded_at,
      updated_at = now()
  RETURNING updated_at INTO v_updated_at;

  RETURN jsonb_build_object(
    'stored', true,
    'throttled', false,
    'reason', 'ok',
    'updated_at', v_updated_at
  );
END;
$$;

-- ───────── 4. Dọn lịch sử automation_runs cũ theo từng batch an toàn ─────────
CREATE OR REPLACE FUNCTION public.fs_purge_old_automation_runs(
  p_retention_days integer DEFAULT 30,
  p_batch_limit integer DEFAULT 2000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := GREATEST(coalesce(p_retention_days, 30), 1);
  v_limit integer := LEAST(GREATEST(coalesce(p_batch_limit, 2000), 1), 10000);
  v_deleted integer := 0;
BEGIN
  WITH doomed AS (
    SELECT id
    FROM public.automation_runs
    WHERE started_at < now() - make_interval(days => v_days)
    ORDER BY started_at ASC
    LIMIT v_limit
  )
  DELETE FROM public.automation_runs ar
  USING doomed
  WHERE ar.id = doomed.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ───────── 5. Phân quyền thực thi RPC (chỉ service_role) ─────────
REVOKE ALL ON FUNCTION public.fs_claim_background_jobs(text, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_report_live_location(text, uuid, double precision, double precision, real, real, real, integer, text, uuid, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_purge_old_automation_runs(integer, integer) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fs_claim_background_jobs(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_report_live_location(text, uuid, double precision, double precision, real, real, real, integer, text, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_purge_old_automation_runs(integer, integer) TO service_role;

COMMIT;
