import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { LosersPayLeaveView, type LosersPayLeaveViewProps } from '@/components/booking/losers-pay-leave-view';
import type { LeaveQuote, PullOutQuote } from '@/lib/booking-losers-pay';
import { primeRules } from '@/lib/rules.fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => primeRules());

const leave: LeaveQuote = {
  booking_id: 'b1',
  held: true,
  window: 'middle',
  held_cents: 960,
  capture_cents: 480,
  credit_cents: 380,
  released_cents: 480,
  venue_name: 'Kamares',
};

const pullOut: PullOutQuote = {
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
};

function props(overrides: Partial<LosersPayLeaveViewProps> = {}): LosersPayLeaveViewProps {
  return {
    action: 'leave',
    state: { status: 'ready', data: leave },
    onRetry: jest.fn(),
    onConfirm: jest.fn(async () => ({ status: 'done' as const })),
    onKeep: jest.fn(),
    onDone: jest.fn(),
    ...overrides,
  };
}

describe('LosersPayLeaveView (spec 13 "Losers pay", pulling out)', () => {
  it('a player sees what leaving does to his hold, from the server, before anything happens', async () => {
    const p = props();
    await render(<LosersPayLeaveView {...p} />);
    expect(screen.getByText('Leave this game')).toBeTruthy();
    expect(screen.getByTestId('losers-pay-leave-line-0')).toHaveTextContent(
      '€4.80 is taken from your €9.60 hold: €1.00 is kept and €3.80 comes back as credit at Kamares.',
    );
    expect(screen.getByTestId('losers-pay-leave-line-1')).toHaveTextContent('The other €4.80 is released.');
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('confirming leaves, once, then says so', async () => {
    let finish: (v: { status: 'done' }) => void = () => {};
    const onConfirm = jest.fn(() => new Promise<{ status: 'done' }>((resolve) => (finish = resolve)));
    const p = props({ onConfirm });
    await render(<LosersPayLeaveView {...p} />);
    await fireEvent.press(screen.getByTestId('losers-pay-leave-confirm'));
    await fireEvent.press(screen.getByTestId('losers-pay-leave-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(leave);
    finish({ status: 'done' });
    expect(await screen.findByTestId('losers-pay-leave-done')).toHaveTextContent("You've left the game.");
    expect(screen.queryByTestId('losers-pay-leave-confirm')).toBeNull();
    await fireEvent.press(screen.getByTestId('losers-pay-leave-back'));
    expect(p.onDone).toHaveBeenCalled();
  });

  it('if the money changed since the quote, the new one is shown to check again', async () => {
    const late: LeaveQuote = { ...leave, window: 'late', credit_cents: 0 };
    const onConfirm = jest.fn().mockResolvedValueOnce({ status: 'changed', quote: late }).mockResolvedValue({ status: 'done' });
    await render(<LosersPayLeaveView {...props({ onConfirm })} />);
    await fireEvent.press(screen.getByTestId('losers-pay-leave-confirm'));
    expect(await screen.findByTestId('losers-pay-leave-changed')).toBeTruthy();
    expect(screen.getByTestId('losers-pay-leave-line-0')).toHaveTextContent(
      "€4.80 is taken from your €9.60 hold and nothing comes back, as it's less than 6 hours before kickoff.",
    );
    expect(screen.queryByTestId('losers-pay-leave-done')).toBeNull();
    await fireEvent.press(screen.getByTestId('losers-pay-leave-confirm'));
    expect(onConfirm).toHaveBeenLastCalledWith(late);
    expect(await screen.findByTestId('losers-pay-leave-done')).toBeTruthy();
  });

  it('a refusal shows, and he can try again', async () => {
    const onConfirm = jest.fn().mockResolvedValue({ status: 'error', message: "You've already left this game." });
    await render(<LosersPayLeaveView {...props({ onConfirm })} />);
    await fireEvent.press(screen.getByTestId('losers-pay-leave-confirm'));
    expect(await screen.findByTestId('losers-pay-leave-error')).toHaveTextContent("You've already left this game.");
    expect(screen.getByTestId('losers-pay-leave-confirm')).toBeTruthy();
  });

  it('"Keep my spot" goes back without leaving', async () => {
    const p = props();
    await render(<LosersPayLeaveView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my spot' }));
    expect(p.onKeep).toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('a captain pulling his side out: €5.00 from his €45.50 hold (example 13)', async () => {
    const p = props({ action: 'pull_out', state: { status: 'ready', data: pullOut } });
    await render(<LosersPayLeaveView {...p} />);
    expect(screen.getByText('Pull your team out')).toBeTruthy();
    expect(screen.getByTestId('losers-pay-leave-line-0')).toHaveTextContent('€5.00 (€1.00 × 5 players) is taken from your hold.');
    expect(screen.getByRole('button', { name: 'Confirm: pull out' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep my team in' })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('losers-pay-leave-confirm'));
    expect(await screen.findByTestId('losers-pay-leave-done')).toHaveTextContent('Your team is out of the game.');
  });

  it('loading, then a failed quote with Try again', async () => {
    const { rerender } = await render(<LosersPayLeaveView {...props({ state: { status: 'loading' } })} />);
    expect(screen.getByTestId('losers-pay-leave-loading')).toBeTruthy();
    const onRetry = jest.fn();
    await rerender(<LosersPayLeaveView {...props({ state: { status: 'error', message: 'As captain, you pull your whole team out instead.' }, onRetry })} />);
    expect(screen.getByText('As captain, you pull your whole team out instead.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalled());
  });
});
