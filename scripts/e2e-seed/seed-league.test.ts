// Step 8 of the seed (seedLeague) against a small in-memory stand-in for the
// service-role client. The stand-in does what the database does for the
// calls the step makes: league_start_season makes Season 1, moves the
// sign-up rows and makes one fixture per pairing (sync_league_fixtures); an
// agreed fixture with a day gets its match (league_fixtures_sync_match);
// apply_match_levels on a confirmed match completes its fixture
// (matches_league_fixture_final).
import type { SupabaseClient } from '@supabase/supabase-js';

import { E2E_LEAGUE, E2E_TEAMS, E2E_USERS } from './config';
import { seedLeague } from './seed';

type Row = Record<string, unknown>;
type Filter = { col: string; op: 'eq' | 'in' | 'is'; value: unknown };

class FakeDb {
  tables: Record<string, Row[]> = {};
  rpcCalls: { fn: string; args: Row }[] = [];
  writes: { table: string; op: string; payload: unknown }[] = [];
  /** Set to make league_start_season do nothing (a broken start). */
  seasonStartBroken = false;
  private seq = 0;

  rows(table: string) {
    return (this.tables[table] ??= []);
  }

  newId(prefix: string) {
    return `${prefix}-${++this.seq}`;
  }

  /** league_fixtures_sync_match: an agreed fixture with a day gets one match. */
  syncMatch(fixture: Row) {
    if (fixture.status !== 'agreed' || !fixture.scheduled_day) return;
    const kickoff = `${fixture.scheduled_day}T${String(fixture.scheduled_time).slice(0, 5)}:00.000Z`;
    const match = this.rows('matches').find((m) => m.league_fixture_id === fixture.id);
    if (match) {
      if (match.status === 'scheduled') match.kickoff_at = kickoff;
      return;
    }
    const id = this.newId('match');
    this.rows('matches').push({ id, league_fixture_id: fixture.id, kickoff_at: kickoff, status: 'scheduled' });
    for (const [side, team] of [['a', fixture.home_team_id], ['b', fixture.away_team_id]] as const) {
      const member = this.rows('team_members').find((m) => m.team_id === team);
      this.rows('match_players').push({ id: this.newId('player'), match_id: id, profile_id: member?.profile_id ?? null, side, left_at: null });
    }
  }

  rpc(fn: string, args: Row) {
    this.rpcCalls.push({ fn, args });
    if (fn === 'league_start_season' && !this.seasonStartBroken) {
      const hub = this.rows('leagues').find((l) => l.id === args.p_hub_id)!;
      const season = {
        id: this.newId('season'),
        parent_league_id: hub.id,
        kind: 'season',
        season_number: 1,
        start_date: hub.start_date,
        name: 'Season 1',
      };
      this.rows('leagues').push(season);
      const signUps = this.rows('league_teams').filter((r) => r.league_id === hub.id);
      for (const r of signUps) r.league_id = season.id;
      const teams = signUps.map((r) => String(r.team_id)).sort();
      for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
          this.rows('league_fixtures').push({
            id: this.newId('fixture'),
            league_id: season.id,
            home_team_id: teams[i],
            away_team_id: teams[j],
            status: 'unscheduled',
          });
        }
      }
      return season.id;
    }
    if (fn === 'apply_match_levels') {
      const match = this.rows('matches').find((m) => m.id === args.p_match_id)!;
      if (match.levels_applied_at) return 'already';
      match.levels_applied_at = args.p_now;
      const fixture = this.rows('league_fixtures').find((f) => f.id === match.league_fixture_id)!;
      if (match.status === 'confirmed') {
        Object.assign(fixture, { status: 'completed', home_score: match.side_a_score, away_score: match.side_b_score });
      }
      return 'applied';
    }
    return null;
  }

  client(): SupabaseClient {
    return {
      from: (table: string) => new FakeQuery(this, table),
      rpc: async (fn: string, args: Row) => ({ data: this.rpc(fn, args), error: null }),
    } as unknown as SupabaseClient;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private op: 'select' | 'update' | 'delete' | 'upsert' | 'insert' = 'select';
  private payload: unknown;
  private onConflict = 'id';
  private ignoreDuplicates = false;
  private filters: Filter[] = [];
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select() {
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    this.payload = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = 'insert';
    this.payload = rows;
    return this;
  }
  upsert(rows: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.payload = rows;
    this.onConflict = opts.onConflict ?? 'id';
    this.ignoreDuplicates = opts.ignoreDuplicates ?? false;
    return this;
  }
  eq(col: string, value: unknown) {
    this.filters.push({ col, op: 'eq', value });
    return this;
  }
  in(col: string, value: unknown[]) {
    this.filters.push({ col, op: 'in', value });
    return this;
  }
  is(col: string, value: unknown) {
    this.filters.push({ col, op: 'is', value });
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }

  private matches(row: Row) {
    return this.filters.every((f) =>
      f.op === 'in' ? (f.value as unknown[]).includes(row[f.col]) : (row[f.col] ?? null) === f.value,
    );
  }

  private run(): unknown {
    const rows = this.db.rows(this.table);
    if (this.op !== 'select') this.db.writes.push({ table: this.table, op: this.op, payload: this.payload });
    switch (this.op) {
      case 'select': {
        const found = rows.filter((r) => this.matches(r)).map((r) => ({ ...r }));
        if (this.mode === 'many') return found;
        if (this.mode === 'single' && found.length !== 1) throw new Error(`${this.table}: ${found.length} rows for single()`);
        return found[0] ?? null;
      }
      case 'update':
        for (const r of rows.filter((x) => this.matches(x))) {
          Object.assign(r, this.payload);
          if (this.table === 'league_fixtures') this.db.syncMatch(r);
        }
        return null;
      case 'delete':
        this.db.tables[this.table] = rows.filter((r) => !this.matches(r));
        return null;
      case 'insert':
        rows.push(...([] as Row[]).concat(this.payload as Row[]).map((r) => ({ id: this.db.newId(this.table), ...r })));
        return null;
      case 'upsert': {
        const keys = this.onConflict.split(',');
        for (const r of ([] as Row[]).concat(this.payload as Row[])) {
          const existing = rows.find((x) => keys.every((k) => x[k] === r[k]));
          let target = existing;
          if (existing) {
            if (!this.ignoreDuplicates) Object.assign(existing, r);
          } else {
            target = { id: this.db.newId(this.table), ...r };
            rows.push(target);
          }
          if (this.table === 'league_fixtures' && target) this.db.syncMatch(target);
        }
        return null;
      }
    }
  }

  then<A, B>(ok?: ((v: { data: unknown; error: null }) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve()
      .then(() => ({ data: this.run(), error: null as null }))
      .then(ok, fail);
  }
}

const ids = new Map(E2E_USERS.map((u, i) => [u.email, `profile-${i}`]));
const firstRun = new Date('2026-11-27T10:00:00Z');
const secondRun = new Date('2026-11-28T10:00:00Z');

const seasons = (db: FakeDb) => db.rows('leagues').filter((l) => l.parent_league_id === E2E_LEAGUE.id && l.kind === 'season');
const seasonFixtures = (db: FakeDb) => db.rows('league_fixtures').filter((f) => f.league_id === seasons(db)[0]?.id);
const upcoming = (db: FakeDb) =>
  seasonFixtures(db).filter((f) => f.home_team_id === E2E_TEAMS[1].id && f.away_team_id === E2E_TEAMS[0].id);
const calls = (db: FakeDb, fn: string) => db.rpcCalls.filter((c) => c.fn === fn);

describe('seedLeague (step 8) against a fake database', () => {
  it('the first run starts Season 1 once and makes all six results final, plus the upcoming fixture', async () => {
    const db = new FakeDb();
    await seedLeague(db.client(), ids, firstRun);

    expect(calls(db, 'league_start_season')).toEqual([{ fn: 'league_start_season', args: { p_hub_id: E2E_LEAGUE.id } }]);
    expect(seasons(db)).toHaveLength(1);
    expect(db.rows('leagues').find((l) => l.id === E2E_LEAGUE.id)).toMatchObject({ scope: 'E2E', stage: 'signup' });
    expect(seasonFixtures(db).filter((f) => f.status === 'completed')).toHaveLength(6);
    expect(calls(db, 'apply_match_levels')).toHaveLength(6);
    expect(upcoming(db)).toEqual([expect.objectContaining({ status: 'agreed', scheduled_day: '2026-11-30' })]);
    expect(db.rows('matches')).toHaveLength(7);
  });

  it('a second run starts no second season, adds no duplicate upcoming fixture and leaves the results alone', async () => {
    const db = new FakeDb();
    await seedLeague(db.client(), ids, firstRun);
    const finalised = db.rows('matches').filter((m) => m.levels_applied_at).map((m) => ({ ...m }));
    db.rpcCalls = [];
    db.writes = [];

    await seedLeague(db.client(), ids, secondRun);

    expect(calls(db, 'league_start_season')).toEqual([]);
    expect(seasons(db)).toHaveLength(1);
    expect(seasonFixtures(db)).toHaveLength(7);
    expect(upcoming(db)).toEqual([expect.objectContaining({ scheduled_day: '2026-12-01' })]);
    expect(db.rows('matches')).toHaveLength(7);
    // No completed fixture is scheduled, confirmed or made final again.
    expect(calls(db, 'apply_match_levels')).toEqual([]);
    expect(db.writes.filter((w) => ['matches', 'match_goals', 'match_attendance', 'match_player_ratings'].includes(w.table))).toEqual([]);
    expect(db.writes.filter((w) => w.table === 'league_fixtures' && w.op === 'update')).toEqual([]);
    expect(db.rows('matches').filter((m) => m.levels_applied_at)).toEqual(finalised);
  });

  it('stops when Season 1 is not created', async () => {
    const db = new FakeDb();
    db.seasonStartBroken = true;
    await expect(seedLeague(db.client(), ids, firstRun)).rejects.toThrow(/Season 1 was not created/);
    expect(seasonFixtures(db)).toEqual([]);
  });
});
