import { render, screen } from '@testing-library/react-native';

import { CreditsView } from '@/components/venue/credits-view';
import { creditsList, LEAKED_EMAIL, LEAKED_PHONE } from '@/lib/venue-money.fixtures';

// Credit players can still spend at the venue (P6d; spec 13 "Venue credit"):
// each player's available credit as the server sent it, and each credit's
// expiry as a Cyprus date.

const mockRpc = jest.fn((_fn: string, _args: unknown) => Promise.resolve({ data: creditsList() as unknown, error: null }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => mockRpc.mockClear());

describe('CreditsView', () => {
  it("shows the server's available credit, not the sum of the pieces", async () => {
    await render(<CreditsView venueId="v1" />);
    expect(await screen.findByTestId('credit-u1')).toHaveTextContent(/€8\.88/);
    expect(mockRpc.mock.calls).toEqual([['venue_credit_list', { p_venue_id: 'v1' }]]);
  });

  it('each credit with its Cyprus expiry date', async () => {
    await render(<CreditsView venueId="v1" />);
    await screen.findByText('Andreas');
    // 22:30 UTC on 31 Dec is 1 Jan in Cyprus.
    expect(screen.getByTestId('credit-cr1')).toHaveTextContent('€3.00 · expires Fri 1 Jan 2027');
    expect(screen.getByTestId('credit-cr3')).toHaveTextContent('€4.00 · expires Mon 1 Nov 2027');
  });

  it("never shows a player's email or phone", async () => {
    await render(<CreditsView venueId="v1" />);
    await screen.findByText('Andreas');
    expect(screen.queryByText(new RegExp(LEAKED_EMAIL))).toBeNull();
    expect(screen.queryByText(new RegExp(LEAKED_PHONE.replace('+', '\\+')))).toBeNull();
  });

  it('no credit', async () => {
    mockRpc.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));
    await render(<CreditsView venueId="v1" />);
    expect(await screen.findByText('No player has credit at your venue.')).toBeTruthy();
  });
});
