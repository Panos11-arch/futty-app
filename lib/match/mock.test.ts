// The mock data must obey the same rules as the match_result_confirmed view
// (docs/specs/match-record.md section 6.2), so components built on it work
// unchanged on real rows.
import { mockFormEntries, mockMatchItems } from '@/lib/match/mock';
import type { MatchResultConfirmed } from '@/lib/match/types';

const VIEW_COLUMNS = [
  'match_id',
  'booking_id',
  'venue_id',
  'friendly_match_id',
  'league_fixture_id',
  'side_a_team_id',
  'side_b_team_id',
  'side_a_score',
  'side_b_score',
  'outcome',
  'result_status',
  'disputed',
  'confirmed_via',
  'forfeit_side',
  'forfeit_reason',
  'kickoff_at',
  'ends_at',
  'kickoff_local',
  'ends_local',
  'settled_at',
];

const results = [
  ...mockMatchItems.flatMap((i) => (i.result ? [i.result] : [])),
  ...mockFormEntries.map((e) => e.result),
];

describe('mock match data', () => {
  it('covers every match status', () => {
    expect(new Set(mockMatchItems.map((i) => i.match.status))).toEqual(
      new Set(['scheduled', 'played', 'confirmed', 'disputed', 'no_result', 'void']),
    );
  });

  it('has a result row only for settled matches, with the same status', () => {
    for (const i of mockMatchItems) {
      if (['scheduled', 'played', 'void'].includes(i.match.status)) {
        expect(i.result).toBeNull();
      } else {
        expect(i.result?.result_status).toBe(i.match.status);
        expect(i.result?.match_id).toBe(i.match.id);
      }
    }
  });

  it.each(results.map((r) => [r.match_id, r] as const))('%s has exactly the view columns', (_, r) => {
    expect(Object.keys(r)).toEqual(VIEW_COLUMNS);
  });

  it.each(results.map((r) => [r.match_id, r] as const))('%s follows the view rules', (_, r: MatchResultConfirmed) => {
    expect(r.disputed).toBe(r.result_status === 'disputed');
    expect(r.forfeit_side === null).toBe(r.forfeit_reason === null);
    if (r.result_status !== 'confirmed') {
      expect(r).toMatchObject({ side_a_score: null, side_b_score: null, outcome: null, confirmed_via: null });
    } else if (r.forfeit_side) {
      expect(r).toMatchObject({ side_a_score: null, side_b_score: null, confirmed_via: 'forfeit' });
      expect(r.outcome).toBe(r.forfeit_side === 'a' ? 'side_b_won' : 'side_a_won');
    } else {
      const [a, b] = [r.side_a_score as number, r.side_b_score as number];
      expect(r.outcome).toBe(a > b ? 'side_a_won' : a < b ? 'side_b_won' : 'draw');
      expect(r.confirmed_via).not.toBe('forfeit');
    }
  });

  it('includes a player who held a spot but did not check in (decision 1b.2)', () => {
    const missed = mockFormEntries.some((e) =>
      e.players.some(
        (p) =>
          p.share_id !== null &&
          p.left_at === null &&
          !e.attendance.some((a) => a.profile_id === p.profile_id) &&
          e.result.forfeit_side === null,
      ),
    );
    expect(missed).toBe(true);
  });

  it('gives Cyprus wall-clock times in kickoff_local', () => {
    const before = results.find((r) => r.kickoff_at === '2026-10-24T16:00:00.000Z');
    const after = results.find((r) => r.kickoff_at === '2026-10-31T17:00:00.000Z');
    expect(before?.kickoff_local).toBe('2026-10-24T19:00:00');
    expect(after?.kickoff_local).toBe('2026-10-31T19:00:00');
  });
});
