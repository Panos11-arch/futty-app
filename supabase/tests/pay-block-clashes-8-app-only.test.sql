-- Blocks are saved only through venue_add_block (spec 13 "Blocking
-- pitches"; the app part of doc 28 prompt 1). Signed-in staff can no longer
-- insert or update a block directly, so no block skips the clash list. They
-- can still remove their own venue's block (decided 14 November), and still
-- can't remove another venue's.
begin;

do $$
declare
  v_owner uuid := tests.create_user('bc8-owner@futty.test');
  v_other_owner uuid := tests.create_user('bc8-other@futty.test');
  v_venue uuid := tests.create_venue(p_owner => v_owner, p_pitches => 2);
  v_other_venue uuid := tests.create_venue(p_owner => v_other_owner, p_pitches => 2);
  v_day date := tests.cyprus_today() + 2;
  v_pitch uuid;
  v_list jsonb;
  v_saved jsonb;
  v_block uuid;
  v_other_block uuid;
  v_rows integer;
begin
  select id into v_pitch from public.pitches where venue_id = v_venue order by sort_order limit 1;

  -- The grants: select and delete only.
  assert not has_table_privilege('authenticated', 'public.venue_blocks', 'insert'), 'no direct insert';
  assert not has_table_privilege('authenticated', 'public.venue_blocks', 'update'), 'no direct update';
  assert has_table_privilege('authenticated', 'public.venue_blocks', 'delete'), 'delete stays (Remove block)';
  assert has_table_privilege('authenticated', 'public.venue_blocks', 'select'), 'select stays';
  assert not has_table_privilege('anon', 'public.venue_blocks', 'insert'), 'signed out: no insert';

  -- Staff: a direct insert is refused, even on their own venue.
  perform tests.act_as(v_owner);
  assert tests.error_of(format(
    $q$ insert into public.venue_blocks (venue_id, pitch_id, block_day, created_by) values (%L, %L, %L, %L) $q$,
    v_venue, v_pitch, v_day, v_owner)) like 'permission denied%', 'staff: direct insert refused';

  -- Through venue_add_block it saves (nothing clashes, so the quote is the empty list's).
  v_list := public.venue_block_clashes(v_venue, v_pitch, v_day, '18:00', '19:00');
  assert jsonb_array_length(v_list -> 'clashes') = 0, 'nothing clashes';
  v_saved := public.venue_add_block(v_venue, v_pitch, v_day, '18:00', '19:00', 'Resurfacing', v_list ->> 'quote');
  v_block := (v_saved ->> 'block_id')::uuid;
  assert v_block is not null and (v_saved ->> 'cancelled')::integer = 0, 'saved, nothing cancelled';

  -- A direct update is refused too.
  assert tests.error_of(format($q$ update public.venue_blocks set reason = 'x' where id = %L $q$, v_block))
         like 'permission denied%', 'staff: direct update refused';
  perform tests.act_as_postgres();
  assert (select reason from public.venue_blocks where id = v_block) = 'Resurfacing', 'reason unchanged';

  -- Another venue's block: its owner's, out of reach.
  perform tests.act_as(v_other_owner);
  v_list := public.venue_block_clashes(v_other_venue, null, v_day, null, null);
  v_other_block := (public.venue_add_block(v_other_venue, null, v_day, null, null, null, v_list ->> 'quote') ->> 'block_id')::uuid;

  -- Removing: their own block goes, another venue's stays.
  perform tests.act_as(v_owner);
  delete from public.venue_blocks where id = v_other_block;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'another venue''s block is not removed';
  delete from public.venue_blocks where id = v_block;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'own block removed';
  perform tests.act_as_postgres();
  assert not exists (select 1 from public.venue_blocks where id = v_block), 'own block gone';
  assert exists (select 1 from public.venue_blocks where id = v_other_block), 'other block kept';
end $$;

select 'pay block clashes 8 (app only) passed' as result;

rollback;
