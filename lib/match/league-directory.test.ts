import type { League } from '@/lib/leagues';
import type { TournamentHeader } from '@/lib/match/tournament-api';
import {
  buildLeagueDirectory,
  competitionBadge,
  competitionKey,
  competitionName,
  groupBadge,
  LEAGUE_FORMATS,
  normaliseScope,
  scopeLabel,
} from '@/lib/match/league-directory';

// lib/premium (Team Premium's flag) loads the Supabase client.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const league = (over: Partial<League>): League => ({
  id: 'l1',
  name: 'Limassol 5s',
  format: '5-a-side',
  scope: 'Limassol',
  stage: 'signup',
  start_date: null,
  season_weeks: null,
  capacity: 8,
  parent_league_id: null,
  ...over,
});

describe('normaliseScope and competitionKey', () => {
  it('trims and ignores case, so "Limassol" and "limassol " are one city', () => {
    expect(normaliseScope(' Limassol ')).toBe('limassol');
    expect(competitionKey('Limassol', '5-a-side')).toBe(competitionKey('limassol ', '5-a-side'));
    expect(competitionKey('Island-wide', '7-a-side')).toBe('league:island-wide:7-a-side');
  });

  it('labels a scope for display', () => {
    expect(scopeLabel('limassol')).toBe('Limassol');
    expect(scopeLabel('agia napa')).toBe('Agia Napa');
    expect(scopeLabel('island-wide')).toBe('Island-wide');
  });

  it('names a competition with no league row "<City> <format> League"', () => {
    expect(competitionName('nicosia', '5-a-side')).toBe('Nicosia 5-a-side League');
    expect(competitionName('island-wide', '7-a-side')).toBe('Cyprus Open 7-a-side League');
  });
});

describe('badges', () => {
  it('a group shows its first two letters, a competition its area and players', () => {
    expect(groupBadge('Limassol')).toBe('LI');
    expect(groupBadge('Cyprus Open League')).toBe('CY');
    expect(competitionBadge('limassol', '5-a-side')).toBe('L5');
    expect(competitionBadge('Island-wide', '11-a-side')).toBe('C11');
    expect(competitionBadge('paphos', 'odd')).toBe('P');
  });
});

describe('buildLeagueDirectory', () => {
  it('lists all five formats for the Cyprus Open League and every city with a league, Coming soon without a row', () => {
    const dir = buildLeagueDirectory([league({ scope: 'Limassol', format: '5-a-side', stage: 'signup' })], []);
    expect(dir.open.label).toBe('Cyprus Open League');
    expect(dir.open.entries.map((e) => e.format)).toEqual([...LEAGUE_FORMATS]);
    expect(dir.open.entries.every((e) => e.state === 'coming_soon')).toBe(true);
    expect(dir.open.subtitle).toBe('Island-wide · Coming soon');
    expect(dir.open.entries[0].name).toBe('Cyprus Open 5-a-side League');

    expect(dir.cities.map((c) => c.label)).toEqual(['Limassol']);
    const limassol = dir.cities[0];
    expect(limassol.subtitle).toBe('5 leagues');
    expect(limassol.entries.map((e) => [e.format, e.state, e.stageLabel])).toEqual([
      ['5-a-side', 'signup', 'Sign-up open'],
      ['6-a-side', 'coming_soon', 'Coming soon'],
      ['7-a-side', 'coming_soon', 'Coming soon'],
      ['9-a-side', 'coming_soon', 'Coming soon'],
      ['11-a-side', 'coming_soon', 'Coming soon'],
    ]);
    expect(limassol.entries[0].name).toBe('Limassol 5s');
    expect(limassol.entries[0].league?.id).toBe('l1');
    expect(limassol.entries[3].name).toBe('Limassol 9-a-side League');
    expect(limassol.entries[3].league).toBeNull();
  });

  const nineAndEleven = [
    league({ id: 'n9', format: '9-a-side', scope: 'Nicosia', stage: 'season', name: 'Nicosia 9s' }),
    league({ id: 'n11', format: '11-a-side', scope: 'Nicosia', stage: 'signup', name: 'Nicosia 11s' }),
  ];

  it('9 and 11-a-side show Coming soon while Team Premium is off, even with a season', () => {
    const nicosia = buildLeagueDirectory(nineAndEleven, []).cities[0].entries;
    expect(nicosia.find((e) => e.format === '9-a-side')).toMatchObject({ state: 'coming_soon', stageLabel: 'Coming soon' });
    expect(nicosia.find((e) => e.format === '11-a-side')).toMatchObject({ state: 'coming_soon', stageLabel: 'Coming soon' });
  });

  it('9 and 11-a-side open with Team Premium on', () => {
    const nicosia = buildLeagueDirectory(nineAndEleven, [], { teamPremiumEnabled: true }).cities[0].entries;
    expect(nicosia.find((e) => e.format === '9-a-side')?.state).toBe('running');
    expect(nicosia.find((e) => e.format === '11-a-side')?.state).toBe('signup');
  });

  it('an explicit coming_soon stage is Coming soon', () => {
    const dir = buildLeagueDirectory([league({ stage: 'coming_soon' })], []);
    expect(dir.cities[0].entries[0]).toMatchObject({ state: 'coming_soon', league: { id: 'l1' } });
  });

  it('season and divisions are running; any other stage is Coming soon', () => {
    const dir = buildLeagueDirectory(
      [
        league({ id: 'a', format: '5-a-side', stage: 'season' }),
        league({ id: 'b', format: '6-a-side', stage: 'divisions' }),
        league({ id: 'c', format: '7-a-side', stage: 'archived' }),
      ],
      [],
    );
    expect(dir.cities[0].entries.slice(0, 3).map((e) => [e.state, e.stageLabel])).toEqual([
      ['running', 'In season'],
      ['running', 'In season'],
      ['coming_soon', 'Coming soon'],
    ]);
  });

  it('merges scopes that differ only in case or spaces, and ignores divisions', () => {
    const dir = buildLeagueDirectory(
      [
        league({ id: 'hub', scope: 'Limassol', format: '5-a-side', stage: 'divisions' }),
        league({ id: 'div1', scope: 'Limassol', format: '5-a-side', stage: 'season', name: 'Division 1', parent_league_id: 'hub' }),
        league({ id: 'x', scope: ' limassol', format: '7-a-side', stage: 'signup', name: 'Limassol 7s' }),
      ],
      [],
    );
    expect(dir.cities).toHaveLength(1);
    const entries = dir.cities[0].entries;
    expect(entries[0].league?.id).toBe('hub');
    expect(entries[2].league?.id).toBe('x');
  });

  it('a city with only a division row does not appear', () => {
    const dir = buildLeagueDirectory([league({ scope: 'Paphos', parent_league_id: 'gone' })], []);
    expect(dir.cities).toEqual([]);
  });

  it('puts Nicosia, Limassol, Larnaca and Paphos first, then the rest A to Z; Island-wide is never a city', () => {
    const dir = buildLeagueDirectory(
      [
        league({ id: '1', scope: 'Paralimni' }),
        league({ id: '2', scope: 'Larnaca' }),
        league({ id: '3', scope: 'Ayia Napa' }),
        league({ id: '4', scope: 'Nicosia' }),
        league({ id: '5', scope: 'Island-wide', stage: 'season', name: 'Cyprus Open 5s' }),
      ],
      [],
    );
    expect(dir.cities.map((c) => c.label)).toEqual(['Nicosia', 'Larnaca', 'Ayia Napa', 'Paralimni']);
    expect(dir.open.entries[0].league?.id).toBe('5');
    expect(dir.open.subtitle).toBe('Island-wide · 5 leagues');
  });

  it('pins: pinned entries show in Pinned and are marked, keyed by scope and format', () => {
    const dir = buildLeagueDirectory(
      [league({ id: 'l1', scope: 'Limassol', format: '5-a-side' })],
      [{ target_type: 'league', scope: 'limassol', format: '5-a-side' }],
    );
    expect(dir.pinned.map((e) => e.key)).toEqual(['league:limassol:5-a-side']);
    expect(dir.pinned[0].pinned).toBe(true);
    expect(dir.cities[0].entries[0].pinned).toBe(true);
    expect(dir.cities[0].entries[1].pinned).toBe(false);
  });

  it('a pin made in one season still shows when the next season is a new league row', () => {
    const pins = [{ target_type: 'league' as const, scope: 'limassol', format: '5-a-side' }];
    const before = buildLeagueDirectory([league({ id: 'old', stage: 'season' })], pins);
    const after = buildLeagueDirectory([league({ id: 'new', stage: 'signup' })], pins);
    expect(before.pinned[0].league?.id).toBe('old');
    expect(after.pinned[0].league?.id).toBe('new');
    expect(after.pinned[0].key).toBe(before.pinned[0].key);
  });

  it('a pin whose league is gone between seasons still shows, as Coming soon', () => {
    const dir = buildLeagueDirectory([], [{ target_type: 'league', scope: 'larnaca', format: '9-a-side' }]);
    expect(dir.pinned).toHaveLength(1);
    expect(dir.pinned[0]).toMatchObject({ name: 'Larnaca 9-a-side League', state: 'coming_soon', area: 'Larnaca' });
  });

  it('ignores pins it does not understand (another target type or format)', () => {
    const dir = buildLeagueDirectory([], [
      { target_type: 'tournament' as 'league', scope: 'x', format: '5-a-side' },
      { target_type: 'league', scope: 'x', format: '8-a-side' },
    ]);
    expect(dir.pinned).toEqual([]);
  });

  describe('tournaments (S10A)', () => {
    const header = (over: Partial<TournamentHeader> = {}): TournamentHeader => ({
      id: 't1',
      name: 'Nuevo Campo Cup',
      area: 'Limassol',
      country: 'CY',
      format: '5-a-side',
      status: 'coming_soon',
      comingSoon: true,
      startDate: null,
      endDate: null,
      venueId: null,
      venueName: null,
      maxTeams: 16,
      teamsCount: 0,
      entryFeeCents: 1200,
      championTeamId: null,
      ...over,
    });

    it('no tournaments: no group and nothing pinned', () => {
      const dir = buildLeagueDirectory([], []);
      expect(dir.tournaments).toBeNull();
      expect(dir.pinnedTournaments).toEqual([]);
    });

    it('a Tournaments group, "1 coming soon", each row "Tournament · <status>"', () => {
      const dir = buildLeagueDirectory([], [], { tournaments: [header()] });
      expect(dir.tournaments).toMatchObject({ label: 'Tournaments', subtitle: '1 coming soon' });
      expect(dir.tournaments!.entries[0]).toMatchObject({
        key: 'tournament:t1',
        name: 'Nuevo Campo Cup',
        subtitle: 'Tournament · Coming soon',
        pinned: false,
      });
    });

    it('counts tournaments once one is open', () => {
      const dir = buildLeagueDirectory([], [], {
        tournaments: [header(), header({ id: 't2', status: 'registration', comingSoon: false })],
      });
      expect(dir.tournaments!.subtitle).toBe('2 tournaments');
      expect(dir.tournaments!.entries[1].subtitle).toBe('Tournament · Sign-up open');
      const one = buildLeagueDirectory([], [], { tournaments: [header({ status: 'groups', comingSoon: false })] });
      expect(one.tournaments!.subtitle).toBe('1 tournament');
    });

    it('a tournament pin shows under Pinned, marked, and leaves league pins alone', () => {
      const dir = buildLeagueDirectory(
        [league({ scope: 'Limassol', format: '5-a-side' })],
        [
          { target_type: 'tournament', tournament_id: 't1' },
          { target_type: 'league', scope: 'limassol', format: '5-a-side' },
          { target_type: 'tournament', tournament_id: 't1' },
        ],
        { tournaments: [header()] },
      );
      expect(dir.pinnedTournaments.map((e) => e.key)).toEqual(['tournament:t1']);
      expect(dir.tournaments!.entries[0].pinned).toBe(true);
      expect(dir.pinned.map((e) => e.key)).toEqual(['league:limassol:5-a-side']);
    });

    it('a pin for a tournament that is no longer listed is not shown', () => {
      const dir = buildLeagueDirectory([], [{ target_type: 'tournament', tournament_id: 'gone' }], { tournaments: [header()] });
      expect(dir.pinnedTournaments).toEqual([]);
    });
  });
});
