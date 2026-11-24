-- ============================================================================
-- 041_atomic_order_ledger_rpcs.sql (Wave 3A: P2-2, G-7, DB-10)
-- Chạy SAU các migration 001 -> 040 (bắt buộc đã chạy 001, 002, 016, 028, 029, 030, 031, 035).
-- Chạy lại nhiều lần an toàn (idempotent 100%). Không xóa / không sửa dữ liệu hiện có.
--
-- Nội dung thực hiện:
--   1. P2-2a — Tồn kho & Voucher nguyên tử:
--      - public.fs_reserve_order_stock(p_items jsonb, p_voucher_id uuid DEFAULT NULL)
--      - public.fs_restore_order_stock_atomic(p_order_id uuid, p_restore_voucher boolean DEFAULT false)
--   2. P2-2b — Sổ cái 1 transaction (tương thích 100% khóa idempotency của 030_wallet_ledger.sql):
--      - public.fs_settle_order(p_order_id, p_store_id, p_store_cents, p_fee_cents, p_donation_cents, p_reason)
--      - public.fs_refund_order(p_order_id, p_store_id, p_refund_cents, p_from_released, p_fee_cents, p_donation_cents, p_reason)
--   3. P2-2c — Khiếu nại:
--      - Thêm cột public.complaints.outcome_applied_at (timestamptz) để đánh dấu hệ quả đã áp xong.
--   4. P2-2d / BE-DOMAIN-17 — Từ thiện & điểm uy tín khách hàng nguyên tử:
--      - public.fs_adjust_product_stock(p_product_id uuid, p_delta integer)
--      - public.fs_increment_volunteer_stats(p_volunteer_id uuid, p_runs_delta integer, p_kg_delta numeric)
--      - public.fs_apply_customer_points(p_user_id uuid, p_delta integer, p_min integer DEFAULT 0, p_max integer DEFAULT 100)
--   5. G-7 — Uy tín cửa hàng nguyên tử qua Supabase RPC (không cần TCP pg.Pool):
--      - public.fs_seller_reputation_apply_delta(p_store_id, p_delta, p_violation_type, p_reason, p_order_id)
--      (Khớp đúng enum public.seller_reputation_status: 'Active' | 'Restricted' | 'Banned' và ràng buộc
--       seller_reputation_restricted_until_valid trong 002_seller_reputation_realtime.sql.)
--   6. DB-10 — Ghi chú đơn vị tiền VND nguyên cho toàn bộ cột *_cents trên 7 bảng cốt lõi.
--   7. Bảo mật: mọi hàm SECURITY DEFINER đều đặt SET search_path = public,
--      REVOKE ALL FROM public, anon, authenticated và chỉ GRANT EXECUTE TO service_role.
--
-- Hướng dẫn hoàn tác (chỉ khi thật sự cần quay lui):
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.fs_seller_reputation_apply_delta(uuid, integer, text, text, uuid);
--   DROP FUNCTION IF EXISTS public.fs_apply_customer_points(uuid, integer, integer, integer);
--   DROP FUNCTION IF EXISTS public.fs_increment_volunteer_stats(uuid, integer, numeric);
--   DROP FUNCTION IF EXISTS public.fs_adjust_product_stock(uuid, integer);
--   DROP FUNCTION IF EXISTS public.fs_refund_order(uuid, uuid, bigint, boolean, bigint, bigint, text);
--   DROP FUNCTION IF EXISTS public.fs_settle_order(uuid, uuid, bigint, bigint, bigint, text);
--   DROP FUNCTION IF EXISTS public.fs_restore_order_stock_atomic(uuid, boolean);
--   DROP FUNCTION IF EXISTS public.fs_reserve_order_stock(jsonb, uuid);
--   -- Lưu ý: chỉ xóa cột outcome_applied_at nếu đã xóa chỉ mục complaints_pending_outcome_idx ở 042b:
--   -- ALTER TABLE public.complaints DROP COLUMN IF EXISTS outcome_applied_at;
--   COMMIT;
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ───────── 0. Kiểm tra điều kiện tiên quyết ─────────
DO $$
BEGIN
  IF to_regclass('public.products') IS NULL
     OR to_regclass('public.vouchers') IS NULL
     OR to_regclass('public.orders') IS NULL
     OR to_regclass('public.order_items') IS NULL
     OR to_regclass('public.complaints') IS NULL
     OR to_regclass('public.volunteers') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.wallets') IS NULL
     OR to_regclass('public.ledger_entries') IS NULL
     OR to_regclass('public.withdrawals') IS NULL
     OR to_regclass('public.seller_reputation') IS NULL
     OR to_regclass('public.seller_violations') IS NULL
     OR to_regprocedure('public.fs_post_ledger(text,uuid,text,uuid,uuid,bigint,jsonb)') IS NULL
     OR to_regprocedure('public.fs_store_wallet(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Cần áp dụng các migration nền tảng (001, 002, 029, 030, 031) trước khi chạy 041_atomic_order_ledger_rpcs.sql'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- ───────── 1. P2-2c: Đánh dấu hoàn tất hệ quả khiếu nại ─────────
ALTER TABLE public.complaints
  ADD COLUMN IF NOT EXISTS outcome_applied_at timestamptz;

COMMENT ON COLUMN public.complaints.outcome_applied_at IS
  'Thời điểm hệ quả khiếu nại (hoàn tiền sổ cái, phạt điểm uy tín) đã được áp dụng thành công; NULL = chưa áp xong.';

-- ───────── 2. P2-2a: Giữ tồn kho & áp voucher nguyên tử khi tạo đơn ─────────
-- p_items: mảng JSON [{"product_id": "<uuid>", "quantity": <int>}, ...] (cũng chấp nhận khóa "id"/"qty").
-- Khóa các dòng public.products theo ORDER BY id FOR UPDATE để loại bỏ deadlock khi nhiều đơn mua cùng lúc.
CREATE OR REPLACE FUNCTION public.fs_reserve_order_stock(
  p_items jsonb,
  p_voucher_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_ids uuid[];
  v_item record;
  v_prod record;
  v_voucher record;
  v_reserved_count integer := 0;
  v_reserved_items jsonb := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;

  -- Kiểm tra từng phần tử đầu vào trước khi khóa bảng
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS elem
    WHERE nullif(coalesce(elem ->> 'product_id', elem ->> 'id'), '') IS NULL
       OR nullif(coalesce(elem ->> 'quantity', elem ->> 'qty'), '') IS NULL
       OR (coalesce(elem ->> 'quantity', elem ->> 'qty'))::integer <= 0
  ) THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT (coalesce(elem ->> 'product_id', elem ->> 'id'))::uuid ORDER BY (coalesce(elem ->> 'product_id', elem ->> 'id'))::uuid)
  INTO v_product_ids
  FROM jsonb_array_elements(p_items) AS elem;

  IF v_product_ids IS NULL OR cardinality(v_product_ids) = 0 THEN
    RAISE EXCEPTION 'invalid_items' USING ERRCODE = '22023';
  END IF;

  -- Khóa tất cả sản phẩm theo thứ tự tăng dần id để không bao giờ xảy ra deadlock
  PERFORM 1
  FROM public.products
  WHERE id = ANY(v_product_ids)
  ORDER BY id
  FOR UPDATE;

  -- Gộp số lượng theo product_id và kiểm tra tồn kho / trạng thái hoạt động
  FOR v_item IN
    SELECT
      (coalesce(elem ->> 'product_id', elem ->> 'id'))::uuid AS product_id,
      SUM((coalesce(elem ->> 'quantity', elem ->> 'qty'))::integer)::integer AS qty
    FROM jsonb_array_elements(p_items) AS elem
    GROUP BY 1
    ORDER BY 1
  LOOP
    SELECT id, is_active, stock_quantity, sold_count
    INTO v_prod
    FROM public.products
    WHERE id = v_item.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found:%', v_item.product_id USING ERRCODE = 'P0002';
    END IF;

    IF v_prod.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'product_inactive:%', v_item.product_id USING ERRCODE = 'P0001';
    END IF;

    IF v_prod.stock_quantity < v_item.qty THEN
      RAISE EXCEPTION 'insufficient_stock:%', v_item.product_id USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.products
    SET stock_quantity = stock_quantity - v_item.qty,
        sold_count = sold_count + v_item.qty,
        updated_at = now()
    WHERE id = v_item.product_id;

    v_reserved_count := v_reserved_count + 1;
    v_reserved_items := v_reserved_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_item.product_id,
        'quantity', v_item.qty,
        'remaining_stock', v_prod.stock_quantity - v_item.qty
      )
    );
  END LOOP;

  -- Giữ lượt dùng voucher nguyên tử (nếu có)
  IF p_voucher_id IS NOT NULL THEN
    SELECT id, is_active, starts_at, expires_at, max_redemptions, redemption_count
    INTO v_voucher
    FROM public.vouchers
    WHERE id = p_voucher_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'voucher_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_voucher.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'voucher_inactive' USING ERRCODE = 'P0001';
    END IF;

    IF v_voucher.starts_at > now() OR v_voucher.expires_at < now() THEN
      RAISE EXCEPTION 'voucher_expired' USING ERRCODE = 'P0001';
    END IF;

    IF v_voucher.max_redemptions IS NOT NULL AND v_voucher.redemption_count >= v_voucher.max_redemptions THEN
      RAISE EXCEPTION 'voucher_exhausted' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.vouchers
    SET redemption_count = redemption_count + 1,
        updated_at = now()
    WHERE id = p_voucher_id;
  END IF;

  RETURN jsonb_build_object(
    'reserved_count', v_reserved_count,
    'voucher_redeemed', p_voucher_id IS NOT NULL,
    'items', v_reserved_items
  );
END;
$$;

-- Hoàn trả tồn kho nguyên tử (idempotent nhờ orders.stock_restored_at)
CREATE OR REPLACE FUNCTION public.fs_restore_order_stock_atomic(
  p_order_id uuid,
  p_restore_voucher boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_item record;
  v_restored_items integer := 0;
  v_voucher_restored boolean := false;
BEGIN
  SELECT id, voucher_code, stock_restored_at
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.stock_restored_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'already_restored', true,
      'restored_items', 0,
      'voucher_restored', false
    );
  END IF;

  UPDATE public.orders
  SET stock_restored_at = now(),
      updated_at = now()
  WHERE id = p_order_id;

  -- Khóa các dòng order_items theo thứ tự product_id và khóa bảng products theo thứ tự id
  PERFORM 1
  FROM public.order_items
  WHERE order_id = p_order_id
  ORDER BY product_id
  FOR UPDATE;

  PERFORM 1
  FROM public.products
  WHERE id IN (
    SELECT DISTINCT oi.product_id
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  )
  ORDER BY id
  FOR UPDATE;

  FOR v_item IN
    SELECT product_id, SUM(quantity)::integer AS qty
    FROM public.order_items
    WHERE order_id = p_order_id
    GROUP BY product_id
    ORDER BY product_id
  LOOP
    UPDATE public.products
    SET stock_quantity = stock_quantity + v_item.qty,
        sold_count = GREATEST(0, sold_count - v_item.qty),
        updated_at = now()
    WHERE id = v_item.product_id;

    IF FOUND THEN
      v_restored_items := v_restored_items + 1;
    END IF;
  END LOOP;

  IF p_restore_voucher IS TRUE AND v_order.voucher_code IS NOT NULL THEN
    PERFORM 1
    FROM public.vouchers
    WHERE code = v_order.voucher_code
    FOR UPDATE;

    UPDATE public.vouchers
    SET redemption_count = GREATEST(0, redemption_count - 1),
        updated_at = now()
    WHERE code = v_order.voucher_code;

    v_voucher_restored := FOUND;
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'already_restored', false,
    'restored_items', v_restored_items,
    'voucher_restored', v_voucher_restored
  );
END;
$$;

-- ───────── 3. P2-2b: Giải ngân & Hoàn tiền sổ cái trong 1 transaction ─────────
-- Tương thích ngược 100% với khóa idempotency trong 030_wallet_ledger.sql & ledgerService.ts:
--   order:<id>:release:store | order:<id>:release:fee | order:<id>:release:donation
CREATE OR REPLACE FUNCTION public.fs_settle_order(
  p_order_id uuid,
  p_store_id uuid,
  p_store_cents bigint,
  p_fee_cents bigint,
  p_donation_cents bigint,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escrow uuid;
  v_store_wallet uuid;
  v_platform_wallet uuid;
  v_charity_wallet uuid;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'completed');
  v_store_amount bigint := coalesce(p_store_cents, 0);
  v_fee_amount bigint := coalesce(p_fee_cents, 0);
  v_donation_amount bigint := coalesce(p_donation_cents, 0);
  v_entry_store public.ledger_entries;
  v_entry_fee public.ledger_entries;
  v_entry_donation public.ledger_entries;
BEGIN
  IF p_order_id IS NULL OR p_store_id IS NULL THEN
    RAISE EXCEPTION 'invalid_order_or_store' USING ERRCODE = '22023';
  END IF;

  IF v_store_amount < 0 OR v_fee_amount < 0 OR v_donation_amount < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_escrow FROM public.wallets WHERE owner_type = 'escrow' AND store_id IS NULL;
  SELECT id INTO v_platform_wallet FROM public.wallets WHERE owner_type = 'platform_revenue' AND store_id IS NULL;
  SELECT id INTO v_charity_wallet FROM public.wallets WHERE owner_type = 'charity_pool' AND store_id IS NULL;

  IF v_escrow IS NULL OR v_platform_wallet IS NULL OR v_charity_wallet IS NULL THEN
    RAISE EXCEPTION 'system_wallets_missing' USING ERRCODE = '55000';
  END IF;

  v_store_wallet := public.fs_store_wallet(p_store_id);

  -- Khóa toàn bộ ví liên quan theo thứ tự id trước khi hạch toán 3 chân bút toán
  PERFORM 1
  FROM public.wallets
  WHERE id IN (v_escrow, v_store_wallet, v_platform_wallet, v_charity_wallet)
  ORDER BY id
  FOR UPDATE;

  IF v_store_amount > 0 THEN
    v_entry_store := public.fs_post_ledger(
      'order:' || p_order_id::text || ':release:store',
      p_order_id,
      'release',
      v_escrow,
      v_store_wallet,
      v_store_amount,
      jsonb_build_object('reason', v_reason, 'part', 'store')
    );
  END IF;

  IF v_fee_amount > 0 THEN
    v_entry_fee := public.fs_post_ledger(
      'order:' || p_order_id::text || ':release:fee',
      p_order_id,
      'release',
      v_escrow,
      v_platform_wallet,
      v_fee_amount,
      jsonb_build_object('reason', v_reason, 'part', 'fee')
    );
  END IF;

  IF v_donation_amount > 0 THEN
    v_entry_donation := public.fs_post_ledger(
      'order:' || p_order_id::text || ':release:donation',
      p_order_id,
      'release',
      v_escrow,
      v_charity_wallet,
      v_donation_amount,
      jsonb_build_object('reason', v_reason, 'part', 'donation')
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'reason', v_reason,
    'store_entry_id', v_entry_store.id,
    'fee_entry_id', v_entry_fee.id,
    'donation_entry_id', v_entry_donation.id,
    'total_released_cents', v_store_amount + v_fee_amount + v_donation_amount
  );
END;
$$;

-- Hoàn tiền nguyên tử trong 1 transaction:
--   - p_from_released = false: hoàn trực tiếp từ escrow -> external (khóa order:<id>:refund).
--   - p_from_released = true : clawback từ ví cửa hàng / doanh thu nền tảng / quỹ từ thiện -> external
--     với phần cửa hàng = p_refund_cents - p_fee_cents - p_donation_cents
--     (khóa order:<id>:clawback:store | :clawback:fee | :clawback:donation).
CREATE OR REPLACE FUNCTION public.fs_refund_order(
  p_order_id uuid,
  p_store_id uuid,
  p_refund_cents bigint,
  p_from_released boolean,
  p_fee_cents bigint DEFAULT 0,
  p_donation_cents bigint DEFAULT 0,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_external uuid;
  v_escrow uuid;
  v_store_wallet uuid;
  v_platform_wallet uuid;
  v_charity_wallet uuid;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'refund');
  v_total_refund bigint := coalesce(p_refund_cents, 0);
  v_fee_amount bigint := coalesce(p_fee_cents, 0);
  v_donation_amount bigint := coalesce(p_donation_cents, 0);
  v_store_amount bigint := 0;
  v_entry_refund public.ledger_entries;
  v_entry_store public.ledger_entries;
  v_entry_fee public.ledger_entries;
  v_entry_donation public.ledger_entries;
BEGIN
  IF p_order_id IS NULL OR p_store_id IS NULL THEN
    RAISE EXCEPTION 'invalid_order_or_store' USING ERRCODE = '22023';
  END IF;

  IF v_total_refund < 0 OR v_fee_amount < 0 OR v_donation_amount < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_external FROM public.wallets WHERE owner_type = 'external' AND store_id IS NULL;
  IF v_external IS NULL THEN
    RAISE EXCEPTION 'system_wallets_missing' USING ERRCODE = '55000';
  END IF;

  IF NOT coalesce(p_from_released, false) THEN
    SELECT id INTO v_escrow FROM public.wallets WHERE owner_type = 'escrow' AND store_id IS NULL;
    IF v_escrow IS NULL THEN
      RAISE EXCEPTION 'system_wallets_missing' USING ERRCODE = '55000';
    END IF;

    PERFORM 1
    FROM public.wallets
    WHERE id IN (v_escrow, v_external)
    ORDER BY id
    FOR UPDATE;

    IF v_total_refund > 0 THEN
      v_entry_refund := public.fs_post_ledger(
        'order:' || p_order_id::text || ':refund',
        p_order_id,
        'refund',
        v_escrow,
        v_external,
        v_total_refund,
        jsonb_build_object('reason', v_reason)
      );
    END IF;

    RETURN jsonb_build_object(
      'order_id', p_order_id,
      'mode', 'refund',
      'reason', v_reason,
      'refund_entry_id', v_entry_refund.id,
      'total_refunded_cents', v_total_refund
    );
  END IF;

  -- Nhánh clawback sau khi đơn đã giải ngân
  IF v_fee_amount + v_donation_amount > v_total_refund THEN
    RAISE EXCEPTION 'invalid_refund_split' USING ERRCODE = '22023';
  END IF;

  v_store_amount := v_total_refund - v_fee_amount - v_donation_amount;

  SELECT id INTO v_platform_wallet FROM public.wallets WHERE owner_type = 'platform_revenue' AND store_id IS NULL;
  SELECT id INTO v_charity_wallet FROM public.wallets WHERE owner_type = 'charity_pool' AND store_id IS NULL;
  IF v_platform_wallet IS NULL OR v_charity_wallet IS NULL THEN
    RAISE EXCEPTION 'system_wallets_missing' USING ERRCODE = '55000';
  END IF;

  v_store_wallet := public.fs_store_wallet(p_store_id);

  PERFORM 1
  FROM public.wallets
  WHERE id IN (v_store_wallet, v_platform_wallet, v_charity_wallet, v_external)
  ORDER BY id
  FOR UPDATE;

  IF v_store_amount > 0 THEN
    v_entry_store := public.fs_post_ledger(
      'order:' || p_order_id::text || ':clawback:store',
      p_order_id,
      'refund_clawback',
      v_store_wallet,
      v_external,
      v_store_amount,
      jsonb_build_object('reason', v_reason, 'part', 'store')
    );
  END IF;

  IF v_fee_amount > 0 THEN
    v_entry_fee := public.fs_post_ledger(
      'order:' || p_order_id::text || ':clawback:fee',
      p_order_id,
      'refund_clawback',
      v_platform_wallet,
      v_external,
      v_fee_amount,
      jsonb_build_object('reason', v_reason, 'part', 'fee')
    );
  END IF;

  IF v_donation_amount > 0 THEN
    v_entry_donation := public.fs_post_ledger(
      'order:' || p_order_id::text || ':clawback:donation',
      p_order_id,
      'refund_clawback',
      v_charity_wallet,
      v_external,
      v_donation_amount,
      jsonb_build_object('reason', v_reason, 'part', 'donation')
    );
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'mode', 'refund_clawback',
    'reason', v_reason,
    'store_entry_id', v_entry_store.id,
    'fee_entry_id', v_entry_fee.id,
    'donation_entry_id', v_entry_donation.id,
    'store_cents', v_store_amount,
    'fee_cents', v_fee_amount,
    'donation_cents', v_donation_amount,
    'total_refunded_cents', v_total_refund
  );
END;
$$;

-- ───────── 4. P2-2d & BE-DOMAIN-17: Từ thiện & điểm uy tín khách hàng nguyên tử ─────────
CREATE OR REPLACE FUNCTION public.fs_adjust_product_stock(
  p_product_id uuid,
  p_delta integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current integer;
  v_next integer;
BEGIN
  IF p_delta IS NULL THEN
    RAISE EXCEPTION 'invalid_delta' USING ERRCODE = '22023';
  END IF;

  SELECT stock_quantity
  INTO v_current
  FROM public.products
  WHERE id = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_next := v_current + p_delta;
  IF v_next < 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.products
  SET stock_quantity = v_next,
      updated_at = now()
  WHERE id = p_product_id;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_increment_volunteer_stats(
  p_volunteer_id uuid,
  p_runs_delta integer,
  p_kg_delta numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_runs integer;
  v_kg numeric(12,2);
BEGIN
  PERFORM 1
  FROM public.volunteers
  WHERE id = p_volunteer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'volunteer_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.volunteers
  SET runs = GREATEST(0, coalesce(runs, 0) + coalesce(p_runs_delta, 0)),
      kg_collected = GREATEST(0::numeric, ROUND((coalesce(kg_collected, 0) + coalesce(p_kg_delta, 0))::numeric, 2)),
      updated_at = now()
  WHERE id = p_volunteer_id
  RETURNING runs, kg_collected INTO v_runs, v_kg;

  RETURN jsonb_build_object(
    'volunteer_id', p_volunteer_id,
    'runs', v_runs,
    'kg_collected', v_kg
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.fs_apply_customer_points(
  p_user_id uuid,
  p_delta integer,
  p_min integer DEFAULT 0,
  p_max integer DEFAULT 100
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min integer := GREATEST(0, coalesce(p_min, 0));
  v_max integer := coalesce(p_max, 100);
  v_current integer;
  v_next integer;
  v_rank text;
BEGIN
  IF v_min > v_max THEN
    RAISE EXCEPTION 'invalid_bounds' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(points, 100)
  INTO v_current
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_next := LEAST(v_max, GREATEST(v_min, v_current + coalesce(p_delta, 0)));
  v_rank := CASE
    WHEN v_next >= 85 THEN 'Tin cậy'
    WHEN v_next >= 40 THEN 'Hạn chế'
    ELSE 'Chặn'
  END;

  UPDATE public.profiles
  SET points = v_next,
      rank = v_rank,
      updated_at = now()
  WHERE id = p_user_id;

  RETURN v_next;
END;
$$;

-- ───────── 5. G-7: Uy tín cửa hàng nguyên tử không cần TCP pg.Pool ─────────
-- Khớp chính xác schema 002_seller_reputation_realtime.sql + 028_order_policy_enums.sql + sellerReputationService.ts:
--   - Enum seller_reputation_status: 'Active' | 'Restricted' | 'Banned' (ngưỡng < 40 => Banned, < 85 => Restricted 48h, >= 85 => Active).
--   - Bảo toàn ràng buộc seller_reputation_restricted_until_valid (status = 'Restricted' => restricted_until IS NOT NULL).
--   - Trạng thái 'Banned' không tự động mở lại khi cộng điểm.
CREATE OR REPLACE FUNCTION public.fs_seller_reputation_apply_delta(
  p_store_id uuid,
  p_delta integer,
  p_violation_type text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_order_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.seller_reputation;
  v_updated public.seller_reputation;
  v_delta integer := coalesce(p_delta, 0);
  v_before integer;
  v_after integer;
  v_next_status public.seller_reputation_status;
  v_next_restricted_until timestamptz;
  v_violation_recorded boolean := false;
BEGIN
  -- Tạo lười hồ sơ uy tín từ bảng stores nếu cửa hàng chưa có dòng trong seller_reputation
  INSERT INTO public.seller_reputation (seller_id, rating_avg)
  SELECT s.id, s.rating
  FROM public.stores s
  WHERE s.id = p_store_id
  ON CONFLICT (seller_id) DO NOTHING;

  SELECT *
  INTO v_row
  FROM public.seller_reputation
  WHERE seller_id = p_store_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'seller_reputation_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_before := v_row.trust_score;
  v_after := LEAST(100, GREATEST(0, v_before + v_delta));

  IF v_row.status = 'Banned'::public.seller_reputation_status THEN
    v_next_status := 'Banned'::public.seller_reputation_status;
    v_next_restricted_until := NULL;
  ELSIF v_after < 40 THEN
    v_next_status := 'Banned'::public.seller_reputation_status;
    v_next_restricted_until := NULL;
  ELSIF v_after < 85 THEN
    v_next_status := 'Restricted'::public.seller_reputation_status;
    IF v_delta < 0 OR v_row.restricted_until IS NULL THEN
      v_next_restricted_until := GREATEST(coalesce(v_row.restricted_until, now()), now()) + interval '48 hours';
    ELSE
      v_next_restricted_until := v_row.restricted_until;
    END IF;
  ELSE
    v_next_status := 'Active'::public.seller_reputation_status;
    v_next_restricted_until := NULL;
  END IF;

  UPDATE public.seller_reputation
  SET trust_score = v_after,
      status = v_next_status,
      restricted_until = v_next_restricted_until,
      updated_at = now()
  WHERE seller_id = p_store_id
  RETURNING * INTO v_updated;

  IF p_violation_type IS NOT NULL AND btrim(p_violation_type) <> '' THEN
    INSERT INTO public.seller_violations (
      seller_id,
      order_id,
      violation_type,
      reason,
      point_delta,
      trust_score_before,
      trust_score_after,
      rating_avg_snapshot,
      status_after,
      metadata
    )
    VALUES (
      p_store_id,
      p_order_id,
      btrim(p_violation_type)::public.seller_violation_type,
      coalesce(nullif(btrim(p_reason), ''), btrim(p_violation_type)),
      v_delta,
      v_before,
      v_after,
      v_updated.rating_avg,
      v_updated.status,
      jsonb_build_object(
        'source', 'fs_seller_reputation_apply_delta',
        'applied_delta', v_after - v_before,
        'order_id', p_order_id
      )
    );
    v_violation_recorded := true;
  END IF;

  RETURN jsonb_build_object(
    'seller_id', v_updated.seller_id,
    'trust_score', v_updated.trust_score,
    'trust_score_before', v_before,
    'rating_avg', v_updated.rating_avg,
    'status', v_updated.status,
    'restricted_until', v_updated.restricted_until,
    'created_at', v_updated.created_at,
    'updated_at', v_updated.updated_at,
    'status_changed', v_updated.status IS DISTINCT FROM v_row.status,
    'violation_recorded', v_violation_recorded
  );
END;
$$;

-- ───────── 6. DB-10: Ghi chú đơn vị tiền VND nguyên cho toàn bộ cột *_cents ─────────
COMMENT ON COLUMN public.products.price_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Giá bán hiện tại của sản phẩm.';
COMMENT ON COLUMN public.products.original_price_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Giá gốc trước khi giảm.';

COMMENT ON COLUMN public.orders.subtotal_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Tạm tính tiền hàng trước giảm giá và phí.';
COMMENT ON COLUMN public.orders.discount_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Số tiền giảm từ voucher.';
COMMENT ON COLUMN public.orders.platform_fee_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Phí dịch vụ nền tảng.';
COMMENT ON COLUMN public.orders.donation_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Khoản quyên góp thêm cùng đơn.';
COMMENT ON COLUMN public.orders.total_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Tổng số tiền người mua thanh toán.';

COMMENT ON COLUMN public.order_items.unit_price_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Đơn giá bán tại thời điểm đặt.';
COMMENT ON COLUMN public.order_items.original_unit_price_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Đơn giá gốc tại thời điểm đặt.';

COMMENT ON COLUMN public.wallets.balance_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Số dư hiện tại của ví trong sổ cái.';
COMMENT ON COLUMN public.ledger_entries.amount_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Số tiền phát sinh của bút toán.';
COMMENT ON COLUMN public.withdrawals.amount_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Số tiền yêu cầu rút về tài khoản cửa hàng.';
COMMENT ON COLUMN public.complaints.refund_cents IS 'Đơn vị: VND nguyên (1 = 1 VND, không nhân 100). Số tiền hoàn cho người mua theo quyết định khiếu nại.';

-- ───────── 7. Phân quyền thực thi RPC (chỉ service_role) ─────────
REVOKE ALL ON FUNCTION public.fs_reserve_order_stock(jsonb, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_restore_order_stock_atomic(uuid, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_settle_order(uuid, uuid, bigint, bigint, bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_refund_order(uuid, uuid, bigint, boolean, bigint, bigint, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_adjust_product_stock(uuid, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_increment_volunteer_stats(uuid, integer, numeric) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_apply_customer_points(uuid, integer, integer, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.fs_seller_reputation_apply_delta(uuid, integer, text, text, uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fs_reserve_order_stock(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_restore_order_stock_atomic(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_settle_order(uuid, uuid, bigint, bigint, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_refund_order(uuid, uuid, bigint, boolean, bigint, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_adjust_product_stock(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_increment_volunteer_stats(uuid, integer, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_apply_customer_points(uuid, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fs_seller_reputation_apply_delta(uuid, integer, text, text, uuid) TO service_role;

COMMIT;
