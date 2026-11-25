import {
  canBalanceTeams,
  competitiveView,
  formatLevel,
  shouldOfferStartingLevel,
  STARTING_LEVEL_MAX,
  STARTING_QUESTIONS,
  startingLevelOffered,
  type PlayerLevel,
} from '@/lib/match/levels';
import { mockResultMatch, mockRoster, RESULT_AFTER_END, RESULT_BEFORE_KICKOFF, RESULT_PEOPLE } from '@/lib/match/mock';

const level = (over: Partial<PlayerLevel> = {}): PlayerLevel => ({
  level: 3,
  provisional: true,
  reliabilityPct: 0,
  competitiveMatches: 0,
  source: 'questionnaire',
  ...over,
});

describe('formatLevel', () => {
  it.each([
    [3, '3.0'],
    [3.05, '3.1'],
    [4.24, '4.2'],
    [4.25, '4.3'],
    [1, '1.0'],
    [7, '7.0'],
    [2.95, '3.0'],
  ])('%s shows as %s', (n, shown) => {
    expect(formatLevel(n)).toBe(shown);
  });

  it('takes the string Postgres numerics can arrive as', () => {
    expect(formatLevel('3.45')).toBe('3.5');
  });
});

describe('startingLevelOffered', () => {
  it('no level yet: offered', () => expect(startingLevelOffered(null)).toBe(true));
  it('a default level before any competitive match: offered', () =>
    expect(startingLevelOffered(level({ source: 'default' }))).toBe(true));
  it('a default level after a competitive match: not offered (level_already_set)', () =>
    expect(startingLevelOffered(level({ source: 'default', competitiveMatches: 1 }))).toBe(false));
  it('already answered: not offered', () => expect(startingLevelOffered(level())).toBe(false));
});

describe('shouldOfferStartingLevel', () => {
  const ready = {
    focused: true,
    profileSetup: false as const,
    recovering: false,
    alreadyOffered: false,
    level: { status: 'ready' as const, level: null },
  };

  it('Home focused, profile complete, never offered, no level: offer', () => {
    expect(shouldOfferStartingLevel(ready)).toBe(true);
  });

  it('profile setup pending (no username yet or still checking): no offer', () => {
    expect(shouldOfferStartingLevel({ ...ready, profileSetup: true })).toBe(false);
    expect(shouldOfferStartingLevel({ ...ready, profileSetup: 'loading' })).toBe(false);
  });

  it('Home not focused: no offer', () => {
    expect(shouldOfferStartingLevel({ ...ready, focused: false })).toBe(false);
  });

  it('during a password recovery: no offer', () => {
    expect(shouldOfferStartingLevel({ ...ready, recovering: true })).toBe(false);
  });

  it('already offered on this device, or not known yet: no offer', () => {
    expect(shouldOfferStartingLevel({ ...ready, alreadyOffered: true })).toBe(false);
    expect(shouldOfferStartingLevel({ ...ready, alreadyOffered: 'loading' })).toBe(false);
  });

  it('level still loading, failed, or already answered: no offer', () => {
    expect(shouldOfferStartingLevel({ ...ready, level: { status: 'loading' } })).toBe(false);
    expect(shouldOfferStartingLevel({ ...ready, level: { status: 'error', message: 'x' } })).toBe(false);
    expect(shouldOfferStartingLevel({ ...ready, level: { status: 'ready', level: level() } })).toBe(false);
  });
});

describe('STARTING_QUESTIONS', () => {
  it('five steps whose answers are the server values', () => {
    expect(STARTING_QUESTIONS.map((q) => q.key)).toEqual(['years', 'highest', 'frequency', 'position', 'selfRating']);
    expect(STARTING_QUESTIONS[0].options.map((o) => o.value)).toEqual(['under_1', '1_3', '3_10', 'over_10']);
    expect(STARTING_QUESTIONS[1].options.map((o) => o.value)).toEqual(['kickabout', 'amateur', 'semi_pro', 'professional']);
    expect(STARTING_QUESTIONS[2].options.map((o) => o.value)).toEqual(['rarely', 'monthly', 'weekly', 'several_weekly']);
    expect(STARTING_QUESTIONS[3].options.map((o) => o.value)).toEqual(['gk', 'def', 'mid', 'fwd']);
    expect(STARTING_QUESTIONS[4].options.map((o) => o.value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  // Decided by Panos 25 November: a starting level is at most 8 (app_rules
  // starting_level_max); only matches take a player higher.
  it('the self-rating goes from 1 to 8, never above', () => {
    expect(STARTING_LEVEL_MAX).toBe(8);
    expect(STARTING_QUESTIONS[4].question).toBe('How would you rate yourself, from 1 to 8?');
    expect(STARTING_QUESTIONS[4].options.some((o) => Number(o.value) > 8)).toBe(false);
  });
});

describe('competitiveView', () => {
  it('every game is Competitive by default, pickups included', () => {
    expect(competitiveView(mockResultMatch({ kind: 'pickup', status: 'scheduled' }), null, 0).isCompetitive).toBe(true);
    expect(competitiveView(mockResultMatch({ kind: 'named', status: 'scheduled' }), null, 0).isCompetitive).toBe(true);
  });

  it('follows the server flag (Friendly)', () => {
    expect(competitiveView(mockResultMatch({ status: 'scheduled', competitive: false }), null, 0).isCompetitive).toBe(false);
  });

  it('a captain can switch it while scheduled and before kickoff', () => {
    const m = mockResultMatch({ status: 'scheduled' });
    expect(competitiveView(m, 'a', RESULT_BEFORE_KICKOFF).editable).toBe(true);
  });

  it('read-only for anyone else, after kickoff, or once the match has moved on', () => {
    expect(competitiveView(mockResultMatch({ status: 'scheduled' }), null, RESULT_BEFORE_KICKOFF).editable).toBe(false);
    expect(competitiveView(mockResultMatch({ status: 'scheduled' }), 'a', RESULT_AFTER_END).editable).toBe(false);
    expect(competitiveView(mockResultMatch({ status: 'played' }), 'a', RESULT_BEFORE_KICKOFF).editable).toBe(false);
  });
});

describe('canBalanceTeams', () => {
  it('the booker of a pickup, before sides lock', () => {
    expect(canBalanceTeams(mockResultMatch({ status: 'scheduled' }), RESULT_PEOPLE.booker)).toBe(true);
    expect(canBalanceTeams(mockResultMatch({ status: 'played' }), RESULT_PEOPLE.booker)).toBe(true);
  });

  it('nobody else', () => {
    expect(canBalanceTeams(mockResultMatch({ status: 'scheduled' }), RESULT_PEOPLE.me)).toBe(false);
    expect(canBalanceTeams(mockResultMatch({ status: 'scheduled' }), null)).toBe(false);
  });

  it('never in a named game', () => {
    expect(canBalanceTeams(mockResultMatch({ kind: 'named', status: 'scheduled' }), RESULT_PEOPLE.booker)).toBe(false);
  });

  it('not once a score is entered or the match is settled', () => {
    expect(canBalanceTeams(mockResultMatch({ status: 'played', submission: {} }), RESULT_PEOPLE.booker)).toBe(false);
    expect(canBalanceTeams(mockResultMatch({ status: 'confirmed' }), RESULT_PEOPLE.booker)).toBe(false);
  });
});
