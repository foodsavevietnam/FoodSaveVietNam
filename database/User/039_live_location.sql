-- 039: Chia sẻ vị trí khi làm nhiệm vụ (người mua + tình nguyện viên) và chống dò OTP.
-- RLS bật, KHÔNG có policy cho anon/authenticated: chỉ backend (service role) đọc/ghi.

create table if not exists public.live_locations (
  actor_kind text not null check (actor_kind in ('volunteer', 'customer')),
  actor_id uuid not null,
  context_kind text not null check (context_kind in ('donation', 'order')),
  context_id uuid not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or (accuracy_m >= 0 and accuracy_m <= 2000)),
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_kind, actor_id),
  check (not (lat = 0 and lng = 0))
);

create index if not exists live_locations_updated_at_idx on public.live_locations (updated_at);
create index if not exists live_locations_context_idx on public.live_locations (context_kind, context_id);

create table if not exists public.location_consents (
  actor_kind text not null check (actor_kind in ('volunteer', 'customer')),
  actor_id uuid not null,
  granted boolean not null,
  policy_version text not null,
  decided_at timestamptz not null default now(),
  user_agent text,
  primary key (actor_kind, actor_id)
);

create table if not exists public.auth_otp_attempts (
  key text primary key,
  failed_count int not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.live_locations enable row level security;
alter table public.location_consents enable row level security;
alter table public.auth_otp_attempts enable row level security;

-- Đăng nhập OTP email cho TNV: signInWithOtp gửi kèm data.account_type = 'volunteer'.
-- Thay handle_new_user (chép nguyên từ database/Admin/014_admin_login_security.sql), chỉ thêm nhánh bỏ qua ở đầu.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
begin
  -- Auth user tạo khi TNV đăng nhập OTP email: không tạo profiles/customer_profiles
  -- (không thành tài khoản người mua; authMiddleware từ chối vì không có profile).
  -- Chỉ bỏ qua khi email thật sự thuộc một TNV: metadata do client tự đặt được, nên nếu không kiểm
  -- thì ai cũng "đặt trước" được email người khác thành auth user không có hồ sơ.
  if new.raw_user_meta_data ->> 'account_type' = 'volunteer'
     and exists (select 1 from public.volunteers v where lower(trim(v.email)) = lower(trim(new.email))) then
    return new;
  end if;

  requested_role := case
    when new.raw_user_meta_data ->> 'role' in ('customer', 'partner', 'charity')
      then (new.raw_user_meta_data ->> 'role')::public.user_role
    else 'customer'::public.user_role
  end;

  insert into public.profiles (id, role, email, full_name, phone, status, metadata)
  values (
    new.id, requested_role, lower(nullif(new.email, '')),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case when requested_role in ('partner', 'charity') then 'pending'::public.profile_status else 'active'::public.profile_status end,
    coalesce(new.raw_user_meta_data, '{}'::jsonb)
  ) on conflict (id) do update set role = excluded.role;

  if requested_role = 'customer' then
    insert into public.customer_profiles (profile_id, email, phone, display_name)
    values (new.id, lower(nullif(new.email, '')), nullif(new.raw_user_meta_data ->> 'phone', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
    on conflict do nothing;

  elsif requested_role = 'partner' then
    insert into public.partner_profiles (profile_id, email, phone, representative_name)
    values (new.id, lower(nullif(new.email, '')), nullif(new.raw_user_meta_data ->> 'phone', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''))
    on conflict do nothing;

  elsif requested_role = 'charity' then
    insert into public.charity_profiles (owner_id, email, phone, name, slug, address, status)
    values (
      new.id,
      -- charity_profiles.email là NOT NULL: đăng ký bằng số điện thoại (không có email) không được làm hỏng bước tạo tài khoản
      coalesce(lower(nullif(new.email, '')), ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'phone', ''), ''),
      coalesce(nullif(new.raw_user_meta_data ->> 'org_name', ''), 'Chưa cập nhật'),
      'charity-' || substr(md5(random()::text), 1, 8),
      'Chưa cập nhật',
      'pending'
    ) on conflict do nothing;
  end if;

  return new;
end;
$$;
