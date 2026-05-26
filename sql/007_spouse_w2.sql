-- 007: spouse W-2 income for bracket stacking (assumes spouse covers her own withholding/estimates)

alter table settings add column if not exists expected_spouse_w2_income numeric(10,2) not null default 0;
