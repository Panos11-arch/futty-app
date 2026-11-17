-- P7: the release (docs/specs/05-product.md section 12, "Before the app
-- reaches anyone outside the founders, unsigned venues are switched off";
-- 14, P7; decided 16 November).
--
--   venues.signed_at          when the venue signed with Futty; set only by
--                             service_role (Panos), per venue
--   release_unlive_unsigned() switches is_live off for every venue that
--                             hasn't signed; returns how many
--   release_check()           what's still wrong before submitting: an
--                             unsigned venue that is live, a missing demo
--                             account (review@futty.app), or the demo
--                             account unable to get a server quote at a
--                             signed venue (checkout's booking_quote)
-- Panos runs both through scripts/release/; nothing here touches data.

alter table public.venues add column signed_at timestamptz;
comment on column public.venues.signed_at is
  'P7: when the venue signed with Futty (set by service_role). Unsigned venues are switched off (is_live) before release.';

-- Only service_role (or the database itself) may set it, as payouts_from.
create or replace function public.venues_signed_at_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.signed_at is not null)
     or (tg_op = 'UPDATE' and new.signed_at is distinct from old.signed_at) then
    if coalesce(auth.role(), '') in ('authenticated', 'anon') then
      raise exception 'signed_at_service_role_only';
    end if;
  end if;
  return new;
end;
$$;
create trigger venues_signed_at_guard
  before insert or update of signed_at on public.venues
  for each row execute function public.venues_signed_at_guard();
revoke all on function public.venues_signed_at_guard() from public, anon, authenticated;

-- Switches off every venue that hasn't signed. Returns how many it switched.
create or replace function public.release_unlive_unsigned()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.venues set is_live = false where is_live and signed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Before each submission: { ok, problems: [...], quote }. A problem is
-- { problem, ... }:
--   unsigned_venue_live  a live venue that hasn't signed (venue_id, name)
--   no_signed_venue      no signed, live venue to quote at
--   demo_account_missing no account with the demo email
--   demo_cannot_quote    no signed venue gave the demo account a quote
-- The quote is checkout's own (booking_quote) for the first free slot in the
-- next week at a signed venue, asked as the demo account.
create or replace function public.release_check(p_demo_email text default 'review@futty.app')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problems jsonb := '[]'::jsonb;
  v_demo uuid;
  v_venue record;
  v_format text;
  v_day date;
  v_slot record;
  v_quote jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
begin
  select coalesce(jsonb_agg(jsonb_build_object('problem', 'unsigned_venue_live', 'venue_id', v.id, 'name', v.name)
                            order by v.name), '[]'::jsonb)
    into v_problems
  from public.venues v where v.is_live and v.signed_at is null;

  if not exists (select 1 from public.venues v where v.is_live and v.signed_at is not null) then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object('problem', 'no_signed_venue'));
  end if;

  select u.id into v_demo from auth.users u where lower(u.email) = lower(p_demo_email);
  if v_demo is null or not exists (select 1 from public.profiles p where p.id = v_demo) then
    v_problems := v_problems || jsonb_build_array(jsonb_build_object('problem', 'demo_account_missing', 'email', p_demo_email));
  else
    -- Ask as the demo account, as the app does.
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_demo, 'role', 'authenticated')::text, true);
    <<venues>>
    for v_venue in select v.id from public.venues v where v.is_live and v.signed_at is not null order by v.signed_at, v.id loop
      for v_format in select distinct p.size from public.pitches p where p.venue_id = v_venue.id order by 1 loop
        for v_day in select (now() at time zone 'Asia/Nicosia')::date + d from generate_series(0, 6) d loop
          for v_slot in select * from public.venue_free_slots(v_venue.id, v_day, v_format) loop
            begin
              v_quote := public.booking_quote(v_venue.id, v_day, v_slot.start_time, v_slot.end_time, v_format, 5);
            exception when others then
              v_quote := null;
            end;
            exit venues when v_quote is not null;
          end loop;
        end loop;
      end loop;
    end loop;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    if v_quote is null then
      v_problems := v_problems || jsonb_build_array(jsonb_build_object('problem', 'demo_cannot_quote', 'email', p_demo_email));
    end if;
  end if;

  return jsonb_build_object('ok', jsonb_array_length(v_problems) = 0, 'problems', v_problems, 'quote', v_quote);
end;
$$;

revoke all on function public.release_unlive_unsigned() from public, anon, authenticated;
revoke all on function public.release_check(text) from public, anon, authenticated;
grant execute on function public.release_unlive_unsigned() to service_role;
grant execute on function public.release_check(text) to service_role;
