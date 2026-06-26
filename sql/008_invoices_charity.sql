-- 008: invoices, invoice line items, charitable contributions

-- Invoices: client-facing bills issued by jreedconsults LLC.
-- Status flow: draft -> sent -> paid (or void).
create table if not exists invoices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  invoice_number  text not null,
  client_name     text not null,
  client_email    text,
  client_address  text,
  issue_date      date not null,
  due_date        date,
  status          text not null default 'draft',  -- draft | sent | paid | void
  notes           text,
  subtotal        numeric(10,2) not null default 0,
  tax_rate        numeric(5,2) not null default 0,   -- percent, e.g. 8.75
  tax_amount      numeric(10,2) not null default 0,
  total           numeric(10,2) not null default 0,
  sent_at         timestamptz,
  paid_at         timestamptz,
  paid_amount     numeric(10,2),
  created_at      timestamptz not null default now(),
  unique (user_id, invoice_number)
);
create index if not exists invoices_user_idx on invoices(user_id, issue_date desc);
alter table invoices enable row level security;

-- Line items for each invoice
create table if not exists invoice_line_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  position    integer not null default 0,
  description text not null,
  quantity    numeric(10,2) not null default 1,
  unit_price  numeric(10,2) not null default 0,
  amount      numeric(10,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists invoice_line_items_invoice_idx on invoice_line_items(invoice_id, position);
alter table invoice_line_items enable row level security;

-- Charitable contributions: Schedule A itemized deductions (personal), NOT
-- Schedule C business deductions. Tracked separately so they don't inflate
-- business net income or feed into SE-tax projections.
create table if not exists charitable_contributions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references auth.users(id) on delete cascade,
  contribution_date  date not null,
  recipient          text not null,
  amount             numeric(10,2) not null,
  contribution_type  text not null default 'cash',  -- cash | goods | stock | mileage
  tax_year           integer not null,
  receipt_url        text,
  notes              text,
  created_at         timestamptz not null default now()
);
create index if not exists charity_user_idx on charitable_contributions(user_id, contribution_date desc);
alter table charitable_contributions enable row level security;
