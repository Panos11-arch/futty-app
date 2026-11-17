import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { BalanceTeams } from '@/components/match/balance-teams';
import { balanceMatchTeams } from '@/lib/match/levels-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/lib/match/levels-api', () => ({ balanceMatchTeams: jest.fn() }));

const balance = balanceMatchTeams as jest.Mock;

beforeEach(() =>
  balance.mockReset().mockResolvedValue({
    result: { sideA: { players: ['a1', 'a2', 'a3'], average: 3.47 }, sideB: { players: ['b1', 'b2'], average: 3.4 } },
    error: null,
  })
);

describe('BalanceTeams', () => {
  it("balances, then shows each side's average from the response and refreshes the sides", async () => {
    const onBalanced = jest.fn();
    await render(<BalanceTeams matchId="m1" labels={{ a: 'Bibs', b: 'Non-bibs' }} onBalanced={onBalanced} />);
    await fireEvent.press(screen.getByTestId('balance-teams-button'));
    expect(balance).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(screen.getByText('Average level 3.5')).toBeTruthy());
    expect(screen.getByText('Average level 3.4')).toBeTruthy();
    expect(screen.getByText('3 players')).toBeTruthy();
    expect(onBalanced).toHaveBeenCalled();
  });

  it('an empty side says so', async () => {
    balance.mockResolvedValue({
      result: { sideA: { players: ['a1'], average: 3 }, sideB: { players: [], average: null } },
      error: null,
    });
    await render(<BalanceTeams matchId="m1" labels={{ a: 'Bibs', b: 'Non-bibs' }} onBalanced={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('balance-teams-button'));
    await waitFor(() => expect(screen.getByText('No players')).toBeTruthy());
  });

  it.each([
    ['sides_locked', 'Sides are locked once the score is entered.'],
    ['not_booker', 'Only the person who booked can balance the teams.'],
    ['not_pickup', 'Teams can only be balanced in a pickup game.'],
  ])('%s is refused in words', async (code, words) => {
    balance.mockResolvedValue({ result: null, error: { message: code } });
    await render(<BalanceTeams matchId="m1" labels={{ a: 'Bibs', b: 'Non-bibs' }} onBalanced={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('balance-teams-button'));
    await waitFor(() => expect(screen.getByText(words)).toBeTruthy());
  });
});
