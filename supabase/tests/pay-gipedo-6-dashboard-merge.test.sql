-- P8 (Gipedo Pano) and P6 (venue dashboard) both changed four functions;
-- 20261115170000_pay_gipedo_dashboard_merge.sql keeps both sets of changes.
-- This fails if a later migration copies one side over the other again.
-- The behaviour itself is tested in pay-gipedo-* and pay-dashboard-*.

begin;

do $$
declare
  def text;
begin
  def := pg_get_functiondef('public.cancellation_plan(uuid, text, uuid, timestamptz)'::regprocedure);
  assert position('use_gipedo_pull_out' in def) > 0 and position('cancellation_plan_modes' in def) > 0,
    'cancellation_plan is P8''s Gipedo Pano wrapper';
  def := pg_get_functiondef('public.cancellation_plan_modes(uuid, text, uuid, timestamptz)'::regprocedure);
  assert position('cash_credit_cents' in def) > 0, 'the plan behind it has P6''s ticked cash';

  def := pg_get_functiondef('public.cancel_booking_internal(uuid, text, uuid, text)'::regprocedure);
  assert position('gipedo_settlements' in def) > 0 and position('cancel_booking_internal_modes' in def) > 0,
    'cancel_booking_internal is P8''s wrapper';
  def := pg_get_functiondef('public.cancel_booking_internal_modes(uuid, text, uuid, text)'::regprocedure);
  assert position('counter_booking' in def) > 0 and position('reverse_cash_received' in def) > 0,
    'the cancel behind it refuses counter bookings and hands back ticked cash (P6)';

  def := pg_get_functiondef('public.booking_detail(uuid)'::regprocedure);
  assert position('booking_detail_modes' in def) > 0 and position('gipedo' in def) > 0,
    'booking_detail is P8''s wrapper';
  def := pg_get_functiondef('public.booking_detail_modes(uuid)'::regprocedure);
  assert position('counter_booking' in def) > 0, 'the detail behind it refuses counter bookings (P6)';

  def := pg_get_functiondef('public.add_booking_share_internal(uuid, uuid)'::regprocedure);
  assert position('gipedo_pano' in def) > 0, 'a player joining a Gipedo Pano booking plays covered (P8)';
  assert position('counter_booking' in def) > 0, 'and a counter booking is refused (P6)';
end $$;

select 'pay gipedo 6 (dashboard merge) passed' as result;

rollback;
