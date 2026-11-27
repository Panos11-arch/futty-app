// Step 9 of the seed (seedTournaments, S10A) against a small stand-in for the
// service-role client: it checks the rows are ours, puts both tournaments
// back, clears their pins, and makes only the e2e logins admins.
import type { SupabaseClient } from '@supabase/supabase-js';

import { E2E_ADMIN_EMAILS, E2E_EMAIL_DOMAIN, E2E_TOURNAMENTS } from './config';
import { assertE2eTournaments } from './reset';
import { e2eTournamentRows, seedTournaments } from './seed';

type Call = { table: string; op: string; payload?: unknown; filter?: unknown };

function fakeAdmin(existing: { id: string; name: string; area: string }[], failOn?: string) {
  const calls: Call[] = [];
  const result = (table: string, op: string) =>
    Promise.resolve(failOn === `${table}.${op}` ? { data: null, error: { message: 'boom' } } : { data: op === 'select' ? existing : null, error: null });
  const admin = {
    from: (table: string) => ({
      select: () => ({
        in: (_col: string, values: unknown) => {
          calls.push({ table, op: 'select', filter: values });
          return result(table, 'select');
        },
      }),
      delete: () => ({
        in: (_col: string, values: unknown) => {
          calls.push({ table, op: 'delete', filter: values });
          return result(table, 'delete');
        },
      }),
      upsert: (payload: unknown) => {
        calls.push({ table, op: 'upsert', payload });
        return result(table, 'upsert');
      },
    }),
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

const ids = new Map([
  [`e2e-ios-1@${E2E_EMAIL_DOMAIN}`, 'ios-1'],
  [`e2e-android-1@${E2E_EMAIL_DOMAIN}`, 'android-1'],
  [`e2e-ios-2@${E2E_EMAIL_DOMAIN}`, 'ios-2'],
]);

describe('seedTournaments', () => {
  it('writes one Coming soon and one open tournament, clears their pins, and makes the two platform-1 logins admins', async () => {
    const { admin, calls } = fakeAdmin([]);
    await seedTournaments(admin, ids);
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual([
      'tournaments.select',
      'tournament_pins.delete',
      'tournaments.upsert',
      'app_admins.upsert',
    ]);
    const rows = calls[2].payload as { id: string; status: string; start_date: null; area: string }[];
    expect(rows.map((r) => [r.id, r.status, r.start_date, r.area])).toEqual([
      [E2E_TOURNAMENTS.comingSoon.id, 'coming_soon', null, 'E2E'],
      [E2E_TOURNAMENTS.open.id, 'registration', null, 'E2E'],
    ]);
    expect(calls[3].payload).toEqual([{ profile_id: 'ios-1' }, { profile_id: 'android-1' }]);
  });

  it('admins are e2e logins only', () => {
    for (const email of E2E_ADMIN_EMAILS) expect(email.endsWith(`@${E2E_EMAIL_DOMAIN}`)).toBe(true);
  });

  it('stops before writing when a tournament id holds somebody else’s row', async () => {
    const { admin, calls } = fakeAdmin([{ id: E2E_TOURNAMENTS.open.id, name: 'Nuevo Campo Cup', area: 'Limassol' }]);
    await expect(seedTournaments(admin, ids)).rejects.toThrow(/not an e2e tournament/);
    expect(calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  it('stops when an admin login is missing, or a write fails', async () => {
    await expect(seedTournaments(fakeAdmin([]).admin, new Map())).rejects.toThrow(/no login for admin/);
    await expect(seedTournaments(fakeAdmin([], 'tournaments.upsert').admin, ids)).rejects.toThrow(/writing the e2e tournaments failed/);
  });

  it('the rows are 16-team, fee shown only, no dates', () => {
    expect(e2eTournamentRows('x')[0]).toMatchObject({ max_teams: 16, entry_fee_cents: 500, match_minutes: 50, created_by: 'x' });
  });

  it('assertE2eTournaments accepts our own rows', () => {
    expect(() =>
      assertE2eTournaments([{ id: E2E_TOURNAMENTS.comingSoon.id, name: E2E_TOURNAMENTS.comingSoon.name, area: 'E2E' }]),
    ).not.toThrow();
    expect(() => assertE2eTournaments([{ id: 'other', name: 'E2E Cup', area: 'E2E' }])).toThrow();
  });
});
