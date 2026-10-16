-- ==============================================================================
-- Plant!p (플랜팁) 완전 영구 보존 스키마
-- 계정 정보(리프, 칭호, 상점 구매내역, 출석, 물주기, 도감) 영구 저장
-- Supabase 대시보드 -> SQL Editor 에서 전체 복사 후 실행(Run)하세요.
-- ==============================================================================

-- 1. 유저 프로필 테이블 (리프 잔액, 상점 보유 아이템, 칭호, 아바타 등 영구 보관)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  nickname text not null default '새싹 식집사',
  avatar_emoji text not null default '🌱',
  title text not null default '새싹',
  leaf_balance integer not null default 50, -- 기본 50 리프
  streak_count integer not null default 1,
  last_checkin_date date,
  owned_items jsonb not null default '[]'::jsonb, -- 상점 구매한 아이템/칭호 ID 목록
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 기존 테이블이 이미 있을 경우 컬럼 추가 보장
alter table public.profiles add column if not exists title text default '새싹';
alter table public.profiles add column if not exists owned_items jsonb default '[]'::jsonb;
alter table public.profiles add column if not exists leaf_balance integer default 50;
alter table public.profiles add column if not exists streak_count integer default 1;
alter table public.profiles add column if not exists last_checkin_date date;

alter table public.profiles enable row level security;

-- 본인 프로필 조회/생성/수정 정책
drop policy if exists " profiles: select own\ on public.profiles;
create policy \profiles: select own\ on public.profiles for select using (auth.uid() = id);

drop policy if exists \profiles: insert own\ on public.profiles;
create policy \profiles: insert own\ on public.profiles for insert with check (auth.uid() = id);

drop policy if exists \profiles: update own\ on public.profiles;
create policy \profiles: update own\ on public.profiles for update using (auth.uid() = id);

-- 2. 신규 가입 시 프로필 자동 생성 트리거 (가입 즉시 50리프와 기본 프로필 자동 생성)
create or replace function public.handle_new_user()
returns trigger as \$\$
begin
 insert into public.profiles (id, email, nickname, avatar_emoji, title, leaf_balance, streak_count, owned_items)
 values (
 new.id,
 new.email,
 '새싹 식집사',
 '🌱',
 '새싹',
 50,
 1,
 '[]'::jsonb
 )
 on conflict (id) do nothing;
 return new;
end;
\$\$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
 after insert on auth.users
 for each row execute procedure public.handle_new_user();

-- 기존에 이미 가입된 사용자들도 프로필 행 자동 생성
insert into public.profiles (id, email, nickname, avatar_emoji, title, leaf_balance, streak_count, owned_items)
select id, email, '새싹 식집사', '🌱', '새싹', 50, 1, '[]'::jsonb
from auth.users
on conflict (id) do nothing;

-- 3. 리프 트랜잭션 기록 테이블 (지갑 입출금 및 구매 내역)
create table if not exists public.leaf_transactions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 amount integer not null,
 reason text not null,
 balance_after integer not null,
 created_at timestamptz not null default now()
);

alter table public.leaf_transactions enable row level security;

drop policy if exists \leaf_transactions: select own\ on public.leaf_transactions;
create policy \leaf_transactions: select own\ on public.leaf_transactions for select using (auth.uid() = user_id);

drop policy if exists \leaf_transactions: insert own\ on public.leaf_transactions;
create policy \leaf_transactions: insert own\ on public.leaf_transactions for insert with check (auth.uid() = user_id);

-- 4. 스마트 물주기 스케줄 테이블
create table if not exists public.plant_watering_schedules (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 plant_name text not null,
 emoji text default '🌱',
 watering_interval_days integer not null default 7,
 last_watered_at timestamptz not null default now(),
 next_water_date date not null,
 notification_enabled boolean default true,
 created_at timestamptz not null default now()
);

alter table public.plant_watering_schedules enable row level security;

drop policy if exists \plant_watering_schedules: select own\ on public.plant_watering_schedules;
create policy \plant_watering_schedules: select own\ on public.plant_watering_schedules for select using (auth.uid() = user_id);

drop policy if exists \plant_watering_schedules: insert own\ on public.plant_watering_schedules;
create policy \plant_watering_schedules: insert own\ on public.plant_watering_schedules for insert with check (auth.uid() = user_id);

drop policy if exists \plant_watering_schedules: update own\ on public.plant_watering_schedules;
create policy \plant_watering_schedules: update own\ on public.plant_watering_schedules for update using (auth.uid() = user_id);

drop policy if exists \plant_watering_schedules: delete own\ on public.plant_watering_schedules;
create policy \plant_watering_schedules: delete own\ on public.plant_watering_schedules for delete using (auth.uid() = user_id);

-- 5. 나의 식물 도감 히스토리 테이블
create table if not exists public.plant_history (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 plant_name text not null,
 scientific_name text,
 true_percent integer,
 false_percent integer,
 emoji text,
 created_at timestamptz not null default now()
);

alter table public.plant_history enable row level security;

drop policy if exists \plant_history: select own\ on public.plant_history;
create policy \plant_history: select own\ on public.plant_history for select using (auth.uid() = user_id);

drop policy if exists \plant_history: insert own\ on public.plant_history;
create policy \plant_history: insert own\ on public.plant_history for insert with check (auth.uid() = user_id);

drop policy if exists \plant_history: delete own\ on public.plant_history;
create policy \plant_history: delete own\ on public.plant_history for delete using (auth.uid() = user_id);

-- 6. 식물 마스터 디렉토리 테이블
create table if not exists public.plant_directory (
 id uuid primary key default gen_random_uuid(),
 name text not null unique,
 scientific_name text,
 myth text,
 verdict boolean,
 true_percent integer,
 false_percent integer,
 belief_summary text,
 purchase_url text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

alter table public.plant_directory enable row level security;

drop policy if exists \plant_directory: read all\ on public.plant_directory;
create policy \plant_directory: read all\ on public.plant_directory for select using (true);
