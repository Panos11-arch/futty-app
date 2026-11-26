-- S14b power ranking (match-record.md decision 1m): the formula and its
-- rules. new = old + K × (W − We), We = 1 / (10^(−d/600) + 1). Each worked
-- example in the step is checked with the K and W values from app_rules.
-- Penalty shootouts are stored but off until S10A (decided 25 November).
begin;

do $$
declare
  r public.app_rules := public.app_rules_now();
begin
  -- Every constant is in app_rules.
  assert r.power_ranking_start = 1000, 'start 1000';
  assert r.power_ranking_scale = 600, 'scale 600';
  assert r.power_ranking_k_non_league = 20, 'non-league K 20';
  assert r.power_ranking_k_league = 40, 'league K 40';
  assert r.power_ranking_k_tournament_group = 40, 'tournament group K 40';
  assert r.power_ranking_k_tournament_knockout = 50, 'tournament knockout K 50';
  assert (r.power_ranking_w_win, r.power_ranking_w_draw, r.power_ranking_w_loss) = (1::numeric, 0.5::numeric, 0::numeric),
    'W: 1, 0.5, 0';
  assert r.power_ranking_min_matches = 3, 'listed after 3 matches';
  assert r.power_ranking_inactive_days = 60, 'inactive after 60 days';

  -- Shootouts: stored for S10A, switched off.
  assert r.power_ranking_w_shootout_win = 0.75 and r.power_ranking_w_shootout_loss = 0.5, 'shootout W 0.75 / 0.5 stored';
  assert r.power_ranking_shootouts = false, 'shootout weighting off until S10A';

  -- Equal teams: We = 0.5.
  assert public.power_ranking_expected(1000, 1000) = 0.5, 'equal teams: 50%';

  -- Equal teams, league match: +20 and −20.
  assert public.power_ranking_change(1000, 1000, r.power_ranking_w_win, r.power_ranking_k_league) = 20, 'league win +20';
  assert public.power_ranking_change(1000, 1000, r.power_ranking_w_loss, r.power_ranking_k_league) = -20, 'league loss -20';

  -- Non-league win between equal teams: +10.
  assert public.power_ranking_change(1000, 1000, r.power_ranking_w_win, r.power_ranking_k_non_league) = 10,
    'non-league win +10';

  -- Tournament knockout win between equal teams: +25 (formula only: no
  -- tournament games exist until S10A).
  assert public.power_ranking_change(1000, 1000, r.power_ranking_w_win, r.power_ranking_k_tournament_knockout) = 25,
    'knockout win +25';
  assert public.power_ranking_change(1000, 1000, r.power_ranking_w_win, r.power_ranking_k_tournament_group) = 20,
    'group win +20';

  -- A 20-point favourite losing a league match: −20.8 (and the underdog +20.8).
  assert round(public.power_ranking_change(1020, 1000, r.power_ranking_w_loss, r.power_ranking_k_league), 1) = -20.8,
    format('favourite loses: %s', public.power_ranking_change(1020, 1000, r.power_ranking_w_loss, r.power_ranking_k_league));
  assert round(public.power_ranking_change(1000, 1020, r.power_ranking_w_win, r.power_ranking_k_league), 1) = 20.8,
    'underdog wins +20.8';
  assert round(public.power_ranking_expected(1020, 1000) * 100) = 52, 'favourite expected to win 52% of the time';

  -- A draw between equal teams: 0, in every category.
  assert public.power_ranking_change(1000, 1000, r.power_ranking_w_draw, r.power_ranking_k_league) = 0, 'draw 0 (league)';
  assert public.power_ranking_change(1000, 1000, r.power_ranking_w_draw, r.power_ranking_k_non_league) = 0,
    'draw 0 (non-league)';

  -- The K for each category comes from app_rules.
  assert public.power_ranking_k('non_league') = 20 and public.power_ranking_k('league') = 40
         and public.power_ranking_k('tournament_group') = 40 and public.power_ranking_k('tournament_knockout') = 50,
    'K by category';
end $$;

-- A changed rule changes the result: the K is read, not hard-coded.
do $$
begin
  update public.app_rules set power_ranking_k_non_league = 30;
  assert public.power_ranking_k('non_league') = 30, 'K read from app_rules';
  assert public.power_ranking_change(1000, 1000, 1, public.power_ranking_k('non_league')) = 15, 'K 30 win +15';
end $$;

rollback;
