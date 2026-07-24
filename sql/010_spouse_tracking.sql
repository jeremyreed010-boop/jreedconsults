-- 010: track spouse SE income + spouse W-2 withholding + who paid each estimate
-- Idempotent: safe to re-run.

alter table settings add column if not exists expected_spouse_w2_income                  numeric(10,2) not null default 0;
alter table settings add column if not exists expected_spouse_w2_federal_withholding     numeric(10,2) not null default 0;
alter table settings add column if not exists expected_spouse_w2_state_withholding       numeric(10,2) not null default 0;
alter table settings add column if not exists expected_spouse_se_income                  numeric(10,2) not null default 0;
alter table settings add column if not exists expected_spouse_se_expenses                numeric(10,2) not null default 0;

alter table tax_payments add column if not exists payer text not null default 'self';
do $$ begin
  alter table tax_payments add constraint tax_payments_payer_check check (payer in ('self', 'spouse'));
exception when duplicate_object then null;
end $$;
create index if not exists tax_payments_user_payer_idx on tax_payments(user_id, payer);
