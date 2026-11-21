-- Apply to the existing Supabase database, after migration 014. This migration
-- does not copy, delete, approve, suspend, or otherwise rewrite application rows.
--
-- Orders are written only by the authenticated Express API using service_role.
-- Charity onboarding still writes charity_profiles directly from the frontend,
-- so preserve those writes and protect only the administrator approval status.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.protect_profile_privileged_columns()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger
       WHERE tgrelid = 'public.profiles'::regclass
         AND tgname = 'protect_profile_privileged_columns'
         AND tgenabled <> 'D'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION 'Apply database/Admin/014_admin_login_security.sql before migration 038'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.orders, public.order_items
  FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders, public.order_items
  TO service_role;

CREATE OR REPLACE FUNCTION public.protect_charity_approval_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.role() comes from the verified PostgREST JWT, not user metadata.
  -- Trusted service-role requests and direct SQL administration remain intact.
  IF coalesce(auth.role(), '') IN ('anon', 'authenticated')
     AND NOT coalesce(public.is_admin(), false) THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IS DISTINCT FROM 'pending'::public.profile_status THEN
        RAISE EXCEPTION 'Only an administrator may approve an organization'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Only an administrator may change organization approval status'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_charity_approval_status ON public.charity_profiles;
CREATE TRIGGER protect_charity_approval_status
  BEFORE INSERT OR UPDATE ON public.charity_profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_charity_approval_status();

COMMIT;
