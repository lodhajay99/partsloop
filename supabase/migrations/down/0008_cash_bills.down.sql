alter table bills drop constraint if exists cash_bills_are_paid;
drop index if exists bills_shop_method_idx;
alter table transactions drop column if exists payment_method;
alter table bills drop column if exists payment_method;
