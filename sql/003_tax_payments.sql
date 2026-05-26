-- 003_tax_payments.sql — quarterly estimated tax payments
-- Federal (IRS 1040-ES) and California (FTB 540-ES).

create table if not exists tax_payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  payment_date  date not null,
  amount        numeric(10,2) not null,
  jurisdiction  text not null,        -- 'federal' or 'state'
  tax_year      integer not null,     -- which tax year the payment counts toward
  quarter       integer,              -- 1-4, null for off-quarter / catch-up payments
  confirmation  text,                 -- IRS EFTPS / CA FTB confirmation number
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists tax_payments_user_idx on tax_payments(user_id, payment_date desc);
alter table tax_payments enable row level security;
