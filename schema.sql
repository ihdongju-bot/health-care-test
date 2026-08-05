-- ---------------------------------------------------------------------
-- 헬스케어 앱 데이터베이스 스키마 (Supabase / PostgreSQL)
-- 적용 방법: Supabase 프로젝트 대시보드 → SQL Editor → 이 파일 내용 붙여넣고 실행
-- ---------------------------------------------------------------------

-- 1) 식사 기록 테이블
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,                 -- YYYY-MM-DD
  name text not null,
  quantity text not null default '1인분',
  calories integer not null default 0,
  carbs integer not null default 0,   -- g
  protein integer not null default 0, -- g
  fat integer not null default 0,     -- g
  created_at timestamptz not null default now()
);

-- 2) 운동 기록 테이블
create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,                 -- YYYY-MM-DD
  name text not null,
  sets integer not null default 0,
  weight numeric not null default 0,  -- kg
  reps integer not null default 0,
  created_at timestamptz not null default now()
);

-- 3) 목표 설정 테이블 (사용자당 1행)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal_type text not null default 'maintain' check (goal_type in ('loss', 'maintain', 'gain')),
  weight_kg numeric not null default 70,
  display_name text,                  -- 랭킹/챌린지에 표시할 닉네임 (비워두면 "익명 유저"로 표시)
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 조회 성능을 위한 인덱스
-- ---------------------------------------------------------------------
create index if not exists meals_user_date_idx on public.meals (user_id, date);
create index if not exists workouts_user_date_idx on public.workouts (user_id, date);

-- ---------------------------------------------------------------------
-- Row Level Security (RLS): 각 사용자는 자기 데이터만 읽고 쓸 수 있음
-- ---------------------------------------------------------------------
alter table public.meals enable row level security;
alter table public.workouts enable row level security;
alter table public.profiles enable row level security;

create policy "meals: 본인 데이터만 조회" on public.meals
  for select using (auth.uid() = user_id);
create policy "meals: 본인 데이터만 추가" on public.meals
  for insert with check (auth.uid() = user_id);
create policy "meals: 본인 데이터만 삭제" on public.meals
  for delete using (auth.uid() = user_id);

create policy "workouts: 본인 데이터만 조회" on public.workouts
  for select using (auth.uid() = user_id);
create policy "workouts: 본인 데이터만 추가" on public.workouts
  for insert with check (auth.uid() = user_id);
create policy "workouts: 본인 데이터만 삭제" on public.workouts
  for delete using (auth.uid() = user_id);

create policy "profiles: 본인 데이터만 조회" on public.profiles
  for select using (auth.uid() = user_id);
create policy "profiles: 본인 데이터만 추가" on public.profiles
  for insert with check (auth.uid() = user_id);
create policy "profiles: 본인 데이터만 수정" on public.profiles
  for update using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 소셜 랭킹(주간 운동 챌린지): 개인 기록 row는 절대 노출하지 않고
-- "이번 주 운동 횟수" 집계값 + 닉네임만 안전하게 반환하는 함수입니다.
-- SECURITY DEFINER로 실행되어 RLS를 우회하지만, 반환 컬럼 자체가
-- 집계된 순위 정보뿐이라 개인 식단/운동 디테일은 노출되지 않습니다.
-- ---------------------------------------------------------------------
create or replace function public.get_weekly_leaderboard()
returns table(display_name text, workout_count bigint)
language sql
security definer
set search_path = public
as $$
  select coalesce(nullif(p.display_name, ''), '익명 유저') as display_name,
         count(w.id) as workout_count
  from public.workouts w
  join public.profiles p on p.user_id = w.user_id
  where w.date >= (current_date - interval '6 days')::date
  group by p.user_id, p.display_name
  order by workout_count desc
  limit 20;
$$;

grant execute on function public.get_weekly_leaderboard() to authenticated;

-- ---------------------------------------------------------------------
-- 커뮤니티: 사진 게시글 + 댓글
-- 커뮤니티는 "전체 공개 피드" 성격이라 다른 테이블과 달리 조회는 모든
-- 로그인 사용자에게 열려 있고, 수정/삭제만 작성자 본인으로 제한합니다.
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '익명 유저', -- 작성 시점의 닉네임 스냅샷 (조인 없이 바로 표시)
  image_url text not null,
  caption text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '익명 유저', -- 작성 시점의 닉네임 스냅샷
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists comments_post_id_idx on public.comments (post_id, created_at);

alter table public.posts enable row level security;
alter table public.comments enable row level security;

create policy "posts: 로그인 사용자 전체 조회" on public.posts
  for select using (auth.role() = 'authenticated');
create policy "posts: 본인 게시글만 추가" on public.posts
  for insert with check (auth.uid() = user_id);
create policy "posts: 본인 게시글만 삭제" on public.posts
  for delete using (auth.uid() = user_id);

create policy "comments: 로그인 사용자 전체 조회" on public.comments
  for select using (auth.role() = 'authenticated');
create policy "comments: 본인 댓글만 추가" on public.comments
  for insert with check (auth.uid() = user_id);
create policy "comments: 본인 댓글만 삭제" on public.comments
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 커뮤니티 사진 업로드용 Storage 버킷
-- 버킷은 public read로 설정해 이미지 URL을 바로 img src로 쓸 수 있게 하고,
-- 업로드/삭제는 로그인 사용자 + 본인 폴더로만 제한합니다.
-- (경로 규칙: {user_id}/{파일명})
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;

create policy "post-images: 누구나 읽기"
  on storage.objects for select
  using (bucket_id = 'post-images');

create policy "post-images: 로그인 사용자만 본인 폴더에 업로드"
  on storage.objects for insert
  with check (bucket_id = 'post-images' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "post-images: 본인 파일만 삭제"
  on storage.objects for delete
  using (bucket_id = 'post-images' and auth.uid()::text = (storage.foldername(name))[1]);
