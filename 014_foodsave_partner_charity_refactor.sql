create extension if not exists pgcrypto;

do $$
begin
  create type public.user_role as enum ('partner', 'charity', 'admin');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.profile_status as enum ('pending', 'active', 'suspended', 'rejected');
exception when duplicate_object then null;
end $$;

alter type public.profile_status add value if not exists 'rejected';

do $$
begin
  create type public.donation_urgency as enum ('green', 'yellow', 'red');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.donation_status as enum ('open', 'accepted', 'in_route', 'completed', 'rejected', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.volunteer_status as enum ('new', 'active', 'inactive');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.report_status as enum ('draft', 'in_progress', 'published');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.contact_status as enum ('open', 'in_review', 'closed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.auth_audit_event as enum (
    'REGISTER_SUCCESS',
    'LOGIN_SUCCESS',
    'LOGIN_FAILED',
    'LOGOUT',
    'TOKEN_REFRESH',
    'PASSWORD_RESET_REQUESTED',
    'PHONE_OTP_SENT',
    'PHONE_OTP_VERIFIED',
    'PHONE_OTP_FAILED'
  );
exception when duplicate_object then null;
end $$;

alter type public.auth_audit_event add value if not exists 'PHONE_OTP_SENT';
alter type public.auth_audit_event add value if not exists 'PHONE_OTP_VERIFIED';
alter type public.auth_audit_event add value if not exists 'PHONE_OTP_FAILED';
alter type public.auth_audit_event add value if not exists 'GOOGLE_OAUTH_STARTED';
alter type public.auth_audit_event add value if not exists 'GOOGLE_OTP_SENT';
alter type public.auth_audit_event add value if not exists 'GOOGLE_OTP_VERIFIED';
alter type public.auth_audit_event add value if not exists 'GOOGLE_OTP_FAILED';
alter type public.auth_audit_event add value if not exists 'FACEBOOK_OAUTH_STARTED';
alter type public.auth_audit_event add value if not exists 'FACEBOOK_OAUTH_COMPLETED';
alter type public.auth_audit_event add value if not exists 'FACEBOOK_OAUTH_FAILED';

drop table if exists public.cart_items cascade;
drop table if exists public.favorite_products cascade;
drop table if exists public.favorite_stores cascade;
drop table if exists public.recent_product_views cascade;
drop table if exists public.customer_profiles cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.reviews cascade;
drop table if exists public.complaints cascade;
drop table if exists public.vouchers cascade;
drop table if exists public.applications cascade;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'partner',
  email text,
  phone text,
  full_name text,
  status public.profile_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists role public.user_role not null default 'partner',
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists full_name text,
  add column if not exists status public.profile_status not null default 'pending',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  alter column role set default 'partner',
  alter column status set default 'pending';

delete from public.profiles where role::text = 'customer';

alter table public.profiles
  drop constraint if exists profiles_role_no_customer,
  add constraint profiles_role_no_customer check (role::text in ('partner', 'charity', 'admin'));

alter table public.profiles
  drop column if exists avatar_url cascade,
  drop column if exists points cascade,
  drop column if exists rank cascade,
  drop column if exists metadata cascade,
  drop column if exists auth_provider cascade,
  drop column if exists last_login_at cascade,
  drop column if exists terms_accepted_at cascade,
  drop column if exists marketing_opt_in cascade;

drop index if exists public.profiles_email_lower_unique_idx;
create unique index profiles_email_lower_unique_idx
on public.profiles (lower(email))
where email is not null;

drop index if exists public.profiles_phone_unique_idx;
create unique index profiles_phone_unique_idx
on public.profiles (phone)
where phone is not null;

create index if not exists profiles_role_status_idx
on public.profiles(role, status);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Chua cap nhat',
  slug text not null unique,
  legal_name text,
  tax_code text,
  business_license_number text,
  business_type text not null default 'other',
  cccd_number text,
  description text,
  hashtags text[] not null default '{}',
  public_email text,
  public_hotline text,
  avatar_url text,
  cover_url text,
  cccd_front_url text,
  cccd_back_url text,
  business_license_url text,
  food_safety_certificate_url text,
  street text,
  ward text,
  city text not null default 'TP.HCM',
  latitude double precision,
  longitude double precision,
  rating numeric(3,2) not null default 5.00 check (rating >= 0 and rating <= 5),
  commission_rate numeric(5,2) not null default 0.00 check (commission_rate >= 0 and commission_rate <= 100),
  service_tier text not null default 'Standard',
  is_verified boolean not null default false,
  is_open boolean not null default false,
  opening_hours text,
  status public.profile_status not null default 'pending',
  rejection_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stores
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade,
  add column if not exists name text,
  add column if not exists slug text,
  add column if not exists legal_name text,
  add column if not exists tax_code text,
  add column if not exists business_license_number text,
  add column if not exists business_type text not null default 'other',
  add column if not exists cccd_number text,
  add column if not exists description text,
  add column if not exists hashtags text[] not null default '{}',
  add column if not exists public_email text,
  add column if not exists public_hotline text,
  add column if not exists avatar_url text,
  add column if not exists cover_url text,
  add column if not exists cccd_front_url text,
  add column if not exists cccd_back_url text,
  add column if not exists business_license_url text,
  add column if not exists food_safety_certificate_url text,
  add column if not exists street text,
  add column if not exists ward text,
  add column if not exists city text not null default 'TP.HCM',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists rating numeric(3,2) not null default 5.00,
  add column if not exists commission_rate numeric(5,2) not null default 0.00,
  add column if not exists service_tier text not null default 'Standard',
  add column if not exists is_verified boolean not null default false,
  add column if not exists is_open boolean not null default false,
  add column if not exists opening_hours text,
  add column if not exists status public.profile_status not null default 'pending',
  add column if not exists rejection_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.stores
set
  name = coalesce(nullif(name, ''), 'Chua cap nhat'),
  slug = coalesce(nullif(slug, ''), 'store-' || substr(id::text, 1, 8)),
  street = coalesce(nullif(street, ''), 'Chua cap nhat'),
  ward = coalesce(nullif(ward, ''), 'Chua cap nhat'),
  city = coalesce(nullif(city, ''), 'TP.HCM'),
  status = coalesce(status, 'pending'::public.profile_status)
where true;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'address'
  ) then
    execute $sql$
      update public.stores
      set street = coalesce(nullif(street, ''), nullif(address, ''), 'Chua cap nhat')
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'phone'
  ) then
    execute $sql$
      update public.stores
      set public_hotline = coalesce(public_hotline, phone)
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'email'
  ) then
    execute $sql$
      update public.stores
      set public_email = coalesce(public_email, email)
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'logo_url'
  ) then
    execute $sql$
      update public.stores
      set avatar_url = coalesce(avatar_url, logo_url)
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'metadata'
  ) then
    execute $sql$
      update public.stores
      set
        legal_name = coalesce(nullif(legal_name, ''), nullif(metadata -> 'store' ->> 'legal_name', '')),
        tax_code = coalesce(nullif(tax_code, ''), nullif(metadata -> 'store' ->> 'tax_code', '')),
        business_type = coalesce(nullif(business_type, ''), nullif(metadata -> 'store' ->> 'business_type', ''), 'other'),
        description = coalesce(nullif(description, ''), nullif(metadata -> 'store' ->> 'description', '')),
        public_email = coalesce(nullif(public_email, ''), nullif(metadata -> 'contact' ->> 'email', ''), nullif(metadata -> 'contact' ->> 'admin_email', '')),
        public_hotline = coalesce(nullif(public_hotline, ''), nullif(metadata -> 'store' ->> 'hotline', ''), nullif(metadata -> 'contact' ->> 'phone', '')),
        avatar_url = coalesce(
          nullif(avatar_url, ''),
          nullif(metadata -> 'documents' -> 'logo' ->> 'url', '')
        ),
        cover_url = coalesce(
          nullif(cover_url, ''),
          nullif(metadata -> 'documents' -> 'cover' ->> 'url', '')
        ),
        cccd_front_url = coalesce(
          nullif(cccd_front_url, ''),
          nullif(metadata -> 'documents' -> 'cccdFront' ->> 'url', ''),
          nullif(metadata -> 'documents' -> 'cccd_front' ->> 'url', '')
        ),
        cccd_back_url = coalesce(
          nullif(cccd_back_url, ''),
          nullif(metadata -> 'documents' -> 'cccdBack' ->> 'url', ''),
          nullif(metadata -> 'documents' -> 'cccd_back' ->> 'url', '')
        ),
        business_license_url = coalesce(
          nullif(business_license_url, ''),
          nullif(metadata -> 'documents' -> 'businessLicense' ->> 'url', ''),
          nullif(metadata -> 'documents' -> 'business_license' ->> 'url', '')
        ),
        food_safety_certificate_url = coalesce(
          nullif(food_safety_certificate_url, ''),
          nullif(metadata -> 'documents' -> 'foodSafety' ->> 'url', ''),
          nullif(metadata -> 'documents' -> 'food_safety' ->> 'url', ''),
          nullif(metadata -> 'documents' -> 'food_safety_certificate' ->> 'url', '')
        ),
        street = coalesce(nullif(street, ''), nullif(metadata -> 'address' ->> 'street', ''), nullif(metadata -> 'address' ->> 'address', '')),
        ward = coalesce(nullif(ward, ''), nullif(metadata -> 'address' ->> 'ward', '')),
        city = coalesce(nullif(city, ''), nullif(metadata -> 'address' ->> 'city', ''), 'TP.HCM')
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stores'
      and column_name = 'documents'
  ) then
    execute $sql$
      update public.stores
      set
        avatar_url = coalesce(nullif(avatar_url, ''), nullif(documents -> 'logo' ->> 'url', '')),
        cover_url = coalesce(nullif(cover_url, ''), nullif(documents -> 'cover' ->> 'url', '')),
        cccd_front_url = coalesce(
          nullif(cccd_front_url, ''),
          nullif(documents -> 'cccdFront' ->> 'url', ''),
          nullif(documents -> 'cccd_front' ->> 'url', '')
        ),
        cccd_back_url = coalesce(
          nullif(cccd_back_url, ''),
          nullif(documents -> 'cccdBack' ->> 'url', ''),
          nullif(documents -> 'cccd_back' ->> 'url', '')
        ),
        business_license_url = coalesce(
          nullif(business_license_url, ''),
          nullif(documents -> 'businessLicense' ->> 'url', ''),
          nullif(documents -> 'business_license' ->> 'url', '')
        ),
        food_safety_certificate_url = coalesce(
          nullif(food_safety_certificate_url, ''),
          nullif(documents -> 'foodSafety' ->> 'url', ''),
          nullif(documents -> 'food_safety' ->> 'url', ''),
          nullif(documents -> 'food_safety_certificate' ->> 'url', '')
        )
    $sql$;
  end if;
end $$;

do $$
begin
  if to_regclass('public.partner_profiles') is not null then
    update public.stores s
    set
      legal_name = coalesce(s.legal_name, pp.legal_name),
      tax_code = coalesce(s.tax_code, pp.tax_code),
      business_license_number = coalesce(s.business_license_number, pp.business_license_number),
      business_type = coalesce(nullif(s.business_type, ''), pp.business_type, 'other'),
      cccd_number = coalesce(s.cccd_number, pp.cccd_number),
      public_email = coalesce(s.public_email, pp.email, pp.admin_email),
      public_hotline = coalesce(s.public_hotline, pp.public_hotline, pp.phone, pp.admin_phone),
      avatar_url = coalesce(
        nullif(s.avatar_url, ''),
        nullif(pp.documents -> 'logo' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'logo' ->> 'url', '')
      ),
      cover_url = coalesce(
        nullif(s.cover_url, ''),
        nullif(pp.documents -> 'cover' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cover' ->> 'url', '')
      ),
      cccd_front_url = coalesce(
        nullif(s.cccd_front_url, ''),
        nullif(pp.documents -> 'cccdFront' ->> 'url', ''),
        nullif(pp.documents -> 'cccd_front' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cccdFront' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cccd_front' ->> 'url', '')
      ),
      cccd_back_url = coalesce(
        nullif(s.cccd_back_url, ''),
        nullif(pp.documents -> 'cccdBack' ->> 'url', ''),
        nullif(pp.documents -> 'cccd_back' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cccdBack' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cccd_back' ->> 'url', '')
      ),
      business_license_url = coalesce(
        nullif(s.business_license_url, ''),
        nullif(pp.documents -> 'businessLicense' ->> 'url', ''),
        nullif(pp.documents -> 'business_license' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'businessLicense' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'business_license' ->> 'url', '')
      ),
      food_safety_certificate_url = coalesce(
        nullif(s.food_safety_certificate_url, ''),
        nullif(pp.documents -> 'foodSafety' ->> 'url', ''),
        nullif(pp.documents -> 'food_safety' ->> 'url', ''),
        nullif(pp.documents -> 'food_safety_certificate' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'foodSafety' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'food_safety' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'food_safety_certificate' ->> 'url', '')
      ),
      status = coalesce(s.status, pp.onboarding_status, 'pending'::public.profile_status)
    from public.partner_profiles pp
    where pp.store_id = s.id;

    insert into public.stores (
      owner_id,
      name,
      slug,
      legal_name,
      tax_code,
      business_license_number,
      business_type,
      cccd_number,
      public_email,
      public_hotline,
      avatar_url,
      cover_url,
      cccd_front_url,
      cccd_back_url,
      business_license_url,
      food_safety_certificate_url,
      street,
      ward,
      city,
      status
    )
    select
      pp.profile_id,
      coalesce(nullif(pp.legal_name, ''), nullif(pp.representative_name, ''), 'Chua cap nhat'),
      'store-' || substr(pp.profile_id::text, 1, 8),
      pp.legal_name,
      pp.tax_code,
      pp.business_license_number,
      coalesce(nullif(pp.business_type, ''), 'other'),
      pp.cccd_number,
      coalesce(pp.email, pp.admin_email),
      coalesce(pp.public_hotline, pp.phone, pp.admin_phone),
      coalesce(
        nullif(pp.documents -> 'logo' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'logo' ->> 'url', '')
      ),
      coalesce(
        nullif(pp.documents -> 'cover' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cover' ->> 'url', '')
      ),
      coalesce(
        nullif(pp.documents -> 'cccdFront' ->> 'url', ''),
        nullif(pp.documents -> 'cccd_front' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cccdFront' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cccd_front' ->> 'url', '')
      ),
      coalesce(
        nullif(pp.documents -> 'cccdBack' ->> 'url', ''),
        nullif(pp.documents -> 'cccd_back' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cccdBack' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'cccd_back' ->> 'url', '')
      ),
      coalesce(
        nullif(pp.documents -> 'businessLicense' ->> 'url', ''),
        nullif(pp.documents -> 'business_license' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'businessLicense' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'business_license' ->> 'url', '')
      ),
      coalesce(
        nullif(pp.documents -> 'foodSafety' ->> 'url', ''),
        nullif(pp.documents -> 'food_safety' ->> 'url', ''),
        nullif(pp.documents -> 'food_safety_certificate' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'foodSafety' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'food_safety' ->> 'url', ''),
        nullif(pp.metadata -> 'documents' -> 'food_safety_certificate' ->> 'url', '')
      ),
      'Chua cap nhat',
      'Chua cap nhat',
      'TP.HCM',
      coalesce(pp.onboarding_status, 'pending'::public.profile_status)
    from public.partner_profiles pp
    where not exists (
      select 1
      from public.stores s
      where s.owner_id = pp.profile_id
    );
  end if;
end $$;

drop function if exists public.handle_partner_approval() cascade;
drop table if exists public.partner_profiles cascade;

alter table public.stores
  alter column owner_id set not null,
  alter column name set default 'Chua cap nhat',
  alter column name set not null,
  alter column slug set not null,
  alter column business_type set default 'other',
  alter column business_type set not null,
  alter column hashtags set default '{}',
  alter column hashtags set not null,
  alter column city set default 'TP.HCM',
  alter column city set not null,
  alter column rating set default 5.00,
  alter column rating set not null,
  alter column commission_rate set default 0.00,
  alter column commission_rate set not null,
  alter column service_tier set default 'Standard',
  alter column service_tier set not null,
  alter column is_verified set default false,
  alter column is_verified set not null,
  alter column is_open set default false,
  alter column is_open set not null,
  alter column status set default 'pending',
  alter column status set not null;

alter table public.stores
  drop column if exists address cascade,
  drop column if exists district cascade,
  drop column if exists logo_url cascade,
  drop column if exists onboarding_status cascade,
  drop column if exists documents cascade,
  drop column if exists metadata cascade,
  drop column if exists phone cascade,
  drop column if exists email cascade;

drop index if exists public.stores_search_idx;
create index stores_search_idx
on public.stores
using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(street, '') || ' ' || coalesce(ward, '') || ' ' || coalesce(city, '')));

create index if not exists stores_owner_idx on public.stores(owner_id);
create index if not exists stores_status_review_idx on public.stores(status, reviewed_at);
create index if not exists stores_city_ward_idx on public.stores(city, ward);

create table if not exists public.charity_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'Chua cap nhat',
  slug text not null unique,
  legal_name text,
  registration_number text,
  representative_title text,
  representative_cccd text,
  description text,
  public_email text,
  public_hotline text,
  avatar_url text,
  cover_url text,
  cccd_front_url text,
  cccd_back_url text,
  establishment_decision_url text,
  operating_license_url text,
  financial_report_url text,
  street text,
  ward text,
  city text not null default 'TP.HCM',
  latitude double precision,
  longitude double precision,
  beneficiaries_count integer not null default 0 check (beneficiaries_count >= 0),
  rating numeric(3,2) not null default 5.00 check (rating >= 0 and rating <= 5),
  is_open boolean not null default false,
  status public.profile_status not null default 'pending',
  rejection_reason text,
  approved_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.charity_profiles
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade,
  add column if not exists name text,
  add column if not exists slug text,
  add column if not exists legal_name text,
  add column if not exists registration_number text,
  add column if not exists representative_title text,
  add column if not exists representative_cccd text,
  add column if not exists description text,
  add column if not exists public_email text,
  add column if not exists public_hotline text,
  add column if not exists avatar_url text,
  add column if not exists cover_url text,
  add column if not exists cccd_front_url text,
  add column if not exists cccd_back_url text,
  add column if not exists establishment_decision_url text,
  add column if not exists operating_license_url text,
  add column if not exists financial_report_url text,
  add column if not exists street text,
  add column if not exists ward text,
  add column if not exists city text not null default 'TP.HCM',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists beneficiaries_count integer not null default 0,
  add column if not exists rating numeric(3,2) not null default 5.00,
  add column if not exists is_open boolean not null default false,
  add column if not exists status public.profile_status not null default 'pending',
  add column if not exists rejection_reason text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.charity_profiles
set
  name = coalesce(nullif(name, ''), 'Chua cap nhat'),
  slug = coalesce(nullif(slug, ''), 'charity-' || substr(id::text, 1, 8)),
  street = coalesce(nullif(street, ''), 'Chua cap nhat'),
  ward = coalesce(nullif(ward, ''), 'Chua cap nhat'),
  city = coalesce(nullif(city, ''), 'TP.HCM'),
  status = coalesce(status, 'pending'::public.profile_status)
where true;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charity_profiles'
      and column_name = 'email'
  ) then
    execute $sql$
      update public.charity_profiles
      set public_email = coalesce(public_email, email)
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charity_profiles'
      and column_name = 'phone'
  ) then
    execute $sql$
      update public.charity_profiles
      set public_hotline = coalesce(public_hotline, phone)
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charity_profiles'
      and column_name = 'address'
  ) then
    execute $sql$
      update public.charity_profiles
      set street = coalesce(nullif(street, ''), nullif(address, ''), 'Chua cap nhat')
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charity_profiles'
      and column_name = 'logo_url'
  ) then
    execute $sql$
      update public.charity_profiles
      set avatar_url = coalesce(avatar_url, logo_url)
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charity_profiles'
      and column_name = 'license_image_url'
  ) then
    execute $sql$
      update public.charity_profiles
      set operating_license_url = coalesce(operating_license_url, license_image_url)
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charity_profiles'
      and column_name = 'decision_image_url'
  ) then
    execute $sql$
      update public.charity_profiles
      set establishment_decision_url = coalesce(establishment_decision_url, decision_image_url)
    $sql$;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charity_profiles'
      and column_name = 'metadata'
  ) then
    execute $sql$
      update public.charity_profiles
      set
        legal_name = coalesce(
          nullif(legal_name, ''),
          nullif(metadata -> 'organization_info' ->> 'organization_name', '')
        ),
        registration_number = coalesce(
          nullif(registration_number, ''),
          nullif(metadata ->> 'tax_id', ''),
          nullif(metadata -> 'organization_info' ->> 'tax_id', '')
        ),
        representative_title = coalesce(
          nullif(representative_title, ''),
          nullif(metadata ->> 'representative_role', ''),
          nullif(metadata -> 'organization_info' ->> 'representative_role', '')
        ),
        representative_cccd = coalesce(
          nullif(representative_cccd, ''),
          nullif(metadata ->> 'representative_cccd', ''),
          nullif(metadata -> 'organization_info' ->> 'representative_cccd', '')
        ),
        description = coalesce(
          nullif(description, ''),
          nullif(metadata ->> 'description', ''),
          nullif(metadata -> 'organization_info' ->> 'description', '')
        ),
        public_email = coalesce(
          nullif(public_email, ''),
          nullif(metadata -> 'organization_info' ->> 'organization_email', ''),
          nullif(metadata ->> 'representative_email', ''),
          nullif(metadata -> 'organization_info' ->> 'representative_email', '')
        ),
        public_hotline = coalesce(
          nullif(public_hotline, ''),
          nullif(metadata -> 'organization_info' ->> 'organization_phone', ''),
          nullif(metadata ->> 'representative_phone', ''),
          nullif(metadata -> 'organization_info' ->> 'representative_phone', '')
        ),
        avatar_url = coalesce(
          nullif(avatar_url, ''),
          nullif(metadata ->> 'avatar_logo_url', ''),
          nullif(metadata -> 'documents' -> 'avatar_logo' ->> 'url', ''),
          nullif(metadata -> 'organization_info' -> 'legal_documents' ->> 'avatar_logo_url', '')
        ),
        cover_url = coalesce(
          nullif(cover_url, ''),
          nullif(metadata ->> 'cover_image_url', ''),
          nullif(metadata ->> 'cover_banner_url', ''),
          nullif(metadata -> 'documents' -> 'cover_banner' ->> 'url', ''),
          nullif(metadata -> 'organization_info' -> 'legal_documents' ->> 'cover_banner_url', '')
        ),
        cccd_front_url = coalesce(
          nullif(cccd_front_url, ''),
          nullif(metadata ->> 'cccd_front_url', ''),
          nullif(metadata -> 'documents' -> 'cccd_front' ->> 'url', ''),
          nullif(metadata -> 'organization_info' -> 'legal_documents' ->> 'cccd_front_url', '')
        ),
        cccd_back_url = coalesce(
          nullif(cccd_back_url, ''),
          nullif(metadata ->> 'cccd_back_url', ''),
          nullif(metadata -> 'documents' -> 'cccd_back' ->> 'url', ''),
          nullif(metadata -> 'organization_info' -> 'legal_documents' ->> 'cccd_back_url', '')
        ),
        establishment_decision_url = coalesce(
          nullif(establishment_decision_url, ''),
          nullif(metadata ->> 'decision_image_url', ''),
          nullif(metadata ->> 'establishment_decision_url', ''),
          nullif(metadata -> 'documents' -> 'establishment_decision' ->> 'url', ''),
          nullif(metadata -> 'organization_info' -> 'legal_documents' ->> 'establishment_decision_url', '')
        ),
        operating_license_url = coalesce(
          nullif(operating_license_url, ''),
          nullif(metadata ->> 'license_image_url', ''),
          nullif(metadata ->> 'operating_license_url', ''),
          nullif(metadata -> 'documents' -> 'operating_license' ->> 'url', ''),
          nullif(metadata -> 'organization_info' -> 'legal_documents' ->> 'operating_license_url', '')
        ),
        financial_report_url = coalesce(
          nullif(financial_report_url, ''),
          nullif(metadata ->> 'financial_report_url', ''),
          nullif(metadata -> 'documents' -> 'financial_report' ->> 'url', ''),
          nullif(metadata -> 'organization_info' -> 'legal_documents' ->> 'financial_report_url', '')
        ),
        street = coalesce(
          nullif(street, ''),
          nullif(metadata ->> 'street', ''),
          nullif(metadata -> 'location' ->> 'street', ''),
          nullif(metadata -> 'organization_info' ->> 'street', '')
        ),
        ward = coalesce(
          nullif(ward, ''),
          nullif(metadata ->> 'ward', ''),
          nullif(metadata -> 'location' ->> 'ward', ''),
          nullif(metadata -> 'organization_info' ->> 'ward', '')
        ),
        city = coalesce(
          nullif(city, ''),
          nullif(metadata ->> 'city', ''),
          nullif(metadata -> 'location' ->> 'city', ''),
          nullif(metadata -> 'organization_info' ->> 'city', ''),
          'TP.HCM'
        )
    $sql$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'charity_profiles'
      and column_name = 'documents'
  ) then
    execute $sql$
      update public.charity_profiles
      set
        avatar_url = coalesce(
          nullif(avatar_url, ''),
          nullif(documents -> 'avatar_logo' ->> 'url', ''),
          nullif(documents -> 'logo' ->> 'url', '')
        ),
        cover_url = coalesce(
          nullif(cover_url, ''),
          nullif(documents -> 'cover_banner' ->> 'url', ''),
          nullif(documents -> 'cover' ->> 'url', ''),
          nullif(documents -> 'coverImage' ->> 'url', '')
        ),
        cccd_front_url = coalesce(
          nullif(cccd_front_url, ''),
          nullif(documents -> 'cccd_front' ->> 'url', ''),
          nullif(documents -> 'cccdFront' ->> 'url', ''),
          nullif(documents -> 'idCard' ->> 'url', '')
        ),
        cccd_back_url = coalesce(
          nullif(cccd_back_url, ''),
          nullif(documents -> 'cccd_back' ->> 'url', ''),
          nullif(documents -> 'cccdBack' ->> 'url', '')
        ),
        establishment_decision_url = coalesce(
          nullif(establishment_decision_url, ''),
          nullif(documents -> 'establishment_decision' ->> 'url', ''),
          nullif(documents -> 'decision' ->> 'url', '')
        ),
        operating_license_url = coalesce(
          nullif(operating_license_url, ''),
          nullif(documents -> 'operating_license' ->> 'url', ''),
          nullif(documents -> 'license' ->> 'url', '')
        ),
        financial_report_url = coalesce(
          nullif(financial_report_url, ''),
          nullif(documents -> 'financial_report' ->> 'url', ''),
          nullif(documents -> 'finance' ->> 'url', ''),
          nullif(documents -> 'financialReport' ->> 'url', '')
        )
    $sql$;
  end if;
end $$;

alter table public.charity_profiles
  alter column owner_id set not null,
  alter column name set default 'Chua cap nhat',
  alter column name set not null,
  alter column slug set not null,
  alter column city set default 'TP.HCM',
  alter column city set not null,
  alter column beneficiaries_count set default 0,
  alter column beneficiaries_count set not null,
  alter column rating set default 5.00,
  alter column rating set not null,
  alter column is_open set default false,
  alter column is_open set not null,
  alter column status set default 'pending',
  alter column status set not null;

alter table public.charity_profiles
  drop column if exists email cascade,
  drop column if exists phone cascade,
  drop column if exists address cascade,
  drop column if exists district cascade,
  drop column if exists metadata cascade,
  drop column if exists documents cascade,
  drop column if exists logo_url cascade,
  drop column if exists license_image_url cascade,
  drop column if exists decision_image_url cascade;

create index if not exists charity_profiles_owner_idx on public.charity_profiles(owner_id);
create index if not exists charity_profiles_status_review_idx on public.charity_profiles(status, reviewed_at);
create index if not exists charity_profiles_city_ward_idx on public.charity_profiles(city, ward);

create table if not exists public.volunteers (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  full_name text not null,
  phone text not null,
  email text,
  role text not null default 'Tinh nguyen vien',
  vehicle text,
  zones text[] not null default '{}',
  schedule text,
  runs integer not null default 0 check (runs >= 0),
  kg_collected numeric(12,2) not null default 0 check (kg_collected >= 0),
  rating numeric(3,2) not null default 5.00 check (rating >= 0 and rating <= 5),
  status public.volunteer_status not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  donation_code text not null unique,
  store_id uuid not null references public.stores(id) on delete cascade,
  charity_id uuid references public.charity_profiles(id) on delete set null,
  assigned_volunteer_id uuid references public.volunteers(id) on delete set null,
  items text not null,
  amount_text text not null,
  weight_kg numeric(12,2) not null check (weight_kg > 0),
  expires_at timestamptz not null,
  pickup_start text not null,
  pickup_end text not null,
  urgency public.donation_urgency not null,
  status public.donation_status not null default 'open',
  note text,
  distance_text text,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beneficiary_groups (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  group_name text not null,
  people_count integer not null check (people_count >= 0),
  meals text,
  dietary text,
  last_fed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.impact_reports (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  month_start date not null,
  meals integer not null default 0 check (meals >= 0),
  kg_saved numeric(12,2) not null default 0 check (kg_saved >= 0),
  co2_kg numeric(12,2) not null default 0 check (co2_kg >= 0),
  partners_count integer not null default 0 check (partners_count >= 0),
  donors_count integer not null default 0 check (donors_count >= 0),
  beneficiaries_count integer not null default 0 check (beneficiaries_count >= 0),
  status public.report_status not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (charity_id, month_start)
);

create table if not exists public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  charity_id uuid not null references public.charity_profiles(id) on delete cascade,
  donation_id uuid references public.donations(id) on delete set null,
  title text not null,
  image_url text,
  occurred_on timestamptz not null,
  org_name text,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  role_target public.user_role,
  type text not null,
  title text not null,
  body text not null,
  related_type text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_recipient_or_role check (recipient_id is not null or role_target is not null)
);

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  email text not null,
  phone text,
  subject text not null,
  message text not null,
  status public.contact_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.auth_audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  role public.user_role,
  event_type public.auth_audit_event not null,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists volunteers_charity_status_idx on public.volunteers(charity_id, status);
create index if not exists donations_store_idx on public.donations(store_id, created_at desc);
create index if not exists donations_charity_status_idx on public.donations(charity_id, status, created_at desc);
create index if not exists donations_open_urgency_idx on public.donations(status, urgency, expires_at);
create index if not exists beneficiary_groups_charity_idx on public.beneficiary_groups(charity_id);
create index if not exists impact_reports_charity_month_idx on public.impact_reports(charity_id, month_start desc);
create index if not exists gallery_items_public_idx on public.gallery_items(is_public, occurred_on desc);
create index if not exists notifications_recipient_unread_idx on public.notifications(recipient_id, read_at, created_at desc);
create index if not exists notifications_role_unread_idx on public.notifications(role_target, read_at, created_at desc);
create index if not exists contact_messages_status_idx on public.contact_messages(status, created_at desc);
create index if not exists auth_audit_logs_user_created_idx on public.auth_audit_logs(user_id, created_at desc);
create index if not exists auth_audit_logs_event_created_idx on public.auth_audit_logs(event_type, created_at desc);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_stores_updated_at on public.stores;
create trigger set_stores_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

drop trigger if exists set_charity_profiles_updated_at on public.charity_profiles;
create trigger set_charity_profiles_updated_at
before update on public.charity_profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_volunteers_updated_at on public.volunteers;
create trigger set_volunteers_updated_at
before update on public.volunteers
for each row execute function public.set_updated_at();

drop trigger if exists set_donations_updated_at on public.donations;
create trigger set_donations_updated_at
before update on public.donations
for each row execute function public.set_updated_at();

drop trigger if exists set_beneficiary_groups_updated_at on public.beneficiary_groups;
create trigger set_beneficiary_groups_updated_at
before update on public.beneficiary_groups
for each row execute function public.set_updated_at();

drop trigger if exists set_impact_reports_updated_at on public.impact_reports;
create trigger set_impact_reports_updated_at
before update on public.impact_reports
for each row execute function public.set_updated_at();

drop trigger if exists set_gallery_items_updated_at on public.gallery_items;
create trigger set_gallery_items_updated_at
before update on public.gallery_items
for each row execute function public.set_updated_at();

drop trigger if exists set_contact_messages_updated_at on public.contact_messages;
create trigger set_contact_messages_updated_at
before update on public.contact_messages
for each row execute function public.set_updated_at();

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create or replace function public.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

create or replace function public.profile_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and status = 'active'
    ),
    false
  )
$$;

create or replace function public.owns_store(store_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores
    where id = store_uuid
      and owner_id = auth.uid()
  )
$$;

create or replace function public.owns_active_store(store_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores
    where id = store_uuid
      and owner_id = auth.uid()
      and status = 'active'
  )
$$;

create or replace function public.owns_charity(charity_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.charity_profiles
    where id = charity_uuid
      and owner_id = auth.uid()
  )
$$;

create or replace function public.owns_active_charity(charity_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.charity_profiles
    where id = charity_uuid
      and owner_id = auth.uid()
      and status = 'active'
  )
$$;

create or replace function public.prevent_profile_self_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.role is distinct from old.role
    or new.status is distinct from old.status
  ) and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Only admin can change profile role or approval status.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_profile_self_approval on public.profiles;
create trigger prevent_profile_self_approval
before update on public.profiles
for each row execute function public.prevent_profile_self_approval();

create or replace function public.prevent_org_self_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (
      new.status is distinct from 'pending'::public.profile_status
      or new.reviewed_at is not null
      or new.rejection_reason is not null
    ) and not (public.is_admin() or public.is_service_role()) then
      raise exception 'Only admin can create approved organization profiles.';
    end if;
  elsif (
    new.status is distinct from old.status
    or new.reviewed_at is distinct from old.reviewed_at
    or new.rejection_reason is distinct from old.rejection_reason
  ) and not (public.is_admin() or public.is_service_role()) then
    raise exception 'Only admin can change organization approval status.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_store_self_approval on public.stores;
create trigger prevent_store_self_approval
before insert or update on public.stores
for each row execute function public.prevent_org_self_approval();

drop trigger if exists prevent_charity_profile_self_approval on public.charity_profiles;
create trigger prevent_charity_profile_self_approval
before insert or update on public.charity_profiles
for each row execute function public.prevent_org_self_approval();

create or replace function public.sync_profile_status_from_org_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    tg_op = 'INSERT'
    and new.status is distinct from 'pending'::public.profile_status
  ) or (
    tg_op = 'UPDATE'
    and new.status is distinct from old.status
  ) then
    update public.profiles
    set status = new.status,
        updated_at = now()
    where id = new.owner_id
      and role::text in ('partner', 'charity')
      and status is distinct from new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_profile_status_from_stores on public.stores;
create trigger sync_profile_status_from_stores
after insert or update of status on public.stores
for each row execute function public.sync_profile_status_from_org_profile();

drop trigger if exists sync_profile_status_from_charity_profiles on public.charity_profiles;
create trigger sync_profile_status_from_charity_profiles
after insert or update of status on public.charity_profiles
for each row execute function public.sync_profile_status_from_org_profile();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
  generated_name text;
  generated_slug text;
begin
  requested_role := case
    when lower(new.raw_user_meta_data ->> 'role') in ('partner', 'charity', 'admin')
      then lower(new.raw_user_meta_data ->> 'role')::public.user_role
    else 'partner'::public.user_role
  end;

  insert into public.profiles (
    id,
    role,
    email,
    phone,
    full_name,
    status
  )
  values (
    new.id,
    requested_role,
    lower(nullif(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'representative_name'), ''),
    case when requested_role = 'admin' then 'active'::public.profile_status else 'pending'::public.profile_status end
  )
  on conflict (id) do update
  set role = excluded.role,
      email = excluded.email,
      phone = coalesce(public.profiles.phone, excluded.phone),
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      status = case
        when public.profiles.status = 'active' then public.profiles.status
        else excluded.status
      end,
      updated_at = now();

  if requested_role = 'partner' then
    generated_name := coalesce(
      nullif(new.raw_user_meta_data ->> 'store_name', ''),
      nullif(new.raw_user_meta_data ->> 'org_name', ''),
      nullif(new.raw_user_meta_data ->> 'legal_name', ''),
      'Chua cap nhat'
    );
    generated_slug := 'store-' || substr(new.id::text, 1, 8);

    insert into public.stores (
      owner_id,
      name,
      slug,
      legal_name,
      tax_code,
      business_license_number,
      business_type,
      cccd_number,
      public_email,
      public_hotline,
      street,
      ward,
      city,
      status
    )
    select
      new.id,
      generated_name,
      generated_slug,
      nullif(new.raw_user_meta_data ->> 'legal_name', ''),
      nullif(new.raw_user_meta_data ->> 'tax_code', ''),
      nullif(new.raw_user_meta_data ->> 'business_license_number', ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'business_type', ''), 'other'),
      nullif(new.raw_user_meta_data ->> 'cccd_number', ''),
      lower(nullif(coalesce(new.raw_user_meta_data ->> 'public_email', new.email), '')),
      nullif(coalesce(new.raw_user_meta_data ->> 'public_hotline', new.raw_user_meta_data ->> 'phone'), ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'street', ''), 'Chua cap nhat'),
      coalesce(nullif(new.raw_user_meta_data ->> 'ward', ''), 'Chua cap nhat'),
      coalesce(nullif(new.raw_user_meta_data ->> 'city', ''), 'TP.HCM'),
      'pending'::public.profile_status
    where not exists (
      select 1
      from public.stores
      where owner_id = new.id
    );
  elsif requested_role = 'charity' then
    generated_name := coalesce(
      nullif(new.raw_user_meta_data ->> 'charity_name', ''),
      nullif(new.raw_user_meta_data ->> 'org_name', ''),
      nullif(new.raw_user_meta_data ->> 'legal_name', ''),
      'Chua cap nhat'
    );
    generated_slug := 'charity-' || substr(new.id::text, 1, 8);

    insert into public.charity_profiles (
      owner_id,
      name,
      slug,
      legal_name,
      registration_number,
      representative_cccd,
      public_email,
      public_hotline,
      street,
      ward,
      city,
      status
    )
    select
      new.id,
      generated_name,
      generated_slug,
      nullif(new.raw_user_meta_data ->> 'legal_name', ''),
      nullif(new.raw_user_meta_data ->> 'registration_number', ''),
      nullif(new.raw_user_meta_data ->> 'cccd_number', ''),
      lower(nullif(coalesce(new.raw_user_meta_data ->> 'public_email', new.email), '')),
      nullif(coalesce(new.raw_user_meta_data ->> 'public_hotline', new.raw_user_meta_data ->> 'phone'), ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'street', ''), 'Chua cap nhat'),
      coalesce(nullif(new.raw_user_meta_data ->> 'ward', ''), 'Chua cap nhat'),
      coalesce(nullif(new.raw_user_meta_data ->> 'city', ''), 'TP.HCM'),
      'pending'::public.profile_status
    where not exists (
      select 1
      from public.charity_profiles
      where owner_id = new.id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.charity_profiles enable row level security;
alter table public.volunteers enable row level security;
alter table public.donations enable row level security;
alter table public.beneficiary_groups enable row level security;
alter table public.impact_reports enable row level security;
alter table public.gallery_items enable row level security;
alter table public.notifications enable row level security;
alter table public.contact_messages enable row level security;
alter table public.auth_audit_logs enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'stores',
        'products',
        'charity_profiles',
        'volunteers',
        'donations',
        'beneficiary_groups',
        'impact_reports',
        'gallery_items',
        'notifications',
        'contact_messages',
        'auth_audit_logs'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end $$;

create policy profiles_select_self_or_admin
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

create policy profiles_update_self_or_admin
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.is_admin())
with check (id = auth.uid() or public.is_admin());

create policy stores_public_select_active
on public.stores
for select
to anon, authenticated
using (status = 'active');

create policy stores_owner_select
on public.stores
for select
to authenticated
using (owner_id = auth.uid() or public.is_admin());

create policy stores_owner_insert
on public.stores
for insert
to authenticated
with check (
  public.is_admin()
  or (
    owner_id = auth.uid()
    and status = 'pending'
  )
);

create policy stores_owner_update
on public.stores
for update
to authenticated
using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

create policy stores_admin_delete
on public.stores
for delete
to authenticated
using (public.is_admin());

create policy charity_profiles_public_select_active
on public.charity_profiles
for select
to anon, authenticated
using (status = 'active');

create policy charity_profiles_owner_select
on public.charity_profiles
for select
to authenticated
using (owner_id = auth.uid() or public.is_admin());

create policy charity_profiles_owner_insert
on public.charity_profiles
for insert
to authenticated
with check (
  public.is_admin()
  or (
    owner_id = auth.uid()
    and status = 'pending'
  )
);

create policy charity_profiles_owner_update
on public.charity_profiles
for update
to authenticated
using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

create policy charity_profiles_admin_delete
on public.charity_profiles
for delete
to authenticated
using (public.is_admin());

do $$
begin
  if to_regclass('public.products') is not null then
    execute 'alter table public.products enable row level security';
    execute 'grant select on public.products to anon';

    execute $policy$
      create policy products_public_select_active
      on public.products
      for select
      to anon, authenticated
      using (
        is_active = true
        and exists (
          select 1
          from public.stores s
          where s.id = products.store_id
            and s.status = 'active'
        )
      )
    $policy$;

    execute $policy$
      create policy products_store_owner_insert
      on public.products
      for insert
      to authenticated
      with check (public.owns_active_store(store_id) or public.is_admin())
    $policy$;

    execute $policy$
      create policy products_store_owner_update
      on public.products
      for update
      to authenticated
      using (public.owns_active_store(store_id) or public.is_admin())
      with check (public.owns_active_store(store_id) or public.is_admin())
    $policy$;

    execute $policy$
      create policy products_store_owner_delete
      on public.products
      for delete
      to authenticated
      using (public.owns_active_store(store_id) or public.is_admin())
    $policy$;
  end if;
end $$;

create policy volunteers_charity_owner_select
on public.volunteers
for select
to authenticated
using (public.owns_charity(charity_id) or public.is_admin());

create policy volunteers_charity_owner_insert
on public.volunteers
for insert
to authenticated
with check (public.owns_active_charity(charity_id) or public.is_admin());

create policy volunteers_charity_owner_update
on public.volunteers
for update
to authenticated
using (public.owns_active_charity(charity_id) or public.is_admin())
with check (public.owns_active_charity(charity_id) or public.is_admin());

create policy volunteers_charity_owner_delete
on public.volunteers
for delete
to authenticated
using (public.owns_active_charity(charity_id) or public.is_admin());

create policy donations_active_participants_select
on public.donations
for select
to authenticated
using (
  public.is_admin()
  or public.owns_store(store_id)
  or (charity_id is not null and public.owns_charity(charity_id))
  or (
    status = 'open'
    and exists (
      select 1
      from public.charity_profiles cp
      where cp.owner_id = auth.uid()
        and cp.status = 'active'
    )
  )
);

create policy donations_store_owner_insert
on public.donations
for insert
to authenticated
with check (public.owns_active_store(store_id) or public.is_admin());

create policy donations_participants_update
on public.donations
for update
to authenticated
using (
  public.is_admin()
  or public.owns_active_store(store_id)
  or (charity_id is not null and public.owns_active_charity(charity_id))
  or (
    status = 'open'
    and exists (
      select 1
      from public.charity_profiles cp
      where cp.owner_id = auth.uid()
        and cp.status = 'active'
    )
  )
)
with check (
  public.is_admin()
  or public.owns_active_store(store_id)
  or (charity_id is not null and public.owns_active_charity(charity_id))
);

create policy donations_store_owner_delete
on public.donations
for delete
to authenticated
using (public.owns_active_store(store_id) or public.is_admin());

create policy beneficiary_groups_charity_owner_select
on public.beneficiary_groups
for select
to authenticated
using (public.owns_charity(charity_id) or public.is_admin());

create policy beneficiary_groups_charity_owner_insert
on public.beneficiary_groups
for insert
to authenticated
with check (public.owns_active_charity(charity_id) or public.is_admin());

create policy beneficiary_groups_charity_owner_update
on public.beneficiary_groups
for update
to authenticated
using (public.owns_active_charity(charity_id) or public.is_admin())
with check (public.owns_active_charity(charity_id) or public.is_admin());

create policy beneficiary_groups_charity_owner_delete
on public.beneficiary_groups
for delete
to authenticated
using (public.owns_active_charity(charity_id) or public.is_admin());

create policy impact_reports_public_or_owner_select
on public.impact_reports
for select
to anon, authenticated
using (status = 'published' or public.owns_charity(charity_id) or public.is_admin());

create policy impact_reports_charity_owner_insert
on public.impact_reports
for insert
to authenticated
with check (public.owns_active_charity(charity_id) or public.is_admin());

create policy impact_reports_charity_owner_update
on public.impact_reports
for update
to authenticated
using (public.owns_active_charity(charity_id) or public.is_admin())
with check (public.owns_active_charity(charity_id) or public.is_admin());

create policy impact_reports_charity_owner_delete
on public.impact_reports
for delete
to authenticated
using (public.owns_active_charity(charity_id) or public.is_admin());

create policy gallery_items_public_or_owner_select
on public.gallery_items
for select
to anon, authenticated
using (is_public = true or public.owns_charity(charity_id) or public.is_admin());

create policy gallery_items_charity_owner_insert
on public.gallery_items
for insert
to authenticated
with check (public.owns_active_charity(charity_id) or public.is_admin());

create policy gallery_items_charity_owner_update
on public.gallery_items
for update
to authenticated
using (public.owns_active_charity(charity_id) or public.is_admin())
with check (public.owns_active_charity(charity_id) or public.is_admin());

create policy gallery_items_charity_owner_delete
on public.gallery_items
for delete
to authenticated
using (public.owns_active_charity(charity_id) or public.is_admin());

create policy notifications_recipient_select
on public.notifications
for select
to authenticated
using (
  recipient_id = auth.uid()
  or role_target = public.current_user_role()
  or public.is_admin()
);

create policy notifications_recipient_update
on public.notifications
for update
to authenticated
using (recipient_id = auth.uid() or public.is_admin())
with check (recipient_id = auth.uid() or public.is_admin());

create policy notifications_admin_insert
on public.notifications
for insert
to authenticated
with check (public.is_admin());

create policy contact_messages_public_insert
on public.contact_messages
for insert
to anon, authenticated
with check (true);

create policy contact_messages_user_or_admin_select
on public.contact_messages
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy contact_messages_admin_update
on public.contact_messages
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy auth_audit_logs_admin_select
on public.auth_audit_logs
for select
to authenticated
using (public.is_admin());

create policy auth_audit_logs_admin_insert
on public.auth_audit_logs
for insert
to authenticated
with check (public.is_admin());

grant usage on schema public to anon, authenticated;
grant select on public.stores, public.charity_profiles, public.impact_reports, public.gallery_items to anon;
grant insert on public.contact_messages to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ════════════════════════════════════════════════════
-- Ported from old project (not customer-related, missing from this refactor):
--   database/User/002_seller_reputation_realtime.sql
--   database/User/004_oauth_auth_flow.sql
--   database/User/006_eco_impact_tracker.sql
-- ════════════════════════════════════════════════════

-- ---- Seller reputation & violations (partner/store trust score) ----
do $$
begin
  create type public.seller_reputation_status as enum ('Active', 'Restricted', 'Banned');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.seller_violation_type as enum (
    'SELLER_CANCELLED_DONATION',
    'MANUAL_REPUTATION_ADJUSTMENT',
    'LOW_RATING_RESTRICTION'
  );
exception when duplicate_object then null;
end $$;

create or replace function public.set_seller_reputation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.seller_reputation (
  seller_id uuid primary key references public.stores(id) on delete cascade,
  trust_score integer not null default 100 check (trust_score >= 0 and trust_score <= 100),
  rating_avg numeric(3,2) not null default 5.00 check (rating_avg >= 0 and rating_avg <= 5),
  status public.seller_reputation_status not null default 'Active',
  restricted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_reputation_restricted_until_valid check (
    status <> 'Restricted' or restricted_until is not null
  )
);

-- Old table referenced public.orders(id), which no longer exists in this schema.
-- Repointed to public.donations(id) since a partner "cancelling" is now a donation event, not a customer order.
create table if not exists public.seller_violations (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.seller_reputation(seller_id) on delete cascade,
  donation_id uuid references public.donations(id) on delete set null,
  violation_type public.seller_violation_type not null,
  reason text not null,
  point_delta integer not null,
  trust_score_before integer not null check (trust_score_before >= 0 and trust_score_before <= 100),
  trust_score_after integer not null check (trust_score_after >= 0 and trust_score_after <= 100),
  rating_avg_snapshot numeric(3,2) not null check (rating_avg_snapshot >= 0 and rating_avg_snapshot <= 5),
  status_after public.seller_reputation_status not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists seller_reputation_status_idx on public.seller_reputation(status);
create index if not exists seller_reputation_restricted_until_idx on public.seller_reputation(restricted_until) where restricted_until is not null;
create index if not exists seller_violations_seller_created_idx on public.seller_violations(seller_id, created_at desc);
create index if not exists seller_violations_donation_idx on public.seller_violations(donation_id) where donation_id is not null;
create index if not exists seller_violations_type_created_idx on public.seller_violations(violation_type, created_at desc);

drop trigger if exists set_seller_reputation_updated_at on public.seller_reputation;
create trigger set_seller_reputation_updated_at
before update on public.seller_reputation
for each row execute function public.set_seller_reputation_updated_at();

insert into public.seller_reputation (seller_id, rating_avg)
select stores.id, stores.rating
from public.stores
on conflict (seller_id) do nothing;

alter table public.seller_reputation enable row level security;
alter table public.seller_violations enable row level security;

drop policy if exists seller_reputation_public_active_select on public.seller_reputation;
create policy seller_reputation_public_active_select
on public.seller_reputation
for select
using (
  status = 'Active'
  or public.owns_store(seller_id)
  or public.is_admin()
);

drop policy if exists seller_reputation_admin_insert on public.seller_reputation;
create policy seller_reputation_admin_insert
on public.seller_reputation
for insert
with check (public.is_admin());

drop policy if exists seller_reputation_admin_update on public.seller_reputation;
create policy seller_reputation_admin_update
on public.seller_reputation
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists seller_reputation_admin_delete on public.seller_reputation;
create policy seller_reputation_admin_delete
on public.seller_reputation
for delete
using (public.is_admin());

drop policy if exists seller_violations_owner_or_admin_select on public.seller_violations;
create policy seller_violations_owner_or_admin_select
on public.seller_violations
for select
using (
  public.is_admin()
  or exists (
    select 1
    from public.stores
    where stores.id = seller_violations.seller_id
      and stores.owner_id = auth.uid()
  )
);

drop policy if exists seller_violations_admin_insert on public.seller_violations;
create policy seller_violations_admin_insert
on public.seller_violations
for insert
with check (public.is_admin());

drop policy if exists seller_violations_admin_update on public.seller_violations;
create policy seller_violations_admin_update
on public.seller_violations
for update
using (public.is_admin())
with check (public.is_admin());

drop policy if exists seller_violations_admin_delete on public.seller_violations;
create policy seller_violations_admin_delete
on public.seller_violations
for delete
using (public.is_admin());

grant select on public.seller_reputation to anon;
grant select, insert, update, delete on public.seller_reputation to authenticated;
grant select, insert, update, delete on public.seller_violations to authenticated;

-- ---- Google/Facebook OAuth OTP challenges (generic, used by any role) ----
create table if not exists public.auth_google_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  expected_role public.user_role,
  expires_at timestamptz not null,
  verified_at timestamptz,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists auth_google_otp_challenges_user_created_idx on public.auth_google_otp_challenges(user_id, created_at desc);
create index if not exists auth_google_otp_challenges_expires_idx on public.auth_google_otp_challenges(expires_at);
create index if not exists auth_google_otp_challenges_pending_idx on public.auth_google_otp_challenges(user_id, expires_at desc) where verified_at is null;

alter table public.auth_google_otp_challenges enable row level security;

drop policy if exists auth_google_otp_challenges_admin_select on public.auth_google_otp_challenges;
create policy auth_google_otp_challenges_admin_select
on public.auth_google_otp_challenges
for select
using (public.is_admin());

drop policy if exists auth_google_otp_challenges_admin_insert on public.auth_google_otp_challenges;
create policy auth_google_otp_challenges_admin_insert
on public.auth_google_otp_challenges
for insert
with check (public.is_admin());

drop policy if exists auth_google_otp_challenges_admin_update on public.auth_google_otp_challenges;
create policy auth_google_otp_challenges_admin_update
on public.auth_google_otp_challenges
for update
using (public.is_admin())
with check (public.is_admin());

grant select, insert, update on public.auth_google_otp_challenges to authenticated;

-- ---- Eco Impact Tracker (CO2/water/meals saved, from donations) ----
-- 'order' source_type kept only for enum compatibility; unused since orders/order_items no longer exist.
do $$
begin
  create type public.eco_impact_source as enum ('order', 'donation', 'manual_adjustment');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  if to_regclass('public.products') is not null then
    execute $sql$
      alter table public.products
        add column if not exists estimated_weight_kg numeric(10,3) check (estimated_weight_kg is null or estimated_weight_kg > 0),
        add column if not exists servings_count integer check (servings_count is null or servings_count > 0)
    $sql$;
  end if;
end $$;

create table if not exists public.eco_impact_factors (
  id text primary key default 'default',
  co2_kg_per_food_kg numeric(8,3) not null default 2.500 check (co2_kg_per_food_kg > 0),
  water_liters_per_food_kg numeric(10,2) not null default 890.00 check (water_liters_per_food_kg > 0),
  food_kg_per_meal numeric(8,3) not null default 0.350 check (food_kg_per_meal > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.eco_impact_factors (id)
values ('default')
on conflict (id) do nothing;

create table if not exists public.eco_impact_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  store_id uuid references public.stores(id) on delete set null,
  charity_id uuid references public.charity_profiles(id) on delete set null,
  source_type public.eco_impact_source not null,
  source_id uuid not null,
  occurred_at timestamptz not null default now(),
  food_saved_kg numeric(12,3) not null default 0 check (food_saved_kg >= 0),
  co2_avoided_kg numeric(12,3) not null default 0 check (co2_avoided_kg >= 0),
  water_saved_liters numeric(12,2) not null default 0 check (water_saved_liters >= 0),
  meals_equivalent integer not null default 0 check (meals_equivalent >= 0),
  money_saved_cents integer not null default 0 check (money_saved_cents >= 0),
  calculation_method text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists idx_eco_impact_events_actor_time on public.eco_impact_events(actor_id, occurred_at desc);
create index if not exists idx_eco_impact_events_store_time on public.eco_impact_events(store_id, occurred_at desc);
create index if not exists idx_eco_impact_events_charity_time on public.eco_impact_events(charity_id, occurred_at desc);
create index if not exists idx_eco_impact_events_source on public.eco_impact_events(source_type, source_id);
create index if not exists idx_eco_impact_events_occurred_at on public.eco_impact_events(occurred_at desc);

alter table public.eco_impact_factors enable row level security;
alter table public.eco_impact_events enable row level security;

drop policy if exists eco_impact_factors_public_select on public.eco_impact_factors;
create policy eco_impact_factors_public_select on public.eco_impact_factors for select using (true);

drop policy if exists eco_impact_factors_admin_modify on public.eco_impact_factors;
create policy eco_impact_factors_admin_modify on public.eco_impact_factors for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists eco_impact_events_scoped_select on public.eco_impact_events;
create policy eco_impact_events_scoped_select on public.eco_impact_events for select using (
  actor_id = auth.uid()
  or (store_id is not null and public.owns_store(store_id))
  or (charity_id is not null and public.owns_charity(charity_id))
  or public.is_admin()
);

drop policy if exists eco_impact_events_admin_insert on public.eco_impact_events;
create policy eco_impact_events_admin_insert on public.eco_impact_events for insert
  with check (public.is_admin());

drop policy if exists eco_impact_events_admin_update on public.eco_impact_events;
create policy eco_impact_events_admin_update on public.eco_impact_events for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists eco_impact_events_admin_delete on public.eco_impact_events;
create policy eco_impact_events_admin_delete on public.eco_impact_events for delete
  using (public.is_admin());
