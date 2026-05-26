-- 002_add_tolls.sql — add tolls column to mileage trips
-- Bay Bridge + Carquinez Bridge on the Atherton route, plus any other business tolls.

alter table mileage add column if not exists tolls numeric(10,2) not null default 0;
