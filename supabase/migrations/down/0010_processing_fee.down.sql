alter table bills drop constraint if exists cash_bills_have_no_processing_fee;
alter table transactions drop column if exists processing_fee_paise;
alter table bills drop column if exists processing_fee_paise;
