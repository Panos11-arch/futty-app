// P12: the switch control's words. Every amount is booking_detail's; the
// refusals are switch_refusal's codes in plain words.
import { switchInfo } from '@/lib/booking-detail.fixtures';
import {
  cyprusDayTimeLabel,
  switchButtonLabel,
  switchClosesLabel,
  switchErrorMessage,
  switchMoneyWords,
  switchPlayersPerSide,
  switchTarget,
} from '@/lib/booking-switch';
import { CHANGED_RULES, primeRules, SPEC_RULES } from '@/lib/rules.fixtures';
import { setCachedRules } from '@/lib/rules';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

afterEach(() => {
  setCachedRules(null);
  mockRpc.mockReset();
});

describe('switchTarget', () => {
  it('the side the server offers, for the booker who can switch', () => {
    expect(switchTarget(switchInfo({ to_players_per_side: 6 }), true)).toBe(6);
    expect(switchTarget(switchInfo(), true)).toBe(5);
  });

  it('nothing for anyone else, or when the server says no', () => {
    expect(switchTarget(switchInfo(), false)).toBeNull();
    expect(switchTarget(switchInfo({ can_switch: false, refusal: 'switch_closed' }), true)).toBeNull();
    expect(switchTarget(switchInfo({ switched: true, can_switch: false, to_players_per_side: null }), true)).toBeNull();
    expect(switchTarget(null, true)).toBeNull();
    expect(switchTarget(undefined, true)).toBeNull();
  });
});

describe('labels', () => {
  it('the button and when switching closes, in Cyprus time', () => {
    expect(switchButtonLabel(6)).toBe('Switch to 6 v 6');
    expect(switchButtonLabel(5)).toBe('Switch to 5 v 5');
    expect(cyprusDayTimeLabel('2026-11-16T10:00:00+00:00')).toBe('Mon 16 Nov at 12:00');
    expect(switchClosesLabel(switchInfo())).toBe('You can switch once, until Mon 16 Nov at 12:00.');
    expect(switchClosesLabel(switchInfo({ closes_at: undefined }))).toBe('You can switch once.');
  });
});

describe('switchMoneyWords: the server amounts, in words', () => {
  it('5 v 5 -> 6 v 6: credit', () => {
    const info = switchInfo({ to_players_per_side: 6, money: 'credit', each_cents: 100, booker_cents: 100 });
    expect(switchMoneyWords(info, 'Nuevo Campo', true)).toEqual([
      'The booking becomes 6 v 6.',
      "Each player who has paid gets €1.00 back as credit at Nuevo Campo. A payment that's still held gets it when it's taken.",
      "A player paying cash who hasn't paid yet pays €1.00 less at the venue instead.",
      'Every player is told.',
    ]);
  });

  it("the booker's own amount, when the leftover cents make it differ (€55: 92 each, 88 for the booker)", () => {
    const info = switchInfo({ to_players_per_side: 6, money: 'credit', each_cents: 92, booker_cents: 88 });
    expect(switchMoneyWords(info, 'Nuevo Campo', true)).toContain('You get €0.88.');
    expect(switchMoneyWords(info, 'Nuevo Campo', false)).not.toContain('You get €0.88.');
  });

  it('6 v 6 -> 5 v 5: more after the match, ticked cash included', () => {
    expect(switchMoneyWords(switchInfo(), 'Nuevo Campo', true)).toEqual([
      'The booking becomes 5 v 5.',
      'Each player who has paid, in the app or in cash at the venue, pays €1.00 more after the match, charged to their card with the top-ups.',
      "A player paying cash who hasn't paid yet pays €1.00 more at the venue instead.",
      'Every player is told.',
    ]);
    const odd = switchInfo({ each_cents: 92, booker_cents: 96 });
    expect(switchMoneyWords(odd, 'Nuevo Campo', true)).toContain('You pay €0.96 more.');
  });

  it('pay-all: no money changes', () => {
    expect(switchMoneyWords(switchInfo({ money: 'none', each_cents: undefined, booker_cents: undefined }), 'Nuevo Campo', true)).toEqual([
      'The booking becomes 5 v 5.',
      'You paid for everyone, so no money changes.',
      'Every player is told.',
    ]);
  });
});

describe('switchErrorMessage: every refusal in plain words', () => {
  it.each([
    ['not_booker', 'Only the booker can switch this booking.'],
    ['already_switched', 'This booking has already been switched. A booking can only be switched once.'],
    ['already_that_format', 'The booking is already that format.'],
    ['too_many_players', "More than 10 players have joined, so it can't go back to 5 v 5."],
    ['six_a_side_not_allowed', "This venue doesn't allow 6 v 6 on this pitch."],
    ['not_switchable', "This booking can't be switched."],
    ['invalid_players_per_side', "This booking can't be switched."],
    ['booking_cancelled', 'This booking has been cancelled.'],
    ['booking_not_confirmed', 'Finish paying for the booking first, then you can switch it.'],
    ['booking_not_found', 'This booking could not be found.'],
    ['not_authenticated', 'Sign in again to book.'],
    ['something_unexpected', "The booking couldn't be switched. Try again."],
  ])('%s', (code, words) => expect(switchErrorMessage(code)).toBe(words));

  it('switch_closed follows app_rules, and has no number before they load', () => {
    expect(switchErrorMessage('switch_closed')).toBe("Kickoff is too close, so this booking can't be switched now.");
    primeRules(SPEC_RULES);
    expect(switchErrorMessage('switch_closed')).toBe("Switching closes 6 hours before kickoff, so this booking can't be switched now.");
    primeRules(CHANGED_RULES);
    expect(switchErrorMessage('switch_closed')).toBe("Switching closes 4 hours before kickoff, so this booking can't be switched now.");
  });
});

describe('switchPlayersPerSide', () => {
  it('sends only the booking id and the side', async () => {
    mockRpc.mockResolvedValue({ data: { result: 'switched' }, error: null });
    await expect(switchPlayersPerSide('b1', 6)).resolves.toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('switch_players_per_side', { p_booking_id: 'b1', p_players_per_side: 6 });
  });

  it("the server's refusal, in words", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'too_many_players' } });
    await expect(switchPlayersPerSide('b1', 5)).resolves.toBe("More than 10 players have joined, so it can't go back to 5 v 5.");
  });
});
