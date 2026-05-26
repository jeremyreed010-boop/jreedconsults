-- 006: W-2 income from other job (affects tax bracket stacking + withholding credit)

alter table settings add column if not exists expected_w2_income              numeric(10,2) not null default 0;
alter table settings add column if not exists expected_w2_federal_withholding numeric(10,2) not null default 0;
alter table settings add column if not exists expected_w2_state_withholding   numeric(10,2) not null default 0;
