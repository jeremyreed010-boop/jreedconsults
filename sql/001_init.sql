-- J. Reed Consults LLC — initial schema
-- Run this in Supabase → SQL Editor (copy + paste, click Run).

-- Games: each weekly poker game (income)
create table if not exists games (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  game_date       date not null,
  gross_amount    numeric(10,2) not null default 1000,
  paid            boolean not null default false,
  paid_date       date,
  payment_method  text,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists games_user_date_idx on games(user_id, game_date desc);

-- Mileage: each business trip (largest deduction)
create table if not exists mileage (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade,
  trip_date  date not null,
  miles      numeric(8,1) not null,
  purpose    text,
  notes      text,
  created_at timestamptz not null default now()
);

create index if not exists mileage_user_date_idx on mileage(user_id, trip_date desc);

-- RLS on — server uses the service-role key, which bypasses RLS.
-- The anon key (exposed to the browser) gets no policies = no access.
alter table games   enable row level security;
alter table mileage enable row level security;
