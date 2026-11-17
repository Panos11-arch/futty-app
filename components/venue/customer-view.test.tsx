import { render, screen } from '@testing-library/react-native';

import { CustomerView } from '@/components/venue/customer-view';
import { contactDetail, LEAKED_EMAIL, LEAKED_PHONE, playerDetail } from '@/lib/venue-money.fixtures';

// One customer of the venue (P6d; spec 13 "Venue dashboard", Customers):
// their bookings here with each one's status and, for a player, debt and
// credit here. Amounts are the server's; a player's email and phone never show.

let mockReply: { data: unknown; error: { message: string } | null } = { data: playerDetail(), error: null };
const mockRpc = jest.fn((_fn: string, _args: unknown) => Promise.resolve(mockReply));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => {
  mockRpc.mockClear();
  mockReply = { data: playerDetail(), error: null };
});

describe('CustomerView: a player', () => {
  it('asks for this player at this venue', async () => {
    await render(<CustomerView venueId="v1" kind="player" id="u1" />);
    await screen.findByText('Andreas');
    expect(mockRpc.mock.calls).toEqual([['venue_customer', { p_venue_id: 'v1', p_kind: 'player', p_id: 'u1' }]]);
  });

  it("shows the server's debt and credit, not the sums of the lists", async () => {
    await render(<CustomerView venueId="v1" kind="player" id="u1" />);
    expect(await screen.findByTestId('customer-debt')).toHaveTextContent('€42.42');
    expect(screen.getByTestId('customer-credit')).toHaveTextContent('€8.88');
  });

  it('lists bookings with status, debts open and settled, and credits with expiry', async () => {
    await render(<CustomerView venueId="v1" kind="player" id="u1" />);
    await screen.findByText('Andreas');
    expect(screen.getByTestId('customer-booking-b1')).toHaveTextContent(/Tue 17 Nov 2026 · 18:00–19:00/);
    expect(screen.getByTestId('customer-booking-b1')).toHaveTextContent(/Booker · paid €6\.80 by card/);
    expect(screen.getByTestId('customer-booking-b2')).toHaveTextContent(/Cancelled/);
    expect(screen.getByTestId('customer-debt-d1')).toHaveTextContent(/€6\.80 · Cash not paid · open/);
    expect(screen.getByTestId('customer-debt-d2')).toHaveTextContent(/€6\.00 · Unpaid share · settled Fri 2 Oct 2026/);
    expect(screen.getByTestId('customer-credit-cr1')).toHaveTextContent(/€3\.00 left of €5\.80 · expires Mon 1 Nov 2027/);
    expect(screen.getByTestId('customer-credit-cr2')).toHaveTextContent(/expired Thu 1 Oct 2026/);
  });

  it('settling is on the Debts list only', async () => {
    await render(<CustomerView venueId="v1" kind="player" id="u1" />);
    await screen.findByText('Andreas');
    expect(screen.queryByRole('button', { name: /Mark .* settled/ })).toBeNull();
  });

  it('never shows their email or phone', async () => {
    await render(<CustomerView venueId="v1" kind="player" id="u1" />);
    await screen.findByText('Andreas');
    expect(screen.queryByText(new RegExp(LEAKED_EMAIL))).toBeNull();
    expect(screen.queryByText(new RegExp(LEAKED_PHONE.replace('+', '\\+')))).toBeNull();
  });

  it('someone who is not a customer here', async () => {
    mockReply = { data: null, error: { message: 'customer_not_found' } };
    await render(<CustomerView venueId="v1" kind="player" id="u9" />);
    expect(await screen.findByText('This customer isn’t one of yours.')).toBeTruthy();
  });
});

describe('CustomerView: a walk-in or phone contact', () => {
  it('shows the phone staff entered and the price and charge', async () => {
    mockReply = { data: contactDetail(), error: null };
    await render(<CustomerView venueId="v1" kind="contact" id="c1" />);
    await screen.findByText('Maria Georgiou');
    expect(screen.getByText('+35799000001')).toBeTruthy();
    expect(screen.getByTestId('customer-booking-cb1')).toHaveTextContent(/Walk-in · your price €60\.00 · charged €50\.00/);
  });
});
