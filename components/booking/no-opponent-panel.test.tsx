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
});
