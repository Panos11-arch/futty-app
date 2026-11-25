import {
  assistsCounter,
  assistsValid,
  changeAssists,
  changeGoals,
  changeOwnGoals,
  draftFrom,
  goalsComplete,
  goalsCounter,
  goalsLogged,
  needsStats,
  pitchRows,
  reviewSides,
  scoresDiffer,
  setScore,
  sideLabel,
  STEP_PROGRESS,
  stepsFor,
  toStatsPayload,
  togglePlayed,
  canTogglePlayed,
  isOut,
  triesLeft,
  waitingForOther,
  winner,
} from '@/lib/match/log-score';
import { mockLogPlayer, mockMatchLog, mockNamedLog } from '@/lib/match/log-score-mock';

describe('log-score', () => {
  it('the progress bar: 0, 33, 66, 100', () => {
    expect(STEP_PROGRESS).toEqual({ score: 0, goals: 33, assists: 66, review: 100 });
  });

  it('starts from 0–0, or the score and stats already logged', () => {
    expect(draftFrom(mockMatchLog()).score).toEqual({ a: 0, b: 0 });
    const draft = draftFrom(
      mockNamedLog({
        myEntry: { a: 4, b: 1 },
        stats: { a: { players: [{ playerId: 'a2', goals: 3, assists: 1 }], ownGoals: 1 } },
      })
    );
    expect(draft.score).toEqual({ a: 4, b: 1 });
    expect(draft.goals.a).toEqual({ a2: 3 });
    expect(draft.assists.a).toEqual({ a2: 1 });
    expect(draft.ownGoals.a).toBe(1);
    expect(draftFrom(mockMatchLog({ score: { a: 2, b: 2 }, myEntry: { a: 1, b: 1 } })).score).toEqual({ a: 2, b: 2 });
  });

  it('the score never goes below 0', () => {
    const draft = setScore(draftFrom(mockMatchLog()), 'a', -1);
    expect(draft.score.a).toBe(0);
  });

  it('goals: + stops at the score, − at 0; Continue only when each side adds up exactly', () => {
    let draft = setScore(setScore(draftFrom(mockMatchLog()), 'a', 2), 'b', 1);
    expect(goalsComplete(draft, ['a', 'b'])).toBe(false);
    draft = changeGoals(draft, 'a', 'a2', 1);
    draft = changeGoals(draft, 'a', 'a2', 1);
    draft = changeGoals(draft, 'a', 'a3', 1); // a third goal for 2: ignored
    expect(draft.goals.a).toEqual({ a2: 2 });
    expect(goalsCounter(draft, 'a')).toBe('2 of 2');
    expect(goalsComplete(draft, ['a', 'b'])).toBe(false);
    draft = changeOwnGoals(draft, 'b', 1);
    expect(goalsLogged(draft, 'b')).toBe(1);
    expect(goalsComplete(draft, ['a', 'b'])).toBe(true);
    expect(goalsComplete(draft, ['a'])).toBe(true);
    draft = changeGoals(draft, 'a', 'a2', -1);
    draft = changeGoals(draft, 'a', 'a2', -1);
    draft = changeGoals(draft, 'a', 'a2', -1);
    expect(draft.goals.a).toEqual({});
    expect(changeOwnGoals(draft, 'a', -1).ownGoals.a).toBe(0);
  });

  it("assists are optional and never more than the side's goals", () => {
    let draft = setScore(draftFrom(mockMatchLog()), 'a', 1);
    expect(assistsValid(draft, ['a', 'b'])).toBe(true); // none at all
    draft = changeAssists(draft, 'a', 'a3', 1);
    draft = changeAssists(draft, 'a', 'a1', 1); // a second for 1 goal: ignored
    expect(draft.assists.a).toEqual({ a3: 1 });
    expect(assistsCounter(draft, 'a')).toBe('1 of up to 1 · optional');
    expect(assistsValid({ ...draft, assists: { a: { a3: 2 }, b: {} } }, ['a'])).toBe(false);
    expect(changeAssists(draft, 'a', 'a3', -1).assists.a).toEqual({});
  });

  it('the steps: all four the first time; after a mismatch, Goals and Assists only if his own side changed', () => {
    const first = mockNamedLog();
    expect(stepsFor(first, draftFrom(first))).toEqual(['score', 'goals', 'assists', 'review']);

    const again = mockNamedLog({ myEntry: { a: 4, b: 1 }, theirEntry: { a: 5, b: 1 } });
    const own = setScore(draftFrom(again), 'a', 5);
    expect(needsStats(again, own)).toBe(true);
    expect(stepsFor(again, own)).toEqual(['score', 'goals', 'assists', 'review']);
    const other = setScore(draftFrom(again), 'b', 2);
    expect(needsStats(again, other)).toBe(false);
    expect(stepsFor(again, other)).toEqual(['score', 'review']);

    const pickup = mockMatchLog({ myEntry: { a: 1, b: 0 } });
    expect(needsStats(pickup, draftFrom(pickup))).toBe(true);
    const correction = mockMatchLog({ status: 'confirmed', score: { a: 1, b: 0 }, canLog: false, canCorrect: true });
    expect(stepsFor(correction, draftFrom(correction))).toEqual(['goals', 'assists', 'review']);
  });

  it('the payload: only the sides he logs, every player with goals, assists and played, own goals', () => {
    let draft = setScore(setScore(draftFrom(mockMatchLog()), 'a', 2), 'b', 1);
    draft = changeGoals(draft, 'a', 'a2', 1);
    draft = changeOwnGoals(draft, 'a', 1);
    draft = changeAssists(draft, 'a', 'a3', 1);
    draft = changeGoals(draft, 'b', 'b2', 1);
    const log = mockMatchLog();
    expect(toStatsPayload(log, draft, ['a'])).toEqual({
      a: {
        players: [
          { playerId: 'a1', goals: 0, assists: 0, played: true },
          { playerId: 'a2', goals: 1, assists: 0, played: true },
          { playerId: 'a3', goals: 0, assists: 1, played: true },
        ],
        ownGoals: 1,
      },
    });
    expect(Object.keys(toStatsPayload(log, draft, ['a', 'b']))).toEqual(['a', 'b']);
    expect(toStatsPayload(log, togglePlayed(draft, 'a', 'a1'), ['a']).a?.players[0]).toEqual({
      playerId: 'a1', goals: 0, assists: 0, played: false,
    });
  });

  // Decision 1l (25 November): the captain confirms who played.
  describe("Didn't play", () => {
    it('everyone on his sides played the first time; after a save, players without a check-in start out', () => {
      const first = mockMatchLog();
      expect(['a1', 'a2', 'b1'].some((id) => isOut(draftFrom(first), id))).toBe(false);
      const saved = mockMatchLog({
        status: 'confirmed',
        score: { a: 1, b: 0 },
        canLog: false,
        canCorrect: true,
        players: [
          { ...mockLogPlayer('a1', 'a', 'Kostas'), checkIn: 'captain' },
          mockLogPlayer('a2', 'a', 'Panos'),
          { ...mockLogPlayer('b1', 'b', 'Marios'), checkIn: 'qr' },
        ],
      });
      const draft = draftFrom(saved);
      expect(isOut(draft, 'a1')).toBe(false);
      expect(isOut(draft, 'a2')).toBe(true);
      expect(isOut(draft, 'b1')).toBe(false);
    });

    it('marking a player out clears their goals and assists and blocks +; marking them back allows it again', () => {
      let draft = setScore(draftFrom(mockMatchLog()), 'a', 2);
      draft = changeGoals(draft, 'a', 'a2', 1);
      draft = changeAssists(draft, 'a', 'a2', 1);
      draft = togglePlayed(draft, 'a', 'a2');
      expect(isOut(draft, 'a2')).toBe(true);
      expect(draft.goals.a.a2).toBeUndefined();
      expect(draft.assists.a.a2).toBeUndefined();
      expect(changeGoals(draft, 'a', 'a2', 1)).toBe(draft);
      expect(changeAssists(draft, 'a', 'a2', 1)).toBe(draft);
      draft = togglePlayed(draft, 'a', 'a2');
      expect(changeGoals(draft, 'a', 'a2', 1).goals.a.a2).toBe(1);
    });

    it('the control: his sides only, never a QR or venue check-in, a voter, a guest, or once the ticks have closed', () => {
      const log = mockNamedLog();
      const p = (over: Partial<ReturnType<typeof mockLogPlayer>>, side: 'a' | 'b' = 'a') => ({
        ...mockLogPlayer('x', side, 'X'),
        ...over,
      });
      expect(canTogglePlayed(log, p({}))).toBe(true);
      expect(canTogglePlayed(log, p({ checkIn: 'captain' }))).toBe(true);
      expect(canTogglePlayed(log, p({}, 'b'))).toBe(false);
      expect(canTogglePlayed(log, p({ checkIn: 'qr' }))).toBe(false);
      expect(canTogglePlayed(log, p({ checkIn: 'venue' }))).toBe(false);
      expect(canTogglePlayed(log, p({ votedMotm: true }))).toBe(false);
      expect(canTogglePlayed(log, p({ profileId: null, guestName: 'Guest' }))).toBe(false);
      expect(canTogglePlayed({ ...log, ticksOpen: false }, p({}))).toBe(false);
    });
  });

  it('the review: scorers and assisters by count, own goals, and the locked side with its score only', () => {
    const log = mockNamedLog();
    let draft = setScore(setScore(draftFrom(log), 'a', 3), 'b', 2);
    draft = changeGoals(draft, 'a', 'a3', 1);
    draft = changeGoals(draft, 'a', 'a2', 1);
    draft = changeGoals(draft, 'a', 'a2', 1);
    draft = changeAssists(draft, 'a', 'a3', 1);
    const [a, b] = reviewSides(log, draft);
    expect(a).toMatchObject({
      label: 'Kato United',
      logged: true,
      goalsTotal: 3,
      goals: [
        { name: 'Panos', count: 2 },
        { name: 'Dimitris', count: 1 },
      ],
      assists: [{ name: 'Dimitris', count: 1 }],
      assistsTotal: 1,
    });
    expect(b).toMatchObject({ label: 'Paphos 5', logged: false, goals: [], assists: [] });

    const withOwn = changeOwnGoals(setScore(draftFrom(mockMatchLog()), 'b', 1), 'b', 1);
    expect(reviewSides(mockMatchLog(), withOwn)[1].goals).toEqual([{ name: 'Own goal', count: 1 }]);
  });

  it('mismatch, waiting and tries', () => {
    expect(scoresDiffer(mockNamedLog({ myEntry: { a: 1, b: 0 }, theirEntry: { a: 0, b: 1 } }))).toBe(true);
    expect(scoresDiffer(mockNamedLog({ myEntry: { a: 1, b: 0 }, theirEntry: { a: 1, b: 0 } }))).toBe(false);
    expect(scoresDiffer(mockNamedLog({ myEntry: { a: 1, b: 0 } }))).toBe(false);
    expect(waitingForOther(mockNamedLog({ myEntry: { a: 1, b: 0 } }))).toBe(true);
    expect(waitingForOther(mockMatchLog({ myEntry: { a: 1, b: 0 } }))).toBe(false); // one captain
    expect(triesLeft({ tries: 1, maxTries: 3 })).toBe(2);
    expect(triesLeft({ tries: 4, maxTries: 3 })).toBe(0);
  });

  it('winner, labels and the pitch rows (one at the goal, then two by two)', () => {
    expect(winner({ a: 4, b: 1 })).toBe('a');
    expect(winner({ a: 0, b: 1 })).toBe('b');
    expect(winner({ a: 2, b: 2 })).toBeNull();
    expect(sideLabel(mockMatchLog(), 'b')).toBe('Non-bibs');
    expect(sideLabel({ sides: [] }, 'a')).toBe('Bibs');
    expect(pitchRows([1, 2, 3, 4, 5])).toEqual([[1], [2, 3], [4, 5]]);
    expect(pitchRows([1, 2])).toEqual([[1], [2]]);
    expect(pitchRows([])).toEqual([]);
  });
});
