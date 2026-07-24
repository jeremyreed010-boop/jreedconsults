-- 011: split prior-year total tax into federal + CA for per-agency safe harbor floors

alter table settings add column if not exists prior_year_federal_tax numeric(10,2) not null default 0;
alter table settings add column if not exists prior_year_ca_tax      numeric(10,2) not null default 0;

-- Backfill: if existing prior_year_total_tax is populated but the new columns aren't,
-- treat the old value as federal (that was the common misread).
update settings
   set prior_year_federal_tax = prior_year_total_tax
 where prior_year_federal_tax = 0
   and prior_year_total_tax > 0;
