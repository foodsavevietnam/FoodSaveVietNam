-- ============================================================================
-- 043b_private_storage_buckets.sql (Wave 4D: M-1 Private Storage Buckets & RLS)
-- Chạy SAU các migration 001 -> 042 (bắt buộc đã có public.is_admin() từ 001).
-- Chạy lại nhiều lần an toàn (idempotent 100%). KHÔNG xóa / không sửa file hiện có.
-- CHỈ SOẠN SẴN — KHÔNG tự động chạy lên cơ sở dữ liệu sản phẩm nếu chưa rà soát.
--
-- Nội dung thực hiện:
--   1. Tạo / cập nhật 2 bucket riêng tư (public = false) trong storage.buckets:
--      - complaint-evidence: giới hạn 5 MB (5242880 bytes), MIME image/jpeg, image/png, image/webp
--      - kyc-documents: giới hạn 10 MB (10485760 bytes), MIME image/jpeg, image/png, image/webp, application/pdf
--   2. Bổ sung chính sách RLS chặt chẽ trên storage.objects:
--      - Chặn tuyệt đối vai trò anon (AS RESTRICTIVE) trên cả 2 bucket riêng tư.
--      - Vai trò authenticated chỉ được đọc/ghi trong thư mục của chính mình
--        (kyc-documents: <auth.uid()>/...; complaint-evidence: complaints/<order_id>/<auth.uid()>/...
--         hoặc <auth.uid()>/...) hoặc khi public.is_admin() = true.
--
-- Hướng dẫn hoàn tác (chỉ khi thật sự cần quay lui):
--   BEGIN;
--   DROP POLICY IF EXISTS private_buckets_deny_anon ON storage.objects;
--   DROP POLICY IF EXISTS complaint_evidence_authenticated_select ON storage.objects;
--   DROP POLICY IF EXISTS complaint_evidence_authenticated_insert ON storage.objects;
--   DROP POLICY IF EXISTS complaint_evidence_authenticated_update ON storage.objects;
--   DROP POLICY IF EXISTS complaint_evidence_authenticated_delete ON storage.objects;
--   DROP POLICY IF EXISTS kyc_documents_authenticated_select ON storage.objects;
--   DROP POLICY IF EXISTS kyc_documents_authenticated_insert ON storage.objects;
--   DROP POLICY IF EXISTS kyc_documents_authenticated_update ON storage.objects;
--   DROP POLICY IF EXISTS kyc_documents_authenticated_delete ON storage.objects;
--   -- Lưu ý: chỉ xóa bucket nếu bucket rỗng (không còn object nào):
--   -- DELETE FROM storage.buckets WHERE id IN ('complaint-evidence', 'kyc-documents');
--   COMMIT;
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';

-- ───────── 0. Kiểm tra điều kiện tiên quyết ─────────
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL
     OR to_regclass('storage.objects') IS NULL
     OR to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Cần Supabase Storage (storage.buckets, storage.objects) và public.is_admin() trước khi chạy 043b_private_storage_buckets.sql'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- ───────── 1. Bucket riêng tư complaint-evidence (5 MB) & kyc-documents (10 MB) ─────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'complaint-evidence',
  'complaint-evidence',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-documents',
  'kyc-documents',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ───────── 2. Chính sách RLS chặt chẽ trên storage.objects ─────────
-- Chặn tuyệt đối anon trên 2 bucket riêng tư ngay cả khi tồn tại policy mở cho bucket công khai khác
DROP POLICY IF EXISTS private_buckets_deny_anon ON storage.objects;
CREATE POLICY private_buckets_deny_anon
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (bucket_id NOT IN ('complaint-evidence', 'kyc-documents'))
  WITH CHECK (bucket_id NOT IN ('complaint-evidence', 'kyc-documents'));

-- Bucket complaint-evidence: authenticated chỉ truy cập thư mục của mình hoặc public.is_admin()
-- Cấu trúc đường dẫn chuẩn: complaints/<order_id>/<actor_id>/<uuid>.<ext> (folder[1]='complaints', folder[3]=auth.uid())
DROP POLICY IF EXISTS complaint_evidence_authenticated_select ON storage.objects;
CREATE POLICY complaint_evidence_authenticated_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'complaint-evidence'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (
        (storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  );

DROP POLICY IF EXISTS complaint_evidence_authenticated_insert ON storage.objects;
CREATE POLICY complaint_evidence_authenticated_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'complaint-evidence'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (
        (storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  );

DROP POLICY IF EXISTS complaint_evidence_authenticated_update ON storage.objects;
CREATE POLICY complaint_evidence_authenticated_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'complaint-evidence'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (
        (storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  )
  WITH CHECK (
    bucket_id = 'complaint-evidence'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (
        (storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  );

DROP POLICY IF EXISTS complaint_evidence_authenticated_delete ON storage.objects;
CREATE POLICY complaint_evidence_authenticated_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'complaint-evidence'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
      OR (
        (storage.foldername(name))[1] = 'complaints'
        AND (storage.foldername(name))[3] = auth.uid()::text
      )
    )
  );

-- Bucket kyc-documents: authenticated chỉ truy cập thư mục của chính mình (<auth.uid()>/...) hoặc public.is_admin()
DROP POLICY IF EXISTS kyc_documents_authenticated_select ON storage.objects;
CREATE POLICY kyc_documents_authenticated_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS kyc_documents_authenticated_insert ON storage.objects;
CREATE POLICY kyc_documents_authenticated_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS kyc_documents_authenticated_update ON storage.objects;
CREATE POLICY kyc_documents_authenticated_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  )
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS kyc_documents_authenticated_delete ON storage.objects;
CREATE POLICY kyc_documents_authenticated_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

COMMIT;
