// S10 screens: the competition page's reads (match-record.md 1n) and the
// helpers that shape them for the screen. Nothing here computes a result,
// a standing or a rating: the server does.
import {
  canMessageFrom,
  competitionPlayerLook,
  getCompetition,
  getCompetitionAwards,
  getCompetitionMatches,
  getCompetitionPlayerStats,
  getCompetitionPowerRanking,
  getCompetitionStandings,
  getCompetitionStats,
  groupMatchesByDate,
  groupMatchesByRound,
  isPremiumRequired,
  matchDateLabel,
  matchStatusLabel,
  NOT_SCHEDULED,
  progressDateLabel,
  roundLabel,
  seasonProgress,
  sortPlayerStats,
  STANDINGS_COLUMNS,
  standingsColumns,
  toPowerRankingRows,
  toTotwPlayers,
  type CompetitionAwards,
  type CompetitionMatch,
  type CompetitionPowerRow,
  type PlayerStatRow,
} from '@/lib/match/competition-api';

let mockRpc: { name: string; args: unknown }[] = [];
let mockAnswer: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      mockRpc.push({ name, args });
      return Promise.resolve(mockAnswer);
    },
  },
}));

beforeEach(() => {
  mockRpc = [];
  mockAnswer = { data: null, error: null };
});

const match = (over: Partial<CompetitionMatch>): CompetitionMatch => ({
  fixture_id: 'f1',
  table_id: 't1',
  table_name: 'Season 1',
  matchday: 1,
  kickoff_at: '2026-12-07T17:00:00Z',
  status: 'agreed',
  forfeit_result: null,
  home_team_id: 'h',
  home_team_name: 'Tigers',
  away_team_id: 'a',
  away_team_name: 'Lions',
  home_score: null,
  away_score: null,
  match_id: null,
  ...over,
});

describe('reads', () => {
  it('get_competition with and without a season', async () => {
    mockAnswer = { data: { id: 'L1', name: 'Limassol 5s' }, error: null };
    await expect(getCompetition('L1')).resolves.toEqual({ competition: { id: 'L1', name: 'Limassol 5s' }, error: null });
    await getCompetition('L1', 'S2');
    expect(mockRpc).toEqual([
      { name: 'get_competition', args: { p_league_id: 'L1', p_season_id: null } },
      { name: 'get_competition', args: { p_league_id: 'L1', p_season_id: 'S2' } },
    ]);
  });

  it('a refused read passes the error on and no data', async () => {
    mockAnswer = { data: null, error: { message: 'competition_not_found' } };
    await expect(getCompetition('gone')).resolves.toEqual({ competition: null, error: { message: 'competition_not_found' } });
  });

  it('standings, matches (with a team), player stats (with a team), stats, awards and power', async () => {
    mockAnswer = { data: null, error: null };
    await expect(getCompetitionStandings('S1')).resolves.toEqual({ standings: { rules: '', tables: [] }, error: null });
    await expect(getCompetitionMatches('S1')).resolves.toEqual({ matches: [], error: null });
    await getCompetitionMatches('S1', 'T1');
    await expect(getCompetitionPlayerStats('S1')).resolves.toEqual({ rows: [], error: null });
    await getCompetitionPlayerStats('S1', 'T1');
    await expect(getCompetitionStats('S1', 'players')).resolves.toEqual({ categories: [], error: null });
    await getCompetitionStats('S1', 'teams', 'goals_scored', 100);
    await expect(getCompetitionAwards('S1')).resolves.toEqual({ awards: null, error: null });
    await getCompetitionAwards('S1', 3);
    await expect(getCompetitionPowerRanking('S1')).resolves.toEqual({ rows: [], error: null });
    expect(mockRpc).toEqual([
      { name: 'get_competition_standings', args: { p_season_id: 'S1' } },
      { name: 'get_competition_matches', args: { p_season_id: 'S1', p_team_id: null } },
      { name: 'get_competition_matches', args: { p_season_id: 'S1', p_team_id: 'T1' } },
      { name: 'get_competition_player_stats', args: { p_season_id: 'S1', p_team_id: null } },
      { name: 'get_competition_player_stats', args: { p_season_id: 'S1', p_team_id: 'T1' } },
      { name: 'get_competition_stats', args: { p_season_id: 'S1', p_tab: 'players', p_category: null, p_limit: 3 } },
      { name: 'get_competition_stats', args: { p_season_id: 'S1', p_tab: 'teams', p_category: 'goals_scored', p_limit: 100 } },
      { name: 'get_competition_awards', args: { p_season_id: 'S1', p_matchday: null } },
      { name: 'get_competition_awards', args: { p_season_id: 'S1', p_matchday: 3 } },
      { name: 'get_competition_power_ranking', args: { p_season_id: 'S1' } },
    ]);
  });

  it('knows the Premium refusal', () => {
    expect(isPremiumRequired({ message: 'premium_required' })).toBe(true);
    expect(isPremiumRequired({ message: 'not_authenticated' })).toBe(false);
    expect(isPremiumRequired(null)).toBe(false);
  });
});

describe('season progress', () => {
  it('0 before the start, 1 after the end, in between by days', () => {
    expect(seasonProgress('2026-12-01', '2026-12-11', '2026-11-20')).toBe(0);
    expect(seasonProgress('2026-12-01', '2026-12-11', '2026-12-06')).toBe(0.5);
    expect(seasonProgress('2026-12-01', '2026-12-11', '2026-12-31')).toBe(1);
  });

  it('null without both dates; a one-day season is done on its day', () => {
    expect(seasonProgress(null, '2026-12-11', '2026-12-06')).toBeNull();
    expect(seasonProgress('2026-12-01', null, '2026-12-06')).toBeNull();
    expect(seasonProgress('2026-12-01', '2026-12-01', '2026-12-01')).toBe(1);
  });

  it('labels a date as "1 Dec"', () => {
    expect(progressDateLabel('2026-12-01')).toBe('1 Dec');
  });
});

describe('matches', () => {
  it('status: FT, forfeit (FF), Cancelled, or the Cyprus kickoff time', () => {
    expect(matchStatusLabel(match({ status: 'completed' }))).toBe('FT');
    expect(matchStatusLabel(match({ status: 'completed', forfeit_result: 'home_forfeited' }))).toBe('FF');
    expect(matchStatusLabel(match({ forfeit_result: 'void' }))).toBe('Cancelled');
    expect(matchStatusLabel(match({ kickoff_at: '2026-12-07T17:00:00Z' }))).toBe('19:00');
    expect(matchStatusLabel(match({ kickoff_at: null }))).toBe('');
  });

  it('date in Cyprus as 07/12/26; none when unscheduled', () => {
    expect(matchDateLabel(match({ kickoff_at: '2026-12-07T22:30:00Z' }))).toBe('08/12/26');
    expect(matchDateLabel(match({ kickoff_at: null }))).toBe('');
  });

  it('round labels', () => {
    expect(roundLabel(3)).toBe('Matchday 3');
    expect(roundLabel(null)).toBe(NOT_SCHEDULED);
  });

  it('by date: one section per Cyprus day in order, Not scheduled last', () => {
    const rows = [
      match({ fixture_id: 'x', kickoff_at: null, matchday: null }),
      match({ fixture_id: 'b', kickoff_at: '2026-12-08T17:00:00Z' }),
      match({ fixture_id: 'a', kickoff_at: '2026-12-07T17:00:00Z' }),
      match({ fixture_id: 'c', kickoff_at: '2026-12-07T19:00:00Z' }),
    ];
    const sections = groupMatchesByDate(rows);
    expect(sections.map((s) => s.title)).toEqual(['Mon 7 Dec', 'Tue 8 Dec', NOT_SCHEDULED]);
    expect(sections[0].data.map((m) => m.fixture_id)).toEqual(['a', 'c']);
    expect(sections[2].data.map((m) => m.fixture_id)).toEqual(['x']);
  });

  it('by round: Matchday n in order, Not scheduled last; one round when picked', () => {
    const rows = [
      match({ fixture_id: 'x', matchday: null, kickoff_at: null }),
      match({ fixture_id: 'b', matchday: 2 }),
      match({ fixture_id: 'a', matchday: 1 }),
    ];
    expect(groupMatchesByRound(rows).map((s) => s.title)).toEqual(['Matchday 1', 'Matchday 2', NOT_SCHEDULED]);
    expect(groupMatchesByRound(rows, 2).map((s) => s.title)).toEqual(['Matchday 2']);
    expect(groupMatchesByRound(rows, null).map((s) => s.title)).toEqual([NOT_SCHEDULED]);
    expect(groupMatchesByRound([])).toEqual([]);
  });

  it('message button: only my captain team’s rows, and only when the chat is allowed', () => {
    const contacts = [
      { my_team_id: 'h', team_id: 'a', can_message: true },
      { my_team_id: 'h', team_id: 'm', can_message: false },
    ];
    expect(canMessageFrom(match({}), contacts)).toEqual({ myTeamId: 'h', otherTeamId: 'a' });
    expect(canMessageFrom(match({ home_team_id: 'a', away_team_id: 'h' }), contacts)).toEqual({ myTeamId: 'h', otherTeamId: 'a' });
    // A minor's team or a block: no button.
    expect(canMessageFrom(match({ away_team_id: 'm' }), contacts)).toBeNull();
    // Not my team's fixture.
    expect(canMessageFrom(match({ home_team_id: 'x', away_team_id: 'a' }), contacts)).toBeNull();
    expect(canMessageFrom(match({}), [])).toBeNull();
    // An older server without the column counts as refused.
    expect(canMessageFrom(match({}), [{ my_team_id: 'h', team_id: 'a' }])).toBeNull();
  });
});

describe('standings', () => {
  it('Short, Full and Form columns', () => {
    expect(standingsColumns('short').map((c) => c.label)).toEqual(['P', 'Diff', 'Pts']);
    expect(standingsColumns('full').map((c) => c.label)).toEqual(['P', 'W', 'D', 'L', 'GF', 'GA', 'Diff', 'Pts']);
    expect(standingsColumns('form').map((c) => c.label)).toEqual(['P', 'Diff', 'Pts']);
    expect(STANDINGS_COLUMNS.find((c) => c.label === 'Diff')!.value({ goalDiff: 3 } as never)).toBe('+3');
    expect(STANDINGS_COLUMNS.find((c) => c.label === 'Diff')!.value({ goalDiff: -2 } as never)).toBe('-2');
    expect(STANDINGS_COLUMNS.find((c) => c.label === 'Diff')!.value({ goalDiff: 0 } as never)).toBe('0');
  });
});

describe('player stats', () => {
  const p = (over: Partial<PlayerStatRow>): PlayerStatRow => ({
    profileId: 'p',
    name: 'Ana',
    avatarStyle: null,
    avatarKitColour: null,
    avatarNumber: null,
    avatarIllustration: null,
    teamId: 't',
    teamName: 'Tigers',
    rating: 7,
    matches: 3,
    goals: 1,
    assists: 0,
    motm: 0,
    cleanSheets: 0,
    goalsConcededPerMatch: 1,
    ...over,
  });

  it('sorts by a column, biggest first, except goals conceded (fewest first); nulls last', () => {
    const rows = [p({ profileId: 'a', goals: 1, goalsConcededPerMatch: 2 }), p({ profileId: 'b', goals: 4, goalsConcededPerMatch: 0.5 }), p({ profileId: 'c', rating: null, goals: 0, goalsConcededPerMatch: null })];
    expect(sortPlayerStats(rows, 'goals').map((r) => r.profileId)).toEqual(['b', 'a', 'c']);
    expect(sortPlayerStats(rows, 'goalsConcededPerMatch').map((r) => r.profileId)).toEqual(['b', 'a', 'c']);
    expect(sortPlayerStats(rows, 'rating').map((r) => r.profileId)).toEqual(['a', 'b', 'c']);
  });

  it('turns the player json into an avatar look', () => {
    expect(competitionPlayerLook(p({ avatarStyle: 'kit', avatarKitColour: 'kitRed', avatarNumber: 7 }))).toEqual({ colour: 'kitRed', number: 7 });
    expect(competitionPlayerLook(p({}))).toBeNull();
  });
});

describe('Team of the season', () => {
  const awards: CompetitionAwards = {
    premiumOnly: false,
    matchdays: [1, 2],
    player: null,
    team: {
      format: '5-a-side',
      matchday: null,
      shape: { keepers: 1, defenders: 1, midfielders: 2, strikers: 1 },
      players: [
        {
          profileId: 'p1',
          name: 'Ana',
          avatarStyle: null,
          avatarKitColour: null,
          avatarNumber: null,
          avatarIllustration: null,
          slot: 'fwd',
          sort: 1,
          best: true,
          teamId: 't',
          teamName: 'Tigers',
          rating: 8.6,
          matches: 3,
          goals: 4,
          assists: 1,
        },
      ],
    },
  };

  it('maps the server team onto the Team of the Week pitch', () => {
    expect(toTotwPlayers(awards.team!)).toEqual({
      shape: { format: '5-a-side', keepers: 1, defenders: 1, midfielders: 2, strikers: 1 },
      players: [
        {
          profile_id: 'p1',
          name: 'Ana',
          kit: null,
          slot: 'fwd',
          sort: 1,
          games: 3,
          goals: 4,
          assists: 1,
          clean_sheets: 0,
          average_rating: 8.6,
          player_of_the_week: true,
        },
      ],
    });
  });
});

describe('power rankings', () => {
  it('maps position and its change onto the Rankings rows', () => {
    const row: CompetitionPowerRow = {
      position: 2,
      team_id: 't',
      team_name: 'Tigers',
      points: 1031.4,
      matches: 5,
      app_rank: 7,
      position_change: -1,
      last_results: ['W', 'L'],
    };
    expect(toPowerRankingRows([row])).toEqual([
      { rank: 2, team_id: 't', team_name: 'Tigers', points: 1031.4, matches: 5, last_results: ['W', 'L'], rank_change: -1 },
    ]);
  });
});
