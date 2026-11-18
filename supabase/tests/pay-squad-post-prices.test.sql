-- What joining a squad post costs, from the server (U7, doc 28):
-- squad_post_price returns the pitch part as well as the share and the fee,
-- so the join screen never subtracts; pitch + fee = share in every mode.
-- squad_post_prices does the same for up to 50 posts at once (the "Need
-- players" cards), reading the posts as the caller (their RLS) and leaving
-- out any it can't price. No money moves.
begin;

create function tests.sp_post(p_booker uuid, p_booking uuid, p_venue uuid)
returns uuid language sql security definer set search_path = '' as $$
  insert into public.squad_posts (type, posted_by, venue_booking_id, venue_id, format)
  values ('players', p_booker, p_booking, p_venue, '5-a-side') returning id
$$;

-- 1. Every mode: pitch + fee = share, with the amounts the spec gives.
do $$
declare
  v_booker uuid := tests.create_user('sp-booker@futty.test');
  v_joiner uuid := tests.create_user('sp-joiner@futty.test');
  v_premium uuid := tests.create_user('sp-premium@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 4);
  v_day date := tests.cyprus_today() + 3;
  v_each uuid;
  v_resp uuid;
  v_all uuid;
  v_odd uuid;
  v_legacy uuid;
  v_b public.venue_bookings;
  r record;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.make_premium(v_premium);
  perform tests.act_as(v_booker);
  v_b := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_each := tests.sp_post(v_booker, v_b.id, v_venue);
  v_b := public.book_slot(v_venue, v_day, '13:00', '14:00', 1, '5-a-side', 5, 'each_pays_responsible');
  v_resp := tests.sp_post(v_booker, v_b.id, v_venue);
  v_b := public.book_slot(v_venue, v_day, '14:00', '15:00', 1, '5-a-side', 5, 'pay_all');
  v_all := tests.sp_post(v_booker, v_b.id, v_venue);
  v_b := public.book_slot(v_venue, v_day, '15:00', '16:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_odd := tests.sp_post(v_booker, v_b.id, v_venue);
  v_b := public.book_slot(v_venue, v_day, '16:00', '17:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_legacy := tests.sp_post(v_booker, v_b.id, v_venue);
  perform tests.act_as_postgres();
  -- €61.01 for the pitch: the joiner's pitch part rounds down (610), the
  -- booker carries the odd cent.
  update public.venue_bookings set amount_cents = 6101
  where id = (select venue_booking_id from public.squad_posts where id = v_odd);
  -- A booking from before P4a, with its fee kept apart.
  update public.venue_bookings set payment_mode = null, service_fee_cents_per_player = 80
  where id = (select venue_booking_id from public.squad_posts where id = v_legacy);

  perform tests.act_as(v_joiner);
  select * into r from public.squad_post_price(v_each);
  assert (r.pitch_cents, r.fee_cents, r.share_cents) = (600, 80, 680), format('each pays: 6.00 + 0.80 = 6.80, got %s', r);
  select * into r from public.squad_post_price(v_resp);
  assert (r.pitch_cents, r.fee_cents, r.share_cents) = (600, 80, 680), format('booker responsible: the same, got %s', r);
  select * into r from public.squad_post_price(v_all);
  assert (r.pitch_cents, r.fee_cents, r.share_cents) = (0, 0, 0), format('paid for everyone: nothing, got %s', r);
  select * into r from public.squad_post_price(v_odd);
  assert (r.pitch_cents, r.fee_cents, r.share_cents) = (610, 80, 690), format('6.10 + 0.80 = 6.90, got %s', r);
  select * into r from public.squad_post_price(v_legacy);
  assert (r.pitch_cents, r.fee_cents, r.share_cents) = (600, 80, 680), format('an older booking, got %s', r);

  perform tests.act_as(v_premium);
  select * into r from public.squad_post_price(v_each);
  assert r.pitch_cents = 600 and r.pitch_cents + r.fee_cents = r.share_cents,
    format('Premium: the pitch part is the same and the parts add up, got %s', r);

  -- pitch + fee = share for every post, whoever asks.
  foreach v_joiner in array array[v_joiner, v_premium, v_booker] loop
    perform tests.act_as(v_joiner);
    assert not exists (select 1 from unnest(array[v_each, v_resp, v_all, v_odd, v_legacy]) p,
                       lateral public.squad_post_price(p) x
                       where x.pitch_cents + x.fee_cents <> x.share_cents), 'the parts add up';
  end loop;
  perform tests.act_as_postgres();
end $$;

-- 2. The batch: the same answer as one at a time; posts it can't price left out.
do $$
declare
  v_booker uuid := tests.create_user('spb-booker@futty.test');
  v_joiner uuid := tests.create_user('spb-joiner@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 4);
  v_day date := tests.cyprus_today() + 3;
  v_posts uuid[] := '{}';
  v_cancelled uuid;
  v_free uuid;
  v_no_booking uuid;
  v_b public.venue_bookings;
  v_n integer;
  i integer;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_b := public.book_slot(v_venue, v_day, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_posts := v_posts || tests.sp_post(v_booker, v_b.id, v_venue);
  v_b := public.book_slot(v_venue, v_day, '13:00', '14:00', 1, '5-a-side', 5, 'pay_all');
  v_posts := v_posts || tests.sp_post(v_booker, v_b.id, v_venue);
  v_b := public.book_slot(v_venue, v_day, '14:00', '15:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_cancelled := tests.sp_post(v_booker, v_b.id, v_venue);
  perform tests.act_as_postgres();
  update public.venue_bookings set status = 'cancelled'
  where id = (select venue_booking_id from public.squad_posts where id = v_cancelled);
  perform tests.act_as(v_booker);
  v_b := public.book_slot(v_venue, v_day, '15:00', '16:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_free := tests.sp_post(v_booker, v_b.id, v_venue);
  perform tests.act_as_postgres();
  -- A free game: nothing to show.
  update public.venue_bookings set amount_cents = 0 where id = v_b.id;
  insert into public.squad_posts (type, posted_by, venue_id, format)
  values ('players', v_booker, v_venue, '5-a-side') returning id into v_no_booking;

  perform tests.act_as(v_joiner);
  assert (select count(*) from public.squad_post_prices(
            v_posts || array[v_cancelled, v_free, v_no_booking, gen_random_uuid(), v_posts[1]])) = 2,
    'only the two posts with a price, each once';
  assert not exists (
    select 1 from public.squad_post_prices(v_posts) b, lateral public.squad_post_price(b.post_id) s
    where (b.share_cents, b.fee_cents, b.pitch_cents) is distinct from (s.share_cents, s.fee_cents, s.pitch_cents)),
    'each matches squad_post_price';
  assert (select count(*) from public.squad_post_prices('{}')) = 0, 'none asked, none given';
  assert (select count(*) from public.squad_post_prices(null)) = 0, 'null: none';

  -- At most 50 at once.
  select count(*) into v_n from public.squad_post_prices(array(select v_posts[1] from generate_series(1, 50)));
  assert v_n = 1, '50 ids are fine';
  assert tests.error_of(format('select * from public.squad_post_prices(%L::uuid[])',
                               array(select gen_random_uuid() from generate_series(1, 51))))
         = 'too_many_posts', '51 are refused';
  perform tests.act_as_postgres();
end $$;

-- 3. Who can ask: signed in only; the batch reads posts as the caller, so
-- their RLS decides which posts they see.
do $$
declare
  v_def boolean;
begin
  perform tests.act_as_anon();
  assert tests.error_of('select * from public.squad_post_prices(''{}''::uuid[])') like 'permission denied%',
    'signed out: no prices';
  assert tests.error_of(format('select * from public.squad_post_price(%L)', gen_random_uuid())) like 'permission denied%',
    'signed out: no price';
  perform tests.act_as_postgres();
  select prosecdef into v_def from pg_proc where oid = 'public.squad_post_prices(uuid[])'::regprocedure;
  assert not v_def, 'security invoker: squad_posts is read under the caller''s RLS';
  assert (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.squad_post_prices(uuid[])'::regprocedure),
    'empty search_path';
  assert has_function_privilege('authenticated', 'public.squad_post_price(uuid)', 'execute')
         and has_function_privilege('authenticated', 'public.squad_post_prices(uuid[])', 'execute'), 'signed in: yes';
end $$;

-- 4. Under RLS: a policy that hides a post hides its price too.
do $$
declare
  v_booker uuid := tests.create_user('spr-booker@futty.test');
  v_joiner uuid := tests.create_user('spr-joiner@futty.test');
  v_venue uuid := tests.create_venue(p_pitches => 2);
  v_shown uuid;
  v_hidden uuid;
  v_b public.venue_bookings;
begin
  perform tests.set_price(v_venue, '5-a-side', 6000);
  perform tests.act_as(v_booker);
  v_b := public.book_slot(v_venue, tests.cyprus_today() + 3, '12:00', '13:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_shown := tests.sp_post(v_booker, v_b.id, v_venue);
  v_b := public.book_slot(v_venue, tests.cyprus_today() + 3, '13:00', '14:00', 1, '5-a-side', 5, 'each_pays_own_spot');
  v_hidden := tests.sp_post(v_booker, v_b.id, v_venue);
  perform tests.act_as_postgres();
  -- Inside this test's transaction only: narrow the read policy.
  alter policy "Authenticated users can read squad posts" on public.squad_posts
    using (id <> current_setting('tests.hidden_post')::uuid);
  perform set_config('tests.hidden_post', v_hidden::text, true);

  perform tests.act_as(v_joiner);
  assert (select array_agg(post_id) from public.squad_post_prices(array[v_shown, v_hidden])) = array[v_shown],
    'a post the caller can''t see has no price in the batch';
  perform tests.act_as_postgres();
end $$;

select 'pay squad post prices passed' as result;

rollback;
