import {
  RESULT_AFTER_END as AFTER_END,
  RESULT_BEFORE_KICKOFF as BEFORE_KICKOFF,
  RESULT_DEADLINE as DEADLINE,
  RESULT_PEOPLE,
  mockResultMatch as makeMatch,
} from '@/lib/match/mock';
import { captainSideOf, resultState, toListItem, viewerRole } from '@/lib/match/result';

const { me: ME, booker: BOOKER, awayCaptain: AWAY_CAPTAIN } = RESULT_PEOPLE;

const none = new Set<string>();

describe('captainSideOf', () => {
  it('the booker captains side a', () => {
    expect(captainSideOf(makeMatch(), BOOKER, none)).toBe('a');
  });

  it('a captain of a named side team, through their captain team ids', () => {
    expect(captainSideOf(makeMatch({ kind: 'named', sideBCaptain: null }), ME, new Set(['team-away']))).toBe('b');
  });

  it('nobody else', () => {
    expect(captainSideOf(makeMatch({ kind: 'named' }), ME, new Set(['some-other-team']))).toBeNull();
    expect(captainSideOf(makeMatch(), null, none)).toBeNull();
  });
});

describe('viewerRole', () => {
  it('a captain with no submission can submit', () => {
    expect(viewerRole(makeMatch(), BOOKER, none)).toMatchObject({ captainSide: 'a', canSubmit: true, canRespond: false });
  });

  it('a non-captain can never submit', () => {
    expect(viewerRole(makeMatch({ mySide: 'a' }), ME, none).canSubmit).toBe(false);
    expect(viewerRole(makeMatch({ mySide: 'b' }), ME, none).canSubmit).toBe(false);
  });

  it('nobody can submit once a result is in', () => {
    expect(viewerRole(makeMatch({ submission: {} }), BOOKER, none).canSubmit).toBe(false);
  });

  it('pickup: any player on the other side can answer', () => {
    expect(viewerRole(makeMatch({ submission: {}, mySide: 'b' }), ME, none).canRespond).toBe(true);
  });

  it('pickup: the submitting side and players with no side cannot', () => {
    expect(viewerRole(makeMatch({ submission: {}, mySide: 'a' }), ME, none).canRespond).toBe(false);
    expect(viewerRole(makeMatch({ submission: {}, mySide: null }), ME, none).canRespond).toBe(false);
    expect(viewerRole(makeMatch({ submission: {} }), BOOKER, none).canRespond).toBe(false);
  });

  it('named: only the other side captain can answer', () => {
    const match = makeMatch({ kind: 'named', submission: {}, mySide: 'b' });
    expect(viewerRole(match, ME, none).canRespond).toBe(false);
    expect(viewerRole(match, AWAY_CAPTAIN, none).canRespond).toBe(true);
    expect(viewerRole(match, ME, new Set(['team-away'])).canRespond).toBe(true);
  });

  it('nobody can answer twice', () => {
    expect(viewerRole(makeMatch({ submission: { response: 'accepted' }, mySide: 'b' }), ME, none).canRespond).toBe(false);
  });

  it('nothing is open once the match is settled', () => {
    const settled = makeMatch({ status: 'disputed', submission: {}, mySide: 'b' });
    expect(viewerRole(settled, ME, none).canRespond).toBe(false);
    expect(viewerRole(makeMatch({ status: 'void' }), BOOKER, none).canSubmit).toBe(false);
  });
});

describe('resultState', () => {
  it('scheduled, before kickoff: not started', () => {
    expect(resultState(makeMatch({ status: 'scheduled' }), BOOKER, none, BEFORE_KICKOFF).kind).toBe('not_started');
  });

  it('scheduled, after kickoff: a captain can enter the score already', () => {
    const during = Date.parse('2026-11-14T17:30:00.000Z');
    expect(resultState(makeMatch({ status: 'scheduled' }), BOOKER, none, during).kind).toBe('enter_score');
  });

  it('played: the captain enters, everyone else waits', () => {
    expect(resultState(makeMatch(), BOOKER, none, AFTER_END).kind).toBe('enter_score');
    expect(resultState(makeMatch({ mySide: 'b' }), ME, none, AFTER_END).kind).toBe('waiting_for_score');
  });

  it('a submission: the other side answers, the submitting side waits', () => {
    expect(resultState(makeMatch({ submission: {}, mySide: 'b' }), ME, none, AFTER_END).kind).toBe('answer_score');
    expect(resultState(makeMatch({ submission: {} }), BOOKER, none, AFTER_END)).toMatchObject({
      kind: 'waiting_for_answer',
      answeringSide: 'b',
    });
  });

  it('a pickup player with no side sees the score but cannot answer', () => {
    expect(resultState(makeMatch({ submission: {}, mySide: null }), ME, none, AFTER_END).kind).toBe('no_side');
  });

  it('exactly at the deadline the window is closed', () => {
    const at = Date.parse(DEADLINE);
    expect(resultState(makeMatch(), BOOKER, none, at - 1).kind).toBe('enter_score');
    expect(resultState(makeMatch(), BOOKER, none, at).kind).toBe('window_closed');
    expect(resultState(makeMatch({ submission: {}, mySide: 'b' }), ME, none, at).kind).toBe('window_closed');
  });

  it.each([
    ['confirmed', 'confirmed'],
    ['disputed', 'disputed'],
    ['no_result', 'no_result'],
    ['void', 'cancelled'],
  ] as const)('%s is settled as %s', (status, kind) => {
    expect(resultState(makeMatch({ status }), BOOKER, none, AFTER_END).kind).toBe(kind);
  });
});

describe('toListItem', () => {
  it('a confirmed score: the winner from the scores', () => {
    const item = toListItem(makeMatch({ status: 'confirmed', scores: [5, 3] }), null);
    expect(item.result).toMatchObject({ result_status: 'confirmed', outcome: 'side_a_won', side_a_score: 5 });
  });

  it('a draw and a side b win', () => {
    expect(toListItem(makeMatch({ status: 'confirmed', scores: [2, 2] }), null).result?.outcome).toBe('draw');
    expect(toListItem(makeMatch({ status: 'confirmed', scores: [0, 1] }), null).result?.outcome).toBe('side_b_won');
  });

  it('a forfeit gives the other side the win', () => {
    const item = toListItem(
      makeMatch({ status: 'confirmed', forfeit: { side: 'b', reason: 'no_show' } }),
      null
    );
    expect(item.result).toMatchObject({ outcome: 'side_a_won', forfeit_side: 'b', forfeit_reason: 'no_show' });
  });

  it('disputed and no result have no outcome; open matches have no result row', () => {
    expect(toListItem(makeMatch({ status: 'disputed' }), null).result).toMatchObject({ outcome: null, disputed: true });
    expect(toListItem(makeMatch({ status: 'no_result' }), null).result?.outcome).toBeNull();
    expect(toListItem(makeMatch({ status: 'played' }), null).result).toBeNull();
    expect(toListItem(makeMatch({ status: 'void' }), null).result).toBeNull();
  });

  it('kickoff in Cyprus wall-clock time', () => {
    expect(toListItem(makeMatch({ status: 'confirmed', scores: [1, 0] }), null).result?.kickoff_local).toBe(
      '2026-11-14T19:00:00'
    );
  });
});
