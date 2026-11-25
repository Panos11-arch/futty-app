import { checkCountdown, scoreCheckLine, showScoreCheck } from '@/lib/match/score-check';

const UNTIL = '2026-11-26T20:00:00.000Z';
const at = (iso: string) => Date.parse(iso);

describe('showScoreCheck (levels like Playtomic, decision 1l item 11)', () => {
  it('shows only a pending card the viewer can answer, until its 24 hours end', () => {
    const check = { state: 'pending' as const, canAnswer: true, checkUntil: UNTIL };
    expect(showScoreCheck(check, at('2026-11-26T08:00:00.000Z'))).toBe(true);
    expect(showScoreCheck(check, at(UNTIL))).toBe(false);
  });

  it("hidden for the booker's side, the booker and anyone who didn't play (canAnswer false)", () => {
    expect(showScoreCheck({ state: 'pending', canAnswer: false, checkUntil: UNTIL }, 0)).toBe(false);
  });

  it('hidden once answered, or with no card', () => {
    expect(showScoreCheck({ state: 'accepted', canAnswer: false, checkUntil: UNTIL }, 0)).toBe(false);
    expect(showScoreCheck({ state: 'rejected', canAnswer: false, checkUntil: UNTIL }, 0)).toBe(false);
    expect(showScoreCheck(null, 0)).toBe(false);
    expect(showScoreCheck(undefined, 0)).toBe(false);
  });
});

describe('checkCountdown', () => {
  it('whole hours left, rounded up', () => {
    expect(checkCountdown(UNTIL, at('2026-11-25T20:00:00.000Z'))).toBe('24 hours left. No answer counts as accepted.');
    expect(checkCountdown(UNTIL, at('2026-11-26T18:30:00.000Z'))).toBe('2 hours left. No answer counts as accepted.');
    expect(checkCountdown(UNTIL, at('2026-11-26T19:00:00.000Z'))).toBe('1 hour left. No answer counts as accepted.');
  });

  it('under an hour', () => {
    expect(checkCountdown(UNTIL, at('2026-11-26T19:30:00.000Z'))).toBe(
      'Less than an hour left. No answer counts as accepted.'
    );
    expect(checkCountdown(UNTIL, at(UNTIL))).toBe('Less than an hour left. No answer counts as accepted.');
  });
});

describe('scoreCheckLine', () => {
  it('the sides and the score', () => {
    expect(scoreCheckLine({ labelA: 'Bibs', labelB: 'Non-bibs', sideAScore: 2, sideBScore: 1 })).toBe('Bibs 2–1 Non-bibs');
  });
});
