-- B1a (Booking v2, rule 8; spec 13 "Choosing a pitch"): players choose their
-- pitch. venue_free_pitches lists the free pitches and the venue's own
-- combinations for a time, with the server's price; book_slot takes the
-- chosen one and checks it belongs to the venue, fits the format, is open
-- and free. A Booking v2 call (p_kind) refuses "Just my spot". Older app
-- builds (no p_kind, no p_pitch_ids) book exactly as before.
begin;

create function tests.b1a_setup(out venue uuid, out p1 uuid, out p2 uuid, out p3 uuid, out booker uuid, out other uuid)
language plpgsql
as $$
begin
  booker := tests.create_user('b1a-booker-' || gen_random_uuid() || '@futty.test');
  other := tests.create_user('b1a-other-' || gen_random_uuid() || '@futty.test');
  venue := tests.create_venue(p_pitches => 0);
  p1 := tests.create_pitch(venue, 'Pitch 1', '5-a-side', null, 1);
  p2 := tests.create_pitch(venue, 'Pitch 2', '5-a-side', null, 2);
  p3 := tests.create_pitch(venue, 'Pitch 3', '7-a-side', null, 3);
  update public.pitches set surface = 'artificial grass', indoor = false where id in (p1, p2);
  update public.pitches set surface = 'grass', indoor = true where id = p3;
  insert into public.pitch_combinations (venue_id, format, pitch_ids) values (venue, '7-a-side', array[p1, p2]);
  perform tests.set_price(venue, '5-a-side', 4000);
  perform tests.set_price(venue, '7-a-side', 5600);
end;
$$;

create function tests.b1a_free(p_venue uuid, p_who uuid, p_day date, p_format text, p_start time default '12:00')
returns table (label text, pitch_ids uuid[], kind text, surface text, indoor boolean, price_cents integer)
language plpgsql
as $$
begin
  perform tests.act_as(p_who);
  return query select f.label, f.pitch_ids, f.kind, f.surface, f.indoor, f.price_cents
               from public.venue_free_pitches(p_venue, p_day, p_start, p_start + interval '1 hour', p_format) f;
  perform tests.act_as_postgres();
end;
$$;

create function tests.b1a_book(p_venue uuid, p_who uuid, p_day date, p_format text, p_pitches uuid[],
                               p_mode text default 'pay_all', p_kind text default 'whole', p_start time default '12:00')
returns public.venue_bookings
language plpgsql
as $$
declare
  v_booking public.venue_bookings;
begin
  perform tests.act_as(p_who);
  v_booking := public.book_slot(p_venue, p_day, p_start, p_start + interval '1 hour', 1, p_format, 5, p_mode,
                                p_pitch_ids => p_pitches, p_kind => p_kind);
  perform tests.act_as_postgres();
  return v_booking;
end;
$$;

-- What a failed call raised: the message, and the detail when there is one.
create function tests.b1a_error(p_sql text)
returns text
language plpgsql
as $$
declare
  v_message text;
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_message = message_text, v_detail = pg_exception_detail;
  return v_message || coalesce(' | ' || nullif(v_detail, ''), '');
end;
$$;

-- 1. The free pitches for a time: the venue's names, surface, indoor or
--    outdoor and the server's price; a bigger format only through the
--    venue's own combination, labelled "Pitch 1 + 2". The first is the one
--    book_slot would pick by itself.
do $$
declare
  s record;
  v_day date := tests.cyprus_today() + 2;
  v_rows text;
begin
  s := tests.b1a_setup();
  select string_agg(format('%s/%s/%s/%s/%s', label, kind, surface, indoor, price_cents), '; ')
    into v_rows from tests.b1a_free(s.venue, s.booker, v_day, '5-a-side');
  assert v_rows = 'Pitch 1/pitch/artificial grass/f/4000; Pitch 2/pitch/artificial grass/f/4000',
    format('5s: %s', v_rows);
  select string_agg(format('%s/%s/%s/%s', label, kind, indoor, price_cents), '; ')
    into v_rows from tests.b1a_free(s.venue, s.booker, v_day, '7-a-side');
  assert v_rows = 'Pitch 3/pitch/t/5600; Pitch 1 + 2/combination/f/5600', format('7s: %s', v_rows);
  assert (select pitch_ids from tests.b1a_free(s.venue, s.booker, v_day, '5-a-side') limit 1)
         = public.pick_pitches(s.venue, v_day, '12:00', '13:00', '5-a-side'), 'the first is the automatic pick';
  -- No combination data: that format isn't offered.
  assert not exists (select 1 from tests.b1a_free(s.venue, s.booker, v_day, '9-a-side')), 'no 9s without a combination';
end $$;

-- 2. Booking the chosen pitch; once taken it isn't listed, and booking it
--    again says which pitch is no longer free.
do $$
declare
  s record;
  v_day date := tests.cyprus_today() + 2;
  v_booking public.venue_bookings;
begin
  s := tests.b1a_setup();
  v_booking := tests.b1a_book(s.venue, s.booker, v_day, '5-a-side', array[s.p2]);
  assert (select array_agg(pitch_id) from public.booking_pitches where booking_id = v_booking.id) = array[s.p2],
    'the chosen pitch is booked, not the first free one';
  assert v_booking.booking_kind = 'whole', 'a Booking v2 whole-pitch booking';
  assert (select string_agg(label, '; ') from tests.b1a_free(s.venue, s.other, v_day, '5-a-side')) = 'Pitch 1',
    'the taken pitch is hidden';
  assert (select string_agg(label, '; ') from tests.b1a_free(s.venue, s.other, v_day, '7-a-side')) = 'Pitch 3',
    'a combination with a taken pitch is hidden';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L]::uuid[])',
                                s.venue, s.other, v_day, s.p2)) = 'pitch_not_free | Pitch 2',
    'Pitch 2 is no longer free';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''7-a-side'', array[%L, %L]::uuid[])',
                                s.venue, s.other, v_day, s.p1, s.p2)) = 'pitch_not_free | Pitch 1 + 2',
    'the combination is no longer free either';
  -- Its label for the booking screens.
  perform tests.act_as(s.booker);
  assert public.booking_pitch_label(v_booking.id) = 'Pitch 2', 'the booking shows its pitch name';
  perform tests.act_as_postgres();
end $$;

-- 3. A combination blocks its member pitches, and the reverse.
do $$
declare
  s record;
  v_day date := tests.cyprus_today() + 3;
  v_booking public.venue_bookings;
begin
  s := tests.b1a_setup();
  v_booking := tests.b1a_book(s.venue, s.booker, v_day, '7-a-side', array[s.p2, s.p1]);
  assert (select count(*) from public.booking_pitches where booking_id = v_booking.id) = 2, 'both pitches held';
  perform tests.act_as(s.booker);
  assert public.booking_pitch_label(v_booking.id) = 'Pitch 1 + 2', 'combination label';
  perform tests.act_as_postgres();
  assert not exists (select 1 from tests.b1a_free(s.venue, s.other, v_day, '5-a-side')), 'no 5s left';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L]::uuid[])',
                                s.venue, s.other, v_day, s.p1)) = 'pitch_not_free | Pitch 1',
    'a member of a booked combination is not free';
end $$;

-- 4. Refused choices: another venue's pitch, a pitch that doesn't host the
--    format, two pitches that aren't a combination of that venue, a closed
--    pitch, a blocked pitch, and a 6 v 6 on a 7-a-side pitch.
do $$
declare
  s record;
  o record;
  v_day date := tests.cyprus_today() + 2;
begin
  s := tests.b1a_setup();
  o := tests.b1a_setup();
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L]::uuid[])',
                                s.venue, s.booker, v_day, o.p1)) = 'invalid_pitch_choice', 'another venue''s pitch';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''7-a-side'', array[%L]::uuid[])',
                                s.venue, s.booker, v_day, s.p1)) = 'invalid_pitch_choice', 'a 5 for a 7-a-side';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L, %L]::uuid[])',
                                s.venue, s.booker, v_day, s.p1, s.p2)) = 'invalid_pitch_choice', 'not a 5s combination';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''7-a-side'', array[%L, %L]::uuid[])',
                                s.venue, s.booker, v_day, s.p1, s.p3)) = 'invalid_pitch_choice', 'not a venue combination';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[]::uuid[])',
                                s.venue, s.booker, v_day)) = 'invalid_pitch_choice', 'an empty choice';
  update public.pitches set is_open = false where id = s.p2;
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L]::uuid[])',
                                s.venue, s.booker, v_day, s.p2)) = 'invalid_pitch_choice', 'a closed pitch';
  assert (select string_agg(label, '; ') from tests.b1a_free(s.venue, s.booker, v_day, '5-a-side')) = 'Pitch 1',
    'a closed pitch isn''t listed';
  insert into public.venue_blocks (venue_id, pitch_id, block_day) values (s.venue, s.p1, v_day);
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L]::uuid[])',
                                s.venue, s.booker, v_day, s.p1)) = 'slot_blocked', 'a blocked pitch';
  assert not exists (select 1 from tests.b1a_free(s.venue, s.booker, v_day, '5-a-side')), 'a blocked pitch isn''t listed';
end $$;

-- 5. Booking v2 refuses "Just my spot" and Losers pay on a whole pitch;
--    older builds (no p_kind) still book "Just my spot", with no pitch chosen.
do $$
declare
  s record;
  v_day date := tests.cyprus_today() + 2;
  v_old public.venue_bookings;
begin
  s := tests.b1a_setup();
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L]::uuid[], ''each_pays_own_spot'')',
                                s.venue, s.booker, v_day, s.p1)) = 'just_my_spot_removed', 'Just my spot refused';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L]::uuid[], ''gipedo_pano'')',
                                s.venue, s.booker, v_day, s.p1)) = 'losers_pay_half_pitch_only', 'Losers pay is half pitch only';
  assert tests.b1a_error(format('select tests.b1a_book(%L, %L, %L, ''5-a-side'', array[%L]::uuid[], ''pay_all'', ''quarter'')',
                                s.venue, s.booker, v_day, s.p1)) = 'invalid_booking_kind', 'an unknown kind';
  perform tests.act_as(s.booker);
  v_old := public.book_slot(s.venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  perform tests.act_as_postgres();
  assert v_old.booking_kind is null and v_old.payment_mode = 'each_pays_own_spot', 'an older build books as before';
  assert (select count(*) from public.booking_pitches where booking_id = v_old.id) = 1, 'a pitch picked for it';
end $$;

-- 6. Anyone signed in can list free pitches; anon can't; booking_pitch_label
--    follows who can see the booking.
do $$
declare
  s record;
  v_day date := tests.cyprus_today() + 2;
  v_booking public.venue_bookings;
begin
  s := tests.b1a_setup();
  assert not has_function_privilege('anon', 'public.venue_free_pitches(uuid, date, time, time, text, integer)', 'execute'),
    'not for anon';
  v_booking := tests.b1a_book(s.venue, s.booker, v_day, '5-a-side', array[s.p1]);
  perform tests.act_as(s.other);
  assert public.booking_pitch_label(v_booking.id) is null, 'someone else''s booking: no label';
  perform tests.act_as_postgres();
end $$;

select 'pay b1a choose pitch passed' as result;

rollback;
