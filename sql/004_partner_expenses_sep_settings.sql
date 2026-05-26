-- 004: partner pay, expenses, sep contributions, settings; business tag on mileage

-- DWM K-1 income: bi-weekly guaranteed payments to Jeremy as partner
create table if not exists partner_pay (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  pay_date    date not null,
  amount      numeric(10,2) not null,
  paid        boolean not null default true,
  paid_date   date,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists partner_pay_user_idx on partner_pay(user_id, pay_date desc);
alter table partner_pay enable row level security;

-- Generic out-of-pocket business expenses, tagged by business
create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  expense_date date not null,
  vendor       text,
  business     text not null default 'jreedconsults',  -- 'jreedconsults' or 'dwm'
  category     text,
  amount       numeric(10,2) not null,
  business_pct numeric(5,2) not null default 100,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists expenses_user_idx on expenses(user_id, expense_date desc);
alter table expenses enable row level security;

-- SEP IRA contributions log (per tax year)
create table if not exists sep_contributions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) on delete cascade,
  contribution_date  date not null,
  amount             numeric(10,2) not null,
  tax_year           integer not null,
  notes              text,
  created_at         timestamptz not null default now()
);
create index if not exists sep_user_idx on sep_contributions(user_id, contribution_date desc);
alter table sep_contributions enable row level security;

-- User-level settings (one row per user; recurring config that feeds dashboard/P&L)
create table if not exists settings (
  user_id                       uuid primary key references auth.users(id) on delete cascade,
  irs_mileage_rate              numeric(5,3) not null default 0.725,
  cell_monthly                  numeric(10,2) not null default 0,
  cell_jreedconsults_pct        numeric(5,2) not null default 25,
  cell_dwm_pct                  numeric(5,2) not null default 75,
  internet_monthly              numeric(10,2) not null default 0,
  internet_jreedconsults_pct    numeric(5,2) not null default 25,
  internet_dwm_pct              numeric(5,2) not null default 75,
  home_office_sqft              numeric(8,2) not null default 55,
  home_office_method            text not null default 'simplified',  -- 'simplified' or 'actual'
  home_office_actual_annual     numeric(10,2) not null default 0,
  home_office_jreedconsults_pct numeric(5,2) not null default 25,
  home_office_dwm_pct           numeric(5,2) not null default 75,
  filing_status                 text not null default 'single',       -- 'single' or 'mfj'
  updated_at                    timestamptz not null default now()
);
alter table settings enable row level security;

-- Tag existing and future mileage trips by business (default: jreedconsults for back-compat)
alter table mileage add column if not exists business text not null default 'jreedconsults';
