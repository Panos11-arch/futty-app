-- P10: no database function keeps its own copy of a spec 13 number; they
-- read public.app_rules. Scans every live public function, so a later
-- migration can't bring a number back (the app and Edge Functions are
-- checked by tests/rules/no-hard-coded-rules.test.ts).
--
-- Not spec 13 rules, so not scanned for:
--   match record times (check-in 60 minutes, MOTM and result 24 hours,
--   reminders), retry back-offs, and the card-or-credit choice's working-day
--   wording. The patterns below are spec 13's numbers only.
begin;

do $$
declare
  v_hits text;
begin
  select string_agg(format('%s: %s', p.proname, m.hit), E'\n' order by p.proname)
  into v_hits
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral (
    select string_agg(distinct x[1], ', ') as hit
    from regexp_matches(
      -- Comments may still name the rules.
      regexp_replace(p.prosrc, '--[^\n]*', '', 'g'),
      '(interval ''(6|48|72|120|144) hours?''|interval ''15 minutes''|interval ''12 months''|14 else 7'
        || '|(less than|within|at least|by) (6|15|24|48) (hours|minutes)'
        || '|€0\.80|€0\.55|€1\.00|\y(80|55)\y|\y100 \*|\* 100\y|:= 100;)',
      'g') as x
  ) m
  where n.nspname = 'public'
    and m.hit is not null
    and p.proname not in (
      'init_venue_model_from_legacy',  -- euros to cents (x 100), a unit conversion
      'money_format_euros',            -- cents to euros (/ 100), formatting
      'money_backoff_at',              -- retry back-off (1, 5, 15, 60 minutes), not a spec 13 rule
      'money_release_retry_at'         -- retry back-off capped at 6 hours, not a spec 13 rule
    );

  assert v_hits is null, E'spec 13 numbers written into database functions (read them from app_rules):\n' || v_hits;
end $$;

-- The scan itself finds a copy (so the test can fail).
do $$
declare
  v_found boolean;
begin
  create function public.tests_probe_rule_copy() returns interval language sql as $f$ select interval '6 hours' $f$;
  select exists (
    select 1 from pg_proc p where p.proname = 'tests_probe_rule_copy'
      and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'interval ''(6|48|72|120|144) hours?'''
  ) into v_found;
  assert v_found, 'the scan pattern finds a planted copy';
end $$;

rollback;
