-- 005: annual income targets + prior-year tax for projection & safe harbor

alter table settings add column if not exists expected_jreedconsults_income numeric(10,2) not null default 0;
alter table settings add column if not exists expected_dwm_income           numeric(10,2) not null default 0;
alter table settings add column if not exists prior_year_total_tax          numeric(10,2) not null default 0;
alter table settings add column if not exists prior_year_agi                numeric(10,2) not null default 0;
