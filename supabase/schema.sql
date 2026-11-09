-- MMI Jar System database
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- Every table has Row Level Security: each user only sees and edits their own rows.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  budget numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.jars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  short text not null default '',
  pct numeric(5,2) not null default 0 check (pct >= 0 and pct <= 100),
  color text not null default '#4c7dff',
  archived boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  jar_id uuid references public.jars(id) on delete set null,
  title text not null default '',
  amount numeric(14,2) not null check (amount > 0),
  date date not null default current_date,
  category text,
  method text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists jars_user_idx on public.jars(user_id);
create index if not exists tx_user_date_idx on public.transactions(user_id, date desc);

alter table public.profiles enable row level security;
alter table public.jars enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own jars" on public.jars;
create policy "own jars" on public.jars
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Let signed-in users reach these tables through the API (RLS above still limits them to their own rows).
grant select, insert, update, delete on public.profiles, public.jars, public.transactions to authenticated;
