import { formResult, formSide, playerForm, teamForm } from '@/lib/match/form';
import {
  mockDisputed,
  mockDraw,
  mockForfeitNoShow,
  mockForfeitPulledOut,
  mockFormEntries,
  mockNoResult,
  mockSideAWon,
  mockSideBWon,
  PROFILE,
  TEAM_AWAY,
  TEAM_HOME,
} from '@/lib/match/mock';
import type { MatchFormEntry, MatchResultConfirmed } from '@/lib/match/types';

const result = (r: MatchResultConfirmed | null) => {
  if (!r) throw new Error('fixture has no result');
  return r;
};
const entryFor = (matchId: string): MatchFormEntry => {
  const found = mockFormEntries.find((e) => e.result.match_id === matchId);
  if (!found) throw new Error(`no entry ${matchId}`);
  return found;
};

describe('formResult', () => {
  it.each([
    ['side a won', mockSideAWon.result, 'W', 'L'],
    ['side b won', mockSideBWon.result, 'L', 'W'],
    ['a draw', mockDraw.result, 'D', 'D'],
    ['side b forfeited', mockForfeitPulledOut.result, 'W', 'L_forfeit'],
    ['side a forfeited', mockForfeitNoShow.result, 'L_forfeit', 'W'],
  ] as const)('%s: side a %s, side b %s', (_, r, a, b) => {
    expect(formResult(result(r), 'a')).toBe(a);
    expect(formResult(result(r), 'b')).toBe(b);
  });

  it.each([
    ['disputed', mockDisputed.result],
    ['no_result', mockNoResult.result],
  ])('%s is never a form result', (_, r) => {
    expect(formResult(result(r), 'a')).toBeNull();
    expect(formResult(result(r), 'b')).toBeNull();
  });
});

describe('formSide (decisions 1b.2 and 1b.3)', () => {
  it('a checked-in player counts on their side', () => {
    expect(formSide(entryFor('m-a-won'), PROFILE.anghelo)).toBe('a');
    expect(formSide(entryFor('m-a-won'), PROFILE.awayCaptain)).toBe('b');
  });

  it('a spot holder who did not check in does not count in a normal match', () => {
    expect(formSide(entryFor('m-a-won'), PROFILE.sami)).toBeNull();
  });

  it('a squad member without a spot or a check-in does not count', () => {
    expect(formSide(entryFor('m-a-won'), PROFILE.awaySub)).toBeNull();
  });

  it('a player who left does not count, even with a check-in row', () => {
    expect(formSide(entryFor('m-a-won'), PROFILE.leftEarly)).toBeNull();
  });

  it('in a forfeit, spot holders on either side count without a check-in', () => {
    expect(formSide(entryFor('m-forfeit-b'), PROFILE.anghelo)).toBe('a');
    expect(formSide(entryFor('m-forfeit-b'), PROFILE.awaySpot)).toBe('b');
  });

  it('in a forfeit, a squad member without a spot or check-in still does not count', () => {
    expect(formSide(entryFor('m-forfeit-b'), PROFILE.awaySub)).toBeNull();
  });

  it('someone not in the match does not count', () => {
    expect(formSide(entryFor('m-draw'), 'profile-stranger')).toBeNull();
  });
});

describe('playerForm', () => {
  it('is the last 5 confirmed matches, newest first', () => {
    // 7 Nov W, 5 Nov L, 3 Nov D, 31 Oct W (forfeit win, no check-in), 17 Oct W; 10 Oct is the sixth.
    expect(playerForm(mockFormEntries, PROFILE.anghelo)).toEqual(['W', 'L', 'D', 'W', 'W']);
  });

  it('leaves out disputed and no_result matches the player checked in to', () => {
    const onlyUnsettled = [entryFor('m-disputed'), entryFor('m-no-result')];
    expect(playerForm(onlyUnsettled, PROFILE.anghelo)).toEqual([]);
  });

  it('Sami gets nothing for the normal match he missed, only his forfeit loss', () => {
    expect(playerForm(mockFormEntries, PROFILE.sami)).toEqual(['L_forfeit']);
  });

  it('a forfeiting spot holder with no check-in gets "L (forfeit)"', () => {
    expect(playerForm([entryFor('m-forfeit-b')], PROFILE.awaySpot)).toEqual(['L_forfeit']);
  });

  it('a winning spot holder in a forfeit with no check-in gets "W"', () => {
    expect(playerForm([entryFor('m-forfeit-b')], PROFILE.anghelo)).toEqual(['W']);
  });

  it('a checked-in teammate of Sami gets the result Sami does not', () => {
    expect(playerForm([entryFor('m-a-won')], PROFILE.anghelo)).toEqual(['W']);
    expect(playerForm([entryFor('m-a-won')], PROFILE.sami)).toEqual([]);
  });
});

describe('teamForm', () => {
  it('counts every confirmed match the team played, newest first, last 5', () => {
    // 7 Nov W, 5 Nov L, 31 Oct W (they pulled out), 24 Oct L (forfeit), 17 Oct W; 10 Oct is the sixth.
    expect(teamForm(mockFormEntries, TEAM_HOME)).toEqual(['W', 'L', 'W', 'L_forfeit', 'W']);
    expect(teamForm(mockFormEntries, TEAM_AWAY)).toEqual(['L', 'W', 'L_forfeit', 'W', 'L']);
  });

  it('ignores attendance', () => {
    const nobodyCheckedIn = mockFormEntries.map((e) => ({ ...e, attendance: [], players: [] }));
    expect(teamForm(nobodyCheckedIn, TEAM_HOME)).toEqual(teamForm(mockFormEntries, TEAM_HOME));
  });

  it('pickup games and other teams are not in a team form', () => {
    expect(teamForm([entryFor('m-draw')], TEAM_HOME)).toEqual([]);
    expect(teamForm(mockFormEntries, 'team-other')).toEqual([]);
  });

  it('a disputed match is not in team form', () => {
    expect(teamForm([entryFor('m-disputed')], TEAM_HOME)).toEqual([]);
  });
});
