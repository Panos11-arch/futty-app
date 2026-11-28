// S10B: paying a tournament's entry fee (spec 13 "Tournament entry (S10B)").
// The app never sends an amount: it names the tournament, and
// create-tournament-payment charges the fee the server reads. The words and
// the deadline (Cyprus time) are the app's.
const mockInvoke = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    rpc: (...a: unknown[]) => mockRpc(...a),
  },
}));

import {
  entryErrorMessage,
  payDeadlineLine,
  payLabel,
  roleLabel,
  startEntryPayment,
  withdrawTeam,
} from '@/lib/tournament-entry';

beforeEach(() => {
  mockInvoke.mockReset();
  mockRpc.mockReset();
});

describe('startEntryPayment', () => {
  it('names the tournament only, and returns what the payment sheet needs', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret', customerId: 'cus_1', amountCents: 1200 }, error: null });
    await expect(startEntryPayment('t1')).resolves.toEqual({
      ok: true,
      clientSecret: 'pi_secret',
      customerId: 'cus_1',
      amountCents: 1200,
    });
    expect(mockInvoke).toHaveBeenCalledWith('create-tournament-payment', { body: { tournamentId: 't1' } });
  });

  it('a refusal comes back as words', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { context: { json: () => Promise.resolve({ error: 'deadline_passed' }) } },
    });
    await expect(startEntryPayment('t1')).resolves.toEqual({ ok: false, message: 'The deadline has passed.' });
  });

  it('no answer: try again', async () => {
    mockInvoke.mockRejectedValue(new Error('offline'));
    await expect(startEntryPayment('t1')).resolves.toEqual({ ok: false, message: 'Couldn’t start the payment. Try again.' });
  });
});

describe('entryErrorMessage: what happened, then what to do', () => {
  it.each([
    ['deadline_passed', 'The deadline has passed.'],
    ['already_paid', 'You’ve already paid.'],
    ['not_in_squad', 'You’re not in this squad.'],
    ['player_in_debt', 'You owe money. Pay it from Payments, then try again.'],
    ['no_fee', 'There’s nothing to pay.'],
    ['tournament_not_found', 'This tournament isn’t available.'],
    ['something_else', 'Couldn’t start the payment. Try again.'],
  ])('%s', (code, words) => {
    expect(entryErrorMessage(code)).toBe(words);
  });

  it('every message is one line of at most 10 words', () => {
    for (const code of ['deadline_passed', 'already_paid', 'not_in_squad', 'player_in_debt', 'no_fee', 'tournament_not_found', 'x']) {
      expect(entryErrorMessage(code).split(/\s+/).length).toBeLessThanOrEqual(10);
    }
  });
});

describe('labels', () => {
  it('Pay €12.00, from the server\'s amount', () => {
    expect(payLabel(1200)).toBe('Pay €12.00');
    expect(payLabel(650)).toBe('Pay €6.50');
  });

  it('Starter / Sub', () => {
    expect(roleLabel('starter')).toBe('Starter');
    expect(roleLabel('sub')).toBe('Sub');
  });

  it('the deadline in Cyprus time, whatever the phone\'s zone', () => {
    // 5 Dec 2026, 16:00 UTC = 18:00 in Cyprus (winter, UTC+2).
    expect(payDeadlineLine('2026-12-05T16:00:00Z')).toBe('By Sat 5 Dec, 18:00');
    // 10 Jul 2027, 15:30 UTC = 18:30 in Cyprus (summer, UTC+3).
    expect(payDeadlineLine('2027-07-10T15:30:00Z')).toBe('By Sat 10 Jul, 18:30');
  });
});

describe('withdrawTeam', () => {
  it('asks the server; the refunds are its business', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await expect(withdrawTeam('t1', 'team1')).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('withdraw_tournament_team', { p_tournament_id: 't1', p_team_id: 'team1' });
  });

  it('after the deadline: refused, in words', async () => {
    mockRpc.mockResolvedValue({ error: { message: 'deadline_passed' } });
    await expect(withdrawTeam('t1', 'team1')).resolves.toEqual({ ok: false, message: 'The deadline has passed.' });
  });
});
