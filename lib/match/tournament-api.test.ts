import {
  adminCloseTournament,
  adminCreateTournament,
  adminDrawGroups,
  adminOpenRegistration,
  adminSetDrawOrder,
  adminSetFixtureTime,
  adminSetGroups,
  adminSetResult,
  adminUpdateTournament,
  bracketHalves,
  entryFeeLine,
  fixtureDateLabel,
  fixtureStatusLabel,
  getTournament,
  getTournamentKnockout,
  getTournamentMatches,
  getTournamentStandings,
  groupFixturesByDate,
  groupFixturesByGroup,
  groupFixturesByRound,
  isAppAdmin,
  listTournaments,
  registerTeam,
  registrationAction,
  setSquad,
  shootoutText,
  slotSide,
  stageTitle,
  tournamentBadge,
  tournamentDates,
  tournamentStatusLabel,
  type KnockoutSlot,
  type TournamentFixture,
} from '@/lib/match/tournament-api';

let mockCalls: [string, unknown][] = [];
let mockAnswer: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args?: unknown) => {
      mockCalls.push([name, args]);
      return Promise.resolve(mockAnswer);
    },
  },
}));

beforeEach(() => {
  mockCalls = [];
  mockAnswer = { data: null, error: null };
});

function fixture(over: Partial<TournamentFixture> = {}): TournamentFixture {
  return {
    fixtureId: 'f1',
    stage: 'group',
    group: 'A',
    slot: 'A-1',
    kickoffAt: null,
    status: 'scheduled',
    homeTeamId: 'h',
    homeTeamName: 'Home FC',
    homeKitColour: 'kitRed',
    awayTeamId: 'a',
    awayTeamName: 'Away FC',
    awayKitColour: 'kitBlue',
    homeScore: null,
    awayScore: null,
    homePens: null,
    awayPens: null,
    decidedBy: null,
    winnerTeamId: null,
    matchId: null,
    ...over,
  };
}

describe('reads', () => {
  it('lists tournaments; none on a null answer', async () => {
    mockAnswer = { data: [{ id: 't1' }], error: null };
    await expect(listTournaments()).resolves.toEqual({ tournaments: [{ id: 't1' }], error: null });
    expect(mockCalls).toEqual([['list_tournaments', undefined]]);
    mockAnswer = { data: null, error: { message: 'offline' } };
    await expect(listTournaments()).resolves.toEqual({ tournaments: [], error: { message: 'offline' } });
  });

  it('reads one tournament, its standings, matches (optionally one team) and knockout', async () => {
    await getTournament('t1');
    await getTournamentStandings('t1');
    await getTournamentMatches('t1');
    await getTournamentMatches('t1', 'team1');
    await getTournamentKnockout('t1');
    expect(mockCalls).toEqual([
      ['get_tournament', { p_tournament_id: 't1' }],
      ['get_tournament_standings', { p_tournament_id: 't1' }],
      ['get_tournament_matches', { p_tournament_id: 't1', p_team_id: null }],
      ['get_tournament_matches', { p_tournament_id: 't1', p_team_id: 'team1' }],
      ['get_tournament_knockout', { p_tournament_id: 't1' }],
    ]);
  });

  it('defaults empty shapes when the server sends nothing', async () => {
    await expect(getTournament('t1')).resolves.toEqual({ tournament: null, error: null });
    await expect(getTournamentStandings('t1')).resolves.toEqual({ standings: { rules: '', groups: [] }, error: null });
    await expect(getTournamentMatches('t1')).resolves.toEqual({ matches: [], error: null });
    await expect(getTournamentKnockout('t1')).resolves.toEqual({ slots: [], error: null });
  });

  it('is_app_admin that throws is not an admin', async () => {
    const { supabase } = jest.requireMock<{ supabase: { rpc: unknown } }>('@/lib/supabase');
    const rpc = supabase.rpc;
    supabase.rpc = () => {
      throw new Error('offline');
    };
    await expect(isAppAdmin()).resolves.toEqual({ admin: false, error: { message: 'offline' } });
    supabase.rpc = () => {
      throw 'odd';
    };
    await expect(isAppAdmin()).resolves.toEqual({ admin: false, error: { message: 'is_app_admin failed' } });
    supabase.rpc = rpc;
  });

  it('is_app_admin is true only for a true answer', async () => {
    mockAnswer = { data: true, error: null };
    await expect(isAppAdmin()).resolves.toEqual({ admin: true, error: null });
    mockAnswer = { data: null, error: { message: 'not_authenticated' } };
    await expect(isAppAdmin()).resolves.toEqual({ admin: false, error: { message: 'not_authenticated' } });
  });
});

describe('captain writes', () => {
  // S10B: the squad comes with its subs (the rest are starters).
  it('registers a team with its kit colour, squad and subs', async () => {
    mockAnswer = { data: null, error: { message: 'squad_size' } };
    await expect(registerTeam('t1', 'team1', 'kitGreen', ['p1', 'p2'], ['p2'])).resolves.toEqual({ error: { message: 'squad_size' } });
    expect(mockCalls).toEqual([
      ['register_team_for_tournament', { p_tournament_id: 't1', p_team_id: 'team1', p_kit_colour: 'kitGreen', p_squad: ['p1', 'p2'], p_subs: ['p2'] }],
    ]);
  });

  it('saves a squad with its subs', async () => {
    await expect(setSquad('t1', 'team1', ['p1'], [])).resolves.toEqual({ error: null });
    expect(mockCalls).toEqual([['set_tournament_squad', { p_tournament_id: 't1', p_team_id: 'team1', p_squad: ['p1'], p_subs: [] }]]);
  });
});

describe('admin writes', () => {
  const input = { name: 'Cup', area: 'Limassol', format: '5-a-side', entryFeeCents: 1200, matchMinutes: 50, squadSubs: 2 };

  it('creates a 16-team tournament and returns its id', async () => {
    mockAnswer = { data: 'new-id', error: null };
    await expect(adminCreateTournament(input)).resolves.toEqual({ id: 'new-id', error: null });
    expect(mockCalls).toEqual([['admin_create_tournament', { p: { ...input, maxTeams: 16 } }]]);
  });

  it('a refused create returns no id', async () => {
    mockAnswer = { data: null, error: { message: 'not_admin' } };
    await expect(adminCreateTournament(input)).resolves.toEqual({ id: null, error: { message: 'not_admin' } });
  });

  it('sends every other admin call with the server argument names', async () => {
    const groups = { A: ['1'], B: ['2'], C: ['3'], D: ['4'] };
    await adminUpdateTournament('t1', input);
    await adminOpenRegistration('t1');
    await adminSetGroups('t1', groups);
    await adminDrawGroups('t1');
    await adminSetFixtureTime('f1', '2026-12-06T17:00:00.000Z');
    await adminSetResult('f1', 2, 1, null);
    await adminSetResult('f2', 1, 1, { home: 4, away: 3 });
    await adminSetDrawOrder('t1', 'B', ['x', 'y']);
    await adminCloseTournament('t1');
    expect(mockCalls).toEqual([
      ['admin_update_tournament', { p_tournament_id: 't1', p: input }],
      ['admin_open_registration', { p_tournament_id: 't1' }],
      ['admin_set_groups', { p_tournament_id: 't1', p_groups: groups }],
      ['admin_draw_groups', { p_tournament_id: 't1' }],
      ['admin_set_fixture_time', { p_fixture_id: 'f1', p_kickoff_at: '2026-12-06T17:00:00.000Z' }],
      ['admin_set_result', { p_fixture_id: 'f1', p_home: 2, p_away: 1, p_home_pens: null, p_away_pens: null }],
      ['admin_set_result', { p_fixture_id: 'f2', p_home: 1, p_away: 1, p_home_pens: 4, p_away_pens: 3 }],
      ['admin_set_draw_order', { p_tournament_id: 't1', p_group: 'B', p_team_ids: ['x', 'y'] }],
      ['admin_close_tournament', { p_tournament_id: 't1' }],
    ]);
  });
});

describe('labels', () => {
  it('dates show Coming soon until set', () => {
    expect(tournamentDates({ startDate: null, endDate: null })).toBe('Coming soon');
    expect(tournamentDates({ startDate: '2026-12-06', endDate: null })).toBe('6 Dec');
    expect(tournamentDates({ startDate: '2026-12-06', endDate: '2026-12-06' })).toBe('6 Dec');
    expect(tournamentDates({ startDate: '2026-12-06', endDate: '2026-12-14' })).toBe('6–14 Dec');
    expect(tournamentDates({ startDate: '2026-12-28', endDate: '2027-01-03' })).toBe('28 Dec – 3 Jan');
  });

  it('the entry fee line formats the server cents', () => {
    // S10B: collected in the app, so no longer "paid to the organiser".
    expect(entryFeeLine(1200)).toBe('€12 per player');
    expect(entryFeeLine(650)).toBe('€6.50 per player');
    expect(entryFeeLine(0)).toBe('Free');
  });

  it('status, stage and badge labels', () => {
    expect(tournamentStatusLabel('coming_soon')).toBe('Coming soon');
    expect(tournamentStatusLabel('registration')).toBe('Sign-up open');
    expect(tournamentStatusLabel('groups')).toBe('Group stage');
    expect(tournamentStatusLabel('knockout')).toBe('Knockout');
    expect(tournamentStatusLabel('finished')).toBe('Finished');
    expect(stageTitle('qf')).toBe('Quarter-finals');
    expect(stageTitle('sf')).toBe('Semi-finals');
    expect(stageTitle('final')).toBe('Final');
    expect(tournamentBadge('Nuevo Campo Cup')).toBe('NC');
    expect(tournamentBadge('Cup')).toBe('CU');
    expect(tournamentBadge('!!')).toBe('');
  });

  it('AP with the shootout score after penalties; FT otherwise; the Cyprus time before', () => {
    expect(fixtureStatusLabel(fixture({ status: 'completed', homeScore: 1, awayScore: 1, homePens: 4, awayPens: 3 }))).toBe('AP');
    expect(shootoutText(fixture({ homePens: 4, awayPens: 3 }))).toBe('AP 4–3');
    expect(shootoutText(fixture())).toBeNull();
    expect(fixtureStatusLabel(fixture({ status: 'completed', homeScore: 2, awayScore: 0 }))).toBe('FT');
    // 17:00 UTC on 6 Dec is 19:00 in Cyprus (winter, UTC+2).
    expect(fixtureStatusLabel(fixture({ kickoffAt: '2026-12-06T17:00:00Z' }))).toBe('19:00');
    expect(fixtureDateLabel(fixture({ kickoffAt: '2026-12-06T23:30:00Z' }))).toBe('07/12/26');
    expect(fixtureStatusLabel(fixture())).toBe('');
    expect(fixtureDateLabel(fixture())).toBe('');
  });
});

describe('grouping', () => {
  const rows = [
    fixture({ fixtureId: 'a1', group: 'A', kickoffAt: '2026-12-06T17:00:00Z' }),
    fixture({ fixtureId: 'b1', group: 'B', kickoffAt: '2026-12-06T18:00:00Z' }),
    fixture({ fixtureId: 'a2', group: 'A', kickoffAt: '2026-12-07T17:00:00Z' }),
    fixture({ fixtureId: 'qf1', stage: 'qf', group: null, slot: 'QF1' }),
    fixture({ fixtureId: 'f', stage: 'final', group: null, slot: 'F' }),
  ];

  it('by date: one section per Cyprus day, then Not scheduled', () => {
    expect(groupFixturesByDate(rows).map((s) => [s.title, s.data.map((f) => f.fixtureId)])).toEqual([
      ['Sun 6 Dec', ['a1', 'b1']],
      ['Mon 7 Dec', ['a2']],
      ['Not scheduled', ['qf1', 'f']],
    ]);
  });

  it('by group: A to D, group games only, empty groups hidden', () => {
    expect(groupFixturesByGroup(rows).map((s) => [s.title, s.data.map((f) => f.fixtureId)])).toEqual([
      ['Group A', ['a1', 'a2']],
      ['Group B', ['b1']],
    ]);
  });

  it('by round: group stage, then each knockout round present', () => {
    expect(groupFixturesByRound(rows).map((s) => s.title)).toEqual(['Group stage', 'Quarter-finals', 'Final']);
  });
});

describe('knockout', () => {
  const slot = (name: string, stage: KnockoutSlot['stage'], homeSource: string, awaySource: string): KnockoutSlot => ({
    stage,
    slot: name,
    homeSource,
    awaySource,
  });
  const slots = [
    slot('QF1', 'qf', 'A1', 'D2'),
    slot('QF2', 'qf', 'A2', 'B1'),
    slot('QF3', 'qf', 'B2', 'C1'),
    slot('QF4', 'qf', 'C2', 'D1'),
    slot('SF1', 'sf', 'Winner QF1', 'Winner QF3'),
    slot('SF2', 'sf', 'Winner QF2', 'Winner QF4'),
    slot('F', 'final', 'Winner SF1', 'Winner SF2'),
  ];

  it('halves: QF1 and QF3 feed SF1, QF2 and QF4 feed SF2', () => {
    const h = bracketHalves(slots);
    expect(h.left.quarters.map((s) => s.slot)).toEqual(['QF1', 'QF3']);
    expect(h.left.semi?.slot).toBe('SF1');
    expect(h.right.quarters.map((s) => s.slot)).toEqual(['QF2', 'QF4']);
    expect(h.right.semi?.slot).toBe('SF2');
    expect(h.final?.slot).toBe('F');
  });

  it('the fixed quarter-final sources', () => {
    expect(slots.slice(0, 4).map((s) => `${s.homeSource} v ${s.awaySource}`)).toEqual([
      'A1 v D2',
      'A2 v B1',
      'B2 v C1',
      'C2 v D1',
    ]);
  });

  it('a missing slot is left out', () => {
    expect(bracketHalves([]).final).toBeNull();
    expect(bracketHalves([]).left.quarters).toEqual([]);
  });

  it('a side shows its source until the team is known', () => {
    expect(slotSide(slots[4], 'home')).toEqual({ teamId: null, name: 'Winner QF1', kitColour: null });
    const known = { ...slots[0], homeTeamId: 't', homeTeamName: 'Kato', homeKitColour: 'kitRed' };
    expect(slotSide(known, 'home')).toEqual({ teamId: 't', name: 'Kato', kitColour: 'kitRed' });
    expect(slotSide({ ...known, awayTeamId: 'u', awayTeamName: 'Paphos' }, 'away')).toEqual({
      teamId: 'u',
      name: 'Paphos',
      kitColour: null,
    });
  });
});

describe('registrationAction', () => {
  const base = { status: 'registration' as const, myTeams: [], teamsCount: 3, maxTeams: 16 };

  it('Register while open and I have no team in', () => {
    expect(registrationAction(base, ['c1'])).toBe('register');
    expect(registrationAction(base, [])).toBe('register');
  });

  it('Edit squad when the server lets my captained team edit', () => {
    const mine = { teamId: 'c1', teamName: 'X', kitColour: 'kitRed', isCaptain: true, canEditSquad: true, squad: [] };
    expect(registrationAction({ ...base, myTeams: [mine] }, ['c1'])).toBe('edit');
    expect(registrationAction({ ...base, myTeams: [{ ...mine, canEditSquad: false }] }, ['c1'])).toBeNull();
  });

  it('nothing when full, not open, or every captained team is in', () => {
    expect(registrationAction({ ...base, teamsCount: 16 }, ['c1'])).toBeNull();
    expect(registrationAction({ ...base, status: 'groups' }, ['c1'])).toBeNull();
    const member = { teamId: 'c1', teamName: 'X', kitColour: 'kitRed', isCaptain: false, canEditSquad: false, squad: [] };
    expect(registrationAction({ ...base, myTeams: [member] }, ['c1'])).toBeNull();
  });
});
