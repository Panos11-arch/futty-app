import type { MatchRatings } from '@/lib/match/levels';
import {
  mockMatchPage,
  mockPagePlayer,
  mockResultMatch,
  mockRoster,
  PAGE_CLOSED,
  PAGE_CLOSES_AT,
  PAGE_OPEN,
  RESULT_AFTER_END,
  RESULT_BEFORE_KICKOFF,
  RESULT_DEADLINE,
  RESULT_PEOPLE,
} from '@/lib/match/mock';
import type { MatchPage } from '@/lib/match/page';
import { postMatchSteps, type PostMatchInput, type PostMatchStep } from '@/lib/match/post-match';

const { me: ME, booker: BOOKER, awayCaptain: AWAY_CAPTAIN } = RESULT_PEOPLE;
const none = new Set<string>();

const ratings = (over: Partial<MatchRatings> = {}): MatchRatings => ({
  ratingsOpen: true,
  ratingsCloseAt: PAGE_CLOSES_AT,
  players: [],
  myRatings: [],
  ...over,
});

/** A confirmed 2–1 pickup, with the page, squad and ratings loaded. */
function confirmed(over: Partial<PostMatchInput> = {}, page: Partial<MatchPage> = {}): PostMatchInput {
  return {
    match: mockResultMatch({ status: 'confirmed', scores: [2, 1], mySide: 'a' }),
    page: mockMatchPage(page),
    roster: mockRoster(),
    ratings: ratings(),
    viewerId: ME,
    captainTeamIds: none,
    ...over,
  };
}

/** Played, waiting for a result: no page details, no ratings yet. */
function pending(over: Partial<PostMatchInput> = {}): PostMatchInput {
  return {
    match: mockResultMatch({ mySide: 'a' }),
    page: mockMatchPage({ status: 'played' }),
    roster: mockRoster(),
    ratings: null,
    viewerId: ME,
    captainTeamIds: none,
    ...over,
  };
}

const steps = (input: PostMatchInput, now: number): PostMatchStep[] => postMatchSteps(input, now);
const names = (input: PostMatchInput, now: number) => steps(input, now).map((s) => s.step);
const stateOf = (input: PostMatchInput, now: number, step: PostMatchStep['step']) =>
  steps(input, now).find((s) => s.step === step)?.state ?? null;

describe('postMatchSteps: the order', () => {
  it('score, goals, vote, ratings, for the captain straight after the game', () => {
    expect(steps(pending({ viewerId: BOOKER }), RESULT_AFTER_END)).toEqual([
      { step: 'score', state: 'act' },
      { step: 'goals', state: 'not_open' },
      { step: 'motm', state: 'not_open' },
      { step: 'ratings', state: 'not_open' },
    ]);
  });
});

describe('postMatchSteps: the score', () => {
  it('a captain with no score entered enters it', () => {
    expect(stateOf(pending({ viewerId: BOOKER }), RESULT_AFTER_END, 'score')).toBe('act');
  });

  it('a player who is not a captain waits for their captain', () => {
    expect(stateOf(pending(), RESULT_AFTER_END, 'score')).toBe('waiting');
  });

  it('pickup: a Non-bibs player answers the submitted score', () => {
    const match = mockResultMatch({ submission: {}, mySide: 'b' });
    expect(stateOf(pending({ match }), RESULT_AFTER_END, 'score')).toBe('act');
  });

  it("named: the other side's captain answers it", () => {
    const match = mockResultMatch({ kind: 'named', submission: {}, mySide: 'b' });
    expect(stateOf(pending({ match, viewerId: AWAY_CAPTAIN }), RESULT_AFTER_END, 'score')).toBe('act');
  });

  it('already done: the captain who entered it has nothing left to do', () => {
    const match = mockResultMatch({ submission: {} });
    expect(stateOf(pending({ match, viewerId: BOOKER }), RESULT_AFTER_END, 'score')).toBeNull();
  });

  it('already done: a player on the submitting side, once the score is in', () => {
    const match = mockResultMatch({ submission: {}, mySide: 'a' });
    expect(stateOf(pending({ match }), RESULT_AFTER_END, 'score')).toBeNull();
  });

  it('a player with no side in a pickup has nothing to do', () => {
    const match = mockResultMatch({ submission: {}, mySide: null });
    expect(stateOf(pending({ match }), RESULT_AFTER_END, 'score')).toBeNull();
  });

  it('closed: exactly at the result deadline', () => {
    expect(stateOf(pending({ viewerId: BOOKER }), Date.parse(RESULT_DEADLINE), 'score')).toBeNull();
  });

  it('before kickoff there is no score step', () => {
    expect(stateOf(pending({ viewerId: BOOKER }), RESULT_BEFORE_KICKOFF, 'score')).toBeNull();
  });

  it('a settled match has no score step', () => {
    expect(stateOf(confirmed({ viewerId: BOOKER }), PAGE_OPEN, 'score')).toBeNull();
    for (const status of ['disputed', 'no_result', 'void'] as const) {
      const match = mockResultMatch({ status });
      expect(stateOf(pending({ match, viewerId: BOOKER }), RESULT_AFTER_END, 'score')).toBeNull();
    }
  });
});

describe('postMatchSteps: goals and assists (captains only)', () => {
  it("the pickup's booker adds goals once the result is confirmed", () => {
    expect(stateOf(confirmed({ viewerId: BOOKER }), PAGE_OPEN, 'goals')).toBe('act');
  });

  it("named: each side's captain adds their own side", () => {
    const match = mockResultMatch({ kind: 'named', status: 'confirmed', scores: [2, 1] });
    const page = { kind: 'named' as const };
    expect(stateOf(confirmed({ match, viewerId: AWAY_CAPTAIN }, page), PAGE_OPEN, 'goals')).toBe('act');
  });

  it('a player who is not a captain never gets it', () => {
    expect(stateOf(confirmed(), PAGE_OPEN, 'goals')).toBeNull();
    expect(stateOf(pending(), RESULT_AFTER_END, 'goals')).toBeNull();
  });

  it('not open yet: before the result is confirmed', () => {
    expect(stateOf(pending({ viewerId: BOOKER }), RESULT_AFTER_END, 'goals')).toBe('not_open');
  });

  it('closed: exactly when scorers close', () => {
    expect(stateOf(confirmed({ viewerId: BOOKER }), PAGE_CLOSED, 'goals')).toBeNull();
  });

  it('already done: every goal of every side they write has a scorer choice', () => {
    const goals: MatchPage['goals'] = [
      { side: 'a', scorer: mockPagePlayer('p-me'), assist: null },
      { side: 'a', scorer: null, assist: null },
      { side: 'b', scorer: mockPagePlayer('p-nikos'), assist: null },
    ];
    expect(stateOf(confirmed({ viewerId: BOOKER }, { goals }), PAGE_OPEN, 'goals')).toBeNull();
  });

  it('one side still missing keeps the step', () => {
    const goals: MatchPage['goals'] = [
      { side: 'a', scorer: mockPagePlayer('p-me'), assist: null },
      { side: 'a', scorer: null, assist: null },
    ];
    expect(stateOf(confirmed({ viewerId: BOOKER }, { goals }), PAGE_OPEN, 'goals')).toBe('act');
  });

  it('0–0: nothing to add', () => {
    const sides: MatchPage['sides'] = [
      { side: 'a', label: 'Bibs', teamId: null, score: 0 },
      { side: 'b', label: 'Non-bibs', teamId: null, score: 0 },
    ];
    expect(stateOf(confirmed({ viewerId: BOOKER }, { sides }), PAGE_OPEN, 'goals')).toBeNull();
  });

  it('a forfeit, a disputed or a no-result match has no goals', () => {
    const forfeit = mockResultMatch({ status: 'confirmed', forfeit: { side: 'b', reason: 'no_show' } });
    expect(
      stateOf(confirmed({ match: forfeit, viewerId: BOOKER }, { forfeit: { side: 'b', reason: 'no_show' } }), PAGE_OPEN, 'goals')
    ).toBeNull();
    for (const status of ['disputed', 'no_result'] as const) {
      const match = mockResultMatch({ status });
      expect(stateOf(confirmed({ match, viewerId: BOOKER }, { status }), PAGE_OPEN, 'goals')).toBeNull();
    }
  });
});

describe('postMatchSteps: man of the match', () => {
  it('a checked-in player votes', () => {
    expect(stateOf(confirmed(), PAGE_OPEN, 'motm')).toBe('act');
  });

  it('already done: they voted', () => {
    expect(stateOf(confirmed({}, { myVote: 'p-nikos' }), PAGE_OPEN, 'motm')).toBeNull();
  });

  it('closed: exactly when voting closes', () => {
    expect(stateOf(confirmed(), PAGE_CLOSED, 'motm')).toBeNull();
  });

  it("a player who didn't check in can't vote", () => {
    const roster = mockRoster().map((p) => (p.profileId === ME ? { ...p, checkedIn: false } : p));
    expect(stateOf(confirmed({ roster }), PAGE_OPEN, 'motm')).toBeNull();
    expect(stateOf(pending({ roster }), RESULT_AFTER_END, 'motm')).toBeNull();
  });

  it('not open yet: before the result is confirmed', () => {
    expect(stateOf(pending(), RESULT_AFTER_END, 'motm')).toBe('not_open');
  });

  it('a forfeit has no vote', () => {
    const match = mockResultMatch({ status: 'confirmed', forfeit: { side: 'b', reason: 'pulled_out' } });
    expect(stateOf(confirmed({ match }, { forfeit: { side: 'b', reason: 'pulled_out' } }), PAGE_OPEN, 'motm')).toBeNull();
  });
});

describe('postMatchSteps: ratings', () => {
  it('a checked-in player rates', () => {
    expect(stateOf(confirmed(), PAGE_OPEN, 'ratings')).toBe('act');
  });

  it('already done: every player they can rate is rated', () => {
    const r = ratings({
      myRatings: [
        { playerId: 'p-booker', score: 7 },
        { playerId: 'p-nikos', score: 6 },
        { playerId: 'p-noside', score: 5 },
      ],
    });
    expect(stateOf(confirmed({ ratings: r }), PAGE_OPEN, 'ratings')).toBeNull();
  });

  it('some still to rate keeps the step', () => {
    const r = ratings({ myRatings: [{ playerId: 'p-booker', score: 7 }] });
    expect(stateOf(confirmed({ ratings: r }), PAGE_OPEN, 'ratings')).toBe('act');
  });

  it('closed: the server says so, or exactly at the close', () => {
    expect(stateOf(confirmed({ ratings: ratings({ ratingsOpen: false }) }), PAGE_OPEN, 'ratings')).toBeNull();
    expect(stateOf(confirmed(), PAGE_CLOSED, 'ratings')).toBeNull();
  });

  it("a player who didn't check in can't rate", () => {
    const roster = mockRoster().map((p) => (p.profileId === ME ? { ...p, checkedIn: false } : p));
    expect(stateOf(confirmed({ roster }), PAGE_OPEN, 'ratings')).toBeNull();
  });

  it('not open yet: before the result is confirmed', () => {
    expect(stateOf(pending(), RESULT_AFTER_END, 'ratings')).toBe('not_open');
  });

  it('a forfeit or a disputed match has no ratings', () => {
    expect(stateOf(confirmed({ ratings: ratings({ ratingsCloseAt: null }) }), PAGE_OPEN, 'ratings')).toBeNull();
    const match = mockResultMatch({ status: 'disputed' });
    expect(stateOf(confirmed({ match, ratings: null }, { status: 'disputed' }), PAGE_OPEN, 'ratings')).toBeNull();
  });
});

describe('postMatchSteps: nothing left', () => {
  it('a voided game has no steps', () => {
    const match = mockResultMatch({ status: 'void' });
    expect(names(pending({ match, viewerId: BOOKER }), RESULT_AFTER_END)).toEqual([]);
  });

  it('every window closed: no steps', () => {
    expect(names(confirmed({ viewerId: BOOKER }), PAGE_CLOSED)).toEqual([]);
  });

  it('nobody signed in: no steps', () => {
    expect(names(pending({ viewerId: null }), RESULT_AFTER_END)).toEqual([]);
  });
});
