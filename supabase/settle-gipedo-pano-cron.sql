-- Schedules supabase/functions/settle-gipedo-pano every 10 minutes.
-- Replace <CRON_SECRET> with the same value set via
--   supabase secrets set CRON_SECRET=...
-- then run in the Supabase dashboard: SQL Editor > New query > Run.
-- Safe to re-run. Run AFTER supabase/gipedo-pano-payments.sql.

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'settle-gipedo-pano-payments';

  perform cron.schedule(
    'settle-gipedo-pano-payments',
    '*/10 * * * *',
    $sql$
    select net.http_post(
      url := 'https://ospztpemchfpvvostisw.supabase.co/functions/v1/settle-gipedo-pano',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
      body := '{}'::jsonb
    );
    $sql$
  );
exception when undefined_table or undefined_function or invalid_schema_name then
  raise notice 'pg_cron/pg_net not enabled — enable both under Database > Extensions, then re-run.';
end $$;
