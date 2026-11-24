import {
  actionTitle,
  confirmLabel,
  confirmLosersPay,
  doneMessage,
  fetchLeaveQuote,
  fetchPullOutQuote,
  fetchQuote,
  keepLabel,
  leaveLines,
  pullOutLines,
  quoteLines,
  sameMoney,
  type LeaveQuote,
  type PullOutQuote,
} from './booking-losers-pay';
import { primeRules } from './rules.fixtures';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

beforeEach(() => {
  mockRpc.mockReset();
  primeRules();
});

// The server's quotes on spec 13's €40.00 5-a-side pitch.
const leave = (overrides: Partial<LeaveQuote> = {}): LeaveQuote => ({
  booking_id: 'b1',
  held: true,
  window: 'middle',
  held_cents: 960,
  capture_cents: 480,
  credit_cents: 380,
  released_cents: 480,
  venue_name: 'Kamares',
  ...overrides,
});

const pullOut = (overrides: Partial<PullOutQuote> = {}): PullOutQuote => ({
  booking_id: 'b1',
  kind: 'fee',
  side: 'b',
  payment_mode: 'pay_all',
  players: 5,
  fee_per_player_cents: 100,
  held_cents: 4550,
  capture_cents: 500,
  released_cents: 4050,
  cancels_booking: false,
  cutoff_at: '2026-11-26T12:00:00Z',
  ...overrides,
});

describe('a player leaving a Losers pay game (spec 13, rule 1 of 23 November)', () => {
  it('after his free hour: €4.80 taken, €1 kept, €3.80 credit, the rest released (example 16)', () => {
    expect(leaveLines(leave())).toEqual([
      '€4.80 is taken from your €9.60 hold: €1.00 is kept and €3.80 comes back as credit at Kamares.',
      'The other €4.80 is released.',
    ]);
  });

  it('in his free hour: the whole hold back', () => {
    expect(leaveLines(leave({ window: 'free', capture_cents: 0, credit_cents: 0, released_cents: 960 }))).toEqual([
      'Your €9.60 hold is released in full.',
    ]);
  });

  it('less than 6 hours before kickoff: nothing back for his share', () => {
    expect(leaveLines(leave({ window: 'late', credit_cents: 0 }))).toEqual([
      "€4.80 is taken from your €9.60 hold and nothing comes back, as it's less than 6 hours before kickoff.",
      'The other €4.80 is released.',
    ]);
  });

  it('nothing held (his side paid for everyone): nothing taken', () => {
    expect(leaveLines(leave({ held: false, window: null, held_cents: 0, capture_cents: 0, credit_cents: 0, released_cents: 0 }))).toEqual([
      'Nothing is held on your card for this game, so nothing is taken. Your spot opens for someone else.',
    ]);
  });
});

describe('a captain pulling his side out (spec 13, rules of 23 and 24 November)', () => {
  it('paying for everyone, more than 6 hours before kickoff: €5.00 from the €45.50 hold (example 13)', () => {
    expect(pullOutLines(pullOut())).toEqual([
      '€5.00 (€1.00 × 5 players) is taken from your hold.',
      'The rest (€40.50) is released.',
      'The other team keeps the slot and looks for a new opponent.',
    ]);
  });

  it('paying for myself: €1 from each hold that is placed', () => {
    expect(
      pullOutLines(pullOut({ payment_mode: 'each_pays_responsible', held_cents: 2880, capture_cents: 300, released_cents: 2580 })),
    ).toEqual(["€1.00 is taken from each player's hold that's placed: €3.00 in all.", 'The rest (€25.80) is released.', 'The other team keeps the slot and looks for a new opponent.']);
  });

  it('less than 6 hours before kickoff: as the losing side (example 14a)', () => {
    expect(pullOutLines(pullOut({ kind: 'lost', payment_mode: 'each_pays_responsible', held_cents: 4800, capture_cents: 4800, released_cents: 0 }))).toEqual([
      "It's less than 6 hours before kickoff, so your team pays as the losing side: €48.00 is taken from your team's holds.",
      "The other team's holds are released and their game goes ahead.",
    ]);
  });

  it('on its own: €1 per player and the game is cancelled (example 15a)', () => {
    const q = pullOut({ kind: 'alone', side: 'a', cancels_booking: true });
    expect(pullOutLines(q)).toEqual([
      '€5.00 (€1.00 × 5 players) is taken from your hold.',
      'The rest (€40.50) is released.',
      'The game is cancelled.',
    ]);
    expect(doneMessage('pull_out', q)).toBe('Your game is cancelled.');
  });

  it('once the 24-hour choice is open: cancel free', () => {
    const q = pullOut({ kind: 'cancel_free', capture_cents: 0, released_cents: 4550, cancels_booking: true });
    expect(pullOutLines(q)).toEqual(["You have no opponent, so the game is cancelled free: everyone's money is given back."]);
    expect(confirmLabel('pull_out', q)).toBe('Confirm: cancel free');
  });
});

describe('words around it', () => {
  it('titles, buttons and what it says after', () => {
    expect(actionTitle('leave')).toBe('Leave this game');
    expect(actionTitle('pull_out')).toBe('Pull your team out');
    expect(confirmLabel('leave', leave())).toBe('Confirm: leave');
    expect(confirmLabel('pull_out', pullOut())).toBe('Confirm: pull out');
    expect(confirmLabel('pull_out', null)).toBe('Confirm: pull out');
    expect(keepLabel('leave')).toBe('Keep my spot');
    expect(keepLabel('pull_out')).toBe('Keep my team in');
    expect(doneMessage('leave', leave())).toBe("You've left the game.");
    expect(doneMessage('pull_out', pullOut())).toBe('Your team is out of the game.');
    expect(doneMessage('pull_out', null)).toBe('Your team is out of the game.');
    expect(quoteLines(leave())).toEqual(leaveLines(leave()));
    expect(quoteLines(pullOut())).toEqual(pullOutLines(pullOut()));
  });

  it('notices when the money changed between the quote and the tap', () => {
    expect(sameMoney(leave(), leave())).toBe(true);
    expect(sameMoney(leave({ window: 'free', capture_cents: 0, released_cents: 960 }), leave())).toBe(false);
    expect(sameMoney(pullOut(), pullOut({ kind: 'lost' }))).toBe(false);
    expect(sameMoney(pullOut(), pullOut({ capture_cents: 400 }))).toBe(false);
  });
});

describe('server calls (only the booking id is sent)', () => {
  it('quotes', async () => {
    mockRpc.mockResolvedValue({ data: leave(), error: null });
    expect(await fetchLeaveQuote('b1')).toEqual(leave());
    expect(mockRpc).toHaveBeenCalledWith('losers_pay_leave_quote', { p_booking_id: 'b1' });
    mockRpc.mockResolvedValue({ data: pullOut(), error: null });
    expect(await fetchPullOutQuote('b1')).toEqual(pullOut());
    expect(mockRpc).toHaveBeenCalledWith('losers_pay_pull_out_quote', { p_booking_id: 'b1' });
    expect(await fetchQuote('pull_out', 'b1')).toEqual(pullOut());
    mockRpc.mockResolvedValue({ data: leave(), error: null });
    expect(await fetchQuote('leave', 'b1')).toEqual(leave());
  });

  it('a refused quote is in words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'captain_pulls_out_side' } });
    await expect(fetchLeaveQuote('b1')).rejects.toThrow('As captain, you pull your whole team out instead.');
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchPullOutQuote('b1')).rejects.toThrow();
  });

  it('leaving and pulling out', async () => {
    mockRpc.mockResolvedValue({ data: { result: 'left' }, error: null });
    expect(await confirmLosersPay('leave', 'b1')).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('losers_pay_leave', { p_booking_id: 'b1' });
    expect(await confirmLosersPay('pull_out', 'b1')).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('losers_pay_pull_out', { p_booking_id: 'b1' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'already_settled' } });
    expect(await confirmLosersPay('leave', 'b1')).toBe("You've already left this game.");
  });
});
