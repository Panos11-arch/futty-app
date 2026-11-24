import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { NoOpponentPanel } from '@/components/booking/no-opponent-panel';
import { primeRules } from '@/lib/rules.fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => primeRules());

const info = { amount_cents: 2275, choose_by: '2026-11-26T12:00:00Z' };

describe('NoOpponentPanel (spec 13 "No side B by 24 hours before kickoff")', () => {
  it('says what to choose and by when, with the server’s amount on the button (example 6a)', async () => {
    await render(<NoOpponentPanel testID="nop" info={info} onPayWhole={jest.fn()} onCancelFree={jest.fn()} />);
    expect(screen.getByText('No opponent yet')).toBeTruthy();
    expect(screen.getByText("Nobody has taken on your game. Choose by Thu 26 Nov, 14:00, or it's cancelled free.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay €22.75 and play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel free' })).toBeTruthy();
  });

  it('shows the game on Home', async () => {
    await render(
      <NoOpponentPanel testID="nop" info={info} game="Kamares · Pitch 2 · Thu 26 Nov · 20:00" onPayWhole={jest.fn()} onCancelFree={jest.fn()} />,
    );
    expect(screen.getByText('Kamares · Pitch 2 · Thu 26 Nov · 20:00')).toBeTruthy();
  });

  it('"Pay … and play" pays; an error shows', async () => {
    const onPayWhole = jest.fn().mockResolvedValue('Your card was declined.');
    await render(<NoOpponentPanel testID="nop" info={info} onPayWhole={onPayWhole} onCancelFree={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('nop-pay-whole'));
    expect(onPayWhole).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Your card was declined.')).toBeTruthy());
  });

  it('"Cancel free" asks once more, then cancels', async () => {
    const onCancelFree = jest.fn().mockResolvedValue(null);
    await render(<NoOpponentPanel testID="nop" info={info} onPayWhole={jest.fn()} onCancelFree={onCancelFree} />);
    await fireEvent.press(screen.getByTestId('nop-cancel-free'));
    expect(onCancelFree).not.toHaveBeenCalled();
    expect(screen.getByText('The game is cancelled and everyone gets their money back.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('nop-cancel-free-confirm'));
    expect(onCancelFree).toHaveBeenCalled();
  });

  it('"Keep it" goes back without cancelling', async () => {
    const onCancelFree = jest.fn();
    await render(<NoOpponentPanel testID="nop" info={info} onPayWhole={jest.fn()} onCancelFree={onCancelFree} />);
    await fireEvent.press(screen.getByTestId('nop-cancel-free'));
    await fireEvent.press(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByTestId('nop-pay-whole')).toBeTruthy();
    expect(onCancelFree).not.toHaveBeenCalled();
  });

  it('Losers pay, paying for everyone: the hold pays for the whole pitch (example 12a)', async () => {
    const onPayWhole = jest.fn().mockResolvedValue(null);
    await render(
      <NoOpponentPanel
        testID="nop"
        info={{ amount_cents: 0, choose_by: info.choose_by, losers_pay: true, taken_cents: 4550 }}
        onPayWhole={onPayWhole}
        onCancelFree={jest.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Play the whole pitch' })).toBeTruthy();
    expect(screen.getByTestId('nop-losers-pay')).toHaveTextContent(
      "Your €45.50 hold is taken as the whole pitch's payment. Nothing more to pay.",
    );
    await fireEvent.press(screen.getByTestId('nop-pay-whole'));
    expect(onPayWhole).toHaveBeenCalled();
  });

  it('Losers pay, paying for myself: €4.80 from each hold, a €40.00 guarantee (example 12b)', async () => {
    await render(
      <NoOpponentPanel
        testID="nop"
        info={{ amount_cents: 0, choose_by: info.choose_by, losers_pay: true, taken_cents: 480, player_cents: 480, guarantee_cents: 4000 }}
        onPayWhole={jest.fn()}
        onCancelFree={jest.fn()}
      />,
    );
    expect(screen.getByTestId('nop-losers-pay')).toHaveTextContent(
      'Each player pays €4.80 from their hold and the rest is released. We hold €40.00 on your card for unpaid spots.',
    );
  });

  it('not Losers pay: no Losers pay line', async () => {
    await render(<NoOpponentPanel testID="nop" info={info} onPayWhole={jest.fn()} onCancelFree={jest.fn()} />);
    expect(screen.queryByTestId('nop-losers-pay')).toBeNull();
  });
});
