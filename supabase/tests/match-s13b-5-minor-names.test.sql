-- S13B with S12 (spec 05 section 16, A5): the logging screens read players
-- from get_match_log, which names them through match_player_json, so a
-- player under 18 shows their first name only to everyone else (the age
-- migration's rule: minor_first_name, name_hidden). The minor sees their own
-- full name; adults keep theirs. No surname reaches another caller.
-- Dates of birth come from today's Cyprus date, read once (now() is the
-- transaction's start time).
begin;

-- get_match_log as p_user.
create function tests.mn_log(p_user uuid, p_match uuid)
returns jsonb
language plpgsql
as $$
declare
  v jsonb;
begin
  perform tests.act_as(p_user);
  v := public.get_match_log(p_match);
  perform tests.act_as_postgres();
  return v;
end;
$$;

-- The name get_match_log gives p_profile's player.
create function tests.mn_name(p_log jsonb, p_match uuid, p_profile uuid)
returns text
language sql
as $$
  select p ->> 'name' from jsonb_array_elements(p_log -> 'players') p
  where (p ->> 'playerId')::uuid = tests.player_id(p_match, p_profile);
$$;

do $$
declare
  v_today date := (now() at time zone 'Asia/Nicosia')::date;
  g record := tests.s13b_match(3, 1);
  v_minor uuid := g.a[2];
  v_adult uuid := g.a[3];
  v_log jsonb;
begin
  -- Sixteen today; turns 18 tomorrow; an adult with a full name.
  update public.profiles set first_name = 'Eleni', full_name = 'Eleni Constantinou', username = 'eleni16',
                             date_of_birth = (v_today - interval '16 years')::date
  where id = v_minor;
  update public.profiles set full_name = 'Andreas Pavlou', username = 'andreas_p',
                             date_of_birth = (v_today - interval '18 years' + interval '1 day')::date
  where id = v_adult;
  update public.profiles set date_of_birth = '1990-05-01' where id = g.cap_a;

  -- The captain (an adult) logging the score.
  v_log := tests.mn_log(g.cap_a, g.match);
  assert tests.mn_name(v_log, g.match, v_minor) = 'Eleni', format('a minor: first name only (%s)', v_log -> 'players');
  assert tests.mn_name(v_log, g.match, v_adult) = 'Andreas', 'turns 18 tomorrow: still a minor, first name only';
  assert v_log::text not like '%Constantinou%' and v_log::text not like '%Pavlou%', 'no surname of a minor';
  assert v_log::text not like '%eleni16%' and v_log::text not like '%andreas_p%', 'no username of a minor';

  -- The minor sees their own full name.
  v_log := tests.mn_log(v_minor, g.match);
  assert tests.mn_name(v_log, g.match, v_minor) = 'Eleni Constantinou', 'the minor sees their own full name';
  assert tests.mn_name(v_log, g.match, v_adult) = 'Andreas', 'and another minor''s first name only';

  -- Eighteen today: the full name again.
  update public.profiles set date_of_birth = (v_today - interval '18 years')::date where id = v_adult;
  v_log := tests.mn_log(g.cap_a, g.match);
  assert tests.mn_name(v_log, g.match, v_adult) = 'Andreas Pavlou', 'eighteen today: full name';
  assert tests.mn_name(v_log, g.match, v_minor) = 'Eleni', 'the minor still first name only';
end $$;

select 'match S13B 5 (minor names in the logging screens) passed' as result;

rollback;
