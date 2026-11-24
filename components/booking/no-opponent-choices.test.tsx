import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { NoOpponentChoicesList } from '@/components/booking/no-opponent-choices';
import type { NoOpponentChoice } from '@/lib/booking-opposition';
import { primeRules } from '@/lib/rules.fixtures';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@stripe/stripe-react-native', () => ({ useStripe: () => ({}) }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => primeRules());

const choice: NoOpponentChoice = {
  booking_id: 'b1',
  venue_name: 'Kamares',
  booking_day: '2026-11-26',
  start_time: '20:00:00',
  end_time: '21:00:00',
  pitch_label: 'Pitch 2',
  amount_cents: 2275,
  choose_by: '2026-11-26T12:00:00Z',
};

describe('NoOpponentChoicesList (Home, B3)', () => {
  it('nothing to choose: nothing on Home', async () => {
    await render(<NoOpponentChoicesList load={async () => []} onPayWhole={jest.fn()} onCancelFree={jest.fn()} />);
    await waitFor(() => expect(screen.queryByTestId('home-no-opponent-b1')).toBeNull());
    expect(screen.toJSON()).toBeNull();
  });

  it('a card per game waiting for the choice, with the game and the server’s amount', async () => {
    await render(<NoOpponentChoicesList load={async () => [choice]} onPayWhole={jest.fn()} onCancelFree={jest.fn()} />);
    expect(await screen.findByText('Kamares · Pitch 2 · Thu 26 Nov · 20:00')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pay €22.75 and play' })).toBeTruthy();
  });

  it('both buttons work from Home, and the list reloads after', async () => {
    const load = jest.fn().mockResolvedValueOnce([choice]).mockResolvedValue([]);
    const onPayWhole = jest.fn().mockResolvedValue(null);
    const onCancelFree = jest.fn().mockResolvedValue(null);
    await render(<NoOpponentChoicesList load={load} onPayWhole={onPayWhole} onCancelFree={onCancelFree} />);
    await fireEvent.press(await screen.findByTestId('home-no-opponent-b1-pay-whole'));
    expect(onPayWhole).toHaveBeenCalledWith('b1');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('cancel free from Home', async () => {
    const onCancelFree = jest.fn().mockResolvedValue(null);
    await render(<NoOpponentChoicesList load={async () => [choice]} onPayWhole={jest.fn()} onCancelFree={onCancelFree} />);
    await fireEvent.press(await screen.findByTestId('home-no-opponent-b1-cancel-free'));
    await fireEvent.press(screen.getByTestId('home-no-opponent-b1-cancel-free-confirm'));
    expect(onCancelFree).toHaveBeenCalledWith('b1');
  });

  it('a failed load shows nothing rather than an error on Home', async () => {
    await render(
      <NoOpponentChoicesList load={async () => Promise.reject(new Error('x'))} onPayWhole={jest.fn()} onCancelFree={jest.fn()} />,
    );
    await waitFor(() => expect(screen.toJSON()).toBeNull());
  });
});
