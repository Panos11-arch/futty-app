-- Premium costs €4.99 a month (decided by Panos on 22 November; spec 13
-- "Premium"). Until now app_rules said €3.99, the price agreed on 7
-- November. The app shows the store's own price once it has loaded and falls
-- back to this label; the terms, the website and the Futty AI's answers read
-- it. app_rules_record_change keeps the old value in app_rules_history.
alter table public.app_rules alter column premium_price_label set default '€4.99';
update public.app_rules set premium_price_label = '€4.99' where premium_price_label = '€3.99';
