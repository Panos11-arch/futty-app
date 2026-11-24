-- S5 (venue page, Home tab): top players and recent results at a venue.
--
-- venue_highlights(p_venue_id) returns
--   {top_players: [{profile_id, rating, matches}],
--    recent_results: [{match_id, kickoff_at, sides: [{side, label, team_id, score}]}]}
--
-- Top players: the best average match rating at this venue over the last 30
-- days, with at least 3 matches. Only ratings the match page already shows
-- to everyone signed in count (match_rating_shown: confirmed, not a forfeit,
-- 3 or more ratings, once the 24-hour window has closed); a rating is never
-- shown on its own here. Best average first, then more matches; at most 5.
-- Names come from get_public_profiles in the app, as everywhere else.
--
-- Recent results: the last confirmed matches at this venue with a score (a
-- forfeit has none), newest first; at most 5.
--
-- Only for a venue the caller can see (venue_visible), as venue_page.

create or replace function public.venue_highlights(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if not public.venue_visible(p_venue_id) then
    raise exception 'venue_not_found';
  end if;

  return jsonb_build_object(
    'top_players', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', t.profile_id, 'rating', t.rating, 'matches', t.matches)
                       order by t.rating desc, t.matches desc, t.profile_id)
      from (
        select s.profile_id, round(avg(s.rating), 2) as rating, count(*)::integer as matches
        from (
          select mp.profile_id, public.match_rating_shown(m.id, mp.id) as rating
          from public.matches m
          join public.match_players mp on mp.match_id = m.id and mp.profile_id is not null and mp.left_at is null
          where m.venue_id = p_venue_id
            and m.status = 'confirmed'
            and m.forfeit_side is null
            and m.kickoff_at >= now() - interval '30 days'
        ) s
        where s.rating is not null
        group by s.profile_id
        having count(*) >= 3
        order by round(avg(s.rating), 2) desc, count(*) desc, s.profile_id
        limit 5
      ) t), '[]'::jsonb),
    'recent_results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'match_id', r.id,
               'kickoff_at', r.kickoff_at,
               'sides', (select jsonb_agg(jsonb_build_object(
                                  'side', ms.side, 'label', ms.label, 'team_id', ms.team_id,
                                  'score', case ms.side when 'a' then r.side_a_score else r.side_b_score end)
                                order by ms.side)
                         from public.match_sides ms where ms.match_id = r.id))
             order by r.kickoff_at desc, r.id)
      from (
        select m.id, m.kickoff_at, m.side_a_score, m.side_b_score
        from public.matches m
        where m.venue_id = p_venue_id
          and m.status = 'confirmed'
          and m.forfeit_side is null
          and m.side_a_score is not null
          and m.side_b_score is not null
        order by m.kickoff_at desc, m.id
        limit 5
      ) r), '[]'::jsonb));
end;
$$;

revoke all on function public.venue_highlights(uuid) from public, anon;
grant execute on function public.venue_highlights(uuid) to authenticated, service_role;
