// Test data for the logging screens (S13B): a pickup the viewer booked
// (both sides his) unless overridden. Names and numbers are sample data.
import type { MatchLog, MatchLogPlayer } from '@/lib/match/log-score';
import type { Side } from '@/lib/match/types';

export function mockLogPlayer(id: string, side: Side, name: string): MatchLogPlayer {
  return {
    playerId: id,
    profileId: `prof-${id}`,
    name,
    guestName: null,
    side,
    avatarStyle: null,
    avatarKitColour: null,
    avatarNumber: null,
  };
}

export const LOG_PLAYERS: MatchLogPlayer[] = [
  mockLogPlayer('a1', 'a', 'Kostas'),
  mockLogPlayer('a2', 'a', 'Panos'),
  mockLogPlayer('a3', 'a', 'Dimitris'),
  mockLogPlayer('b1', 'b', 'Marios'),
  mockLogPlayer('b2', 'b', 'Chris'),
];

export function mockMatchLog(overrides: Partial<MatchLog> = {}): MatchLog {
  return {
    matchId: 'm1',
    status: 'played',
    kind: 'pickup',
    kickoffAt: '2026-11-26T18:00:00Z',
    kickoffLocal: '2026-11-26T20:00:00',
    venueName: 'Kamares',
    pitchName: 'Pitch 2',
    sides: [
      { side: 'a', label: 'Bibs', teamId: null },
      { side: 'b', label: 'Non-bibs', teamId: null },
    ],
    writableSides: ['a', 'b'],
    canLog: true,
    canCorrect: false,
    correctionsUntil: null,
    score: null,
    myEntry: null,
    theirEntry: null,
    tries: 0,
    maxTries: 3,
    players: LOG_PLAYERS,
    stats: { a: { players: [], ownGoals: 0 }, b: { players: [], ownGoals: 0 } },
    ...overrides,
  };
}

/** A named game: the viewer captains side a only; side b is locked. */
export function mockNamedLog(overrides: Partial<MatchLog> = {}): MatchLog {
  return mockMatchLog({
    kind: 'named',
    sides: [
      { side: 'a', label: 'Kato United', teamId: 't1' },
      { side: 'b', label: 'Paphos 5', teamId: 't2' },
    ],
    writableSides: ['a'],
    stats: { a: { players: [], ownGoals: 0 } },
    ...overrides,
  });
}
