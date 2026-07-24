-- 012: spouse S-Corp K-1 (pass-through profit/loss, not subject to SE tax)
-- Signed: positive for profit, negative for loss.
-- User is responsible for limiting entered losses to their basis;
-- we don't track basis calculations server-side.

alter table settings add column if not exists expected_spouse_scorp_k1 numeric(12,2) not null default 0;
