// S9: the Leagues screen's MATCHES tab (sofascore-05): league fixtures on one
// Cyprus day, grouped by competition. Only league fixtures for now: other
// games aren't competitions (S10 brings league games into matches).
import {
  competitionKey,
  competitionName,
  ISLAND_WIDE,
  normaliseScope,
  scopeLabel,
} from '@/lib/match/league-directory';
import { supabase } from '@/lib/supabase';

export type DayFixture = {
  id: string;
  league_id: string | null;
  scheduled_day: string | null;
  scheduled_time: string | null;
  status: string;
  home_score: number | null;
  away_score: number | null;
  forfeit_result: string | null;
  home_team: { id: string; name: string } | null;
  away_team: { id: string; name: string } | null;
  league: { id: string; name: string | null; format: string; scope: string; parent_league_id: string | null } | null;
};

const SELECT = `
  id, league_id, scheduled_day, scheduled_time, status, home_score, away_score, forfeit_result,
  home_team:teams!league_fixtures_home_team_id_fkey(id, name),
  away_team:teams!league_fixtures_away_team_id_fkey(id, name),
  league:leagues!league_fixtures_league_id_fkey(id, name, format, scope, parent_league_id)
`;

/** League fixtures on `dayKey` (a Cyprus YYYY-MM-DD), by kick-off. */
export async function listLeagueFixturesOnDay(dayKey: string): Promise<{ fixtures: DayFixture[]; error: string | null }> {
  const { data, error } = await supabase
    .from('league_fixtures')
    .select(SELECT)
    .eq('scheduled_day', dayKey)
    .order('scheduled_time', { ascending: true });
  if (error) return { fixtures: [], error: error.message };
  return { fixtures: (data ?? []) as unknown as DayFixture[], error: null };
}

/** "20:00" before kick-off, "FT" once completed. */
export function fixtureStatusLabel(fixture: DayFixture): string {
  if (fixture.status === 'completed') return 'FT';
  return fixture.scheduled_time ? fixture.scheduled_time.slice(0, 5) : '–';
}

/** The Cyprus day `days` after `dayKey` (both YYYY-MM-DD). */
export function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export type MatchesFilter = { format: string | null; scope: string | null };

export function filterDayFixtures(fixtures: DayFixture[], filter: MatchesFilter): DayFixture[] {
  return fixtures.filter((f) => {
    if (!f.league) return false;
    if (filter.format && f.league.format !== filter.format) return false;
    if (filter.scope && normaliseScope(f.league.scope) !== normaliseScope(filter.scope)) return false;
    return true;
  });
}

export type FixtureGroup = {
  key: string;
  scope: string;
  format: string;
  name: string;
  area: string;
  pinned: boolean;
  /** One of my teams plays in it. */
  mine: boolean;
  fixtures: DayFixture[];
};

const isMine = (f: DayFixture, myTeamIds: Set<string>) =>
  (!!f.home_team && myTeamIds.has(f.home_team.id)) || (!!f.away_team && myTeamIds.has(f.away_team.id));

/** Competitions with my teams first, then pinned ones, then by name; in each,
 *  my fixtures first, then by kick-off. A division's fixtures join its league. */
export function groupFixturesByCompetition(
  fixtures: DayFixture[],
  { myTeamIds, pinnedKeys, names }: { myTeamIds: Set<string>; pinnedKeys: Set<string>; names: Map<string, string> },
): FixtureGroup[] {
  const groups = new Map<string, FixtureGroup>();
  for (const f of fixtures) {
    if (!f.league) continue;
    const scope = normaliseScope(f.league.scope);
    const key = competitionKey(scope, f.league.format);
    let group = groups.get(key);
    if (!group) {
      const area = scope === ISLAND_WIDE ? 'Island-wide' : scopeLabel(scope);
      group = {
        key,
        scope,
        format: f.league.format,
        name: names.get(key) ?? competitionName(scope, f.league.format),
        area,
        pinned: pinnedKeys.has(key),
        mine: false,
        fixtures: [],
      };
      groups.set(key, group);
    }
    group.fixtures.push(f);
    if (isMine(f, myTeamIds)) group.mine = true;
  }

  const time = (f: DayFixture) => f.scheduled_time ?? '99';
  const rank = (g: FixtureGroup) => (g.mine ? 0 : g.pinned ? 1 : 2);
  return [...groups.values()]
    .map((g) => ({
      ...g,
      fixtures: [...g.fixtures].sort(
        (a, b) => Number(isMine(b, myTeamIds)) - Number(isMine(a, myTeamIds)) || time(a).localeCompare(time(b)),
      ),
    }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
