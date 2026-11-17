import { fireEvent, render, screen } from '@testing-library/react-native';

import { CustomersView } from '@/components/venue/customers-view';
import { customersList, LEAKED_EMAIL, LEAKED_PHONE } from '@/lib/venue-money.fixtures';

// The venue's customers (P6d; spec 13 "Venue dashboard", Customers): players
// by name with their bookings, debt and credit here, never their email or
// phone; walk-in and phone contacts with the phone staff entered.

const mockRpc = jest.fn((_fn: string, _args: unknown) => Promise.resolve({ data: customersList() as unknown, error: null }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => mockRpc.mockClear());

async function draw() {
  const onOpen = jest.fn();
  await render(<CustomersView venueId="v1" onOpen={onOpen} />);
  await screen.findByText('Andreas');
  return onOpen;
}

describe('CustomersView', () => {
  it('asks for this venue', async () => {
    await draw();
    expect(mockRpc.mock.calls).toEqual([['venue_customers', { p_venue_id: 'v1' }]]);
  });

  it("shows a player's debt and credit as the server sent them", async () => {
    await draw();
    expect(screen.getByRole('button', { name: /Andreas/ })).toHaveTextContent(/3 bookings · owes €6\.80 · credit €12\.34/);
  });

  it("shows a contact's phone", async () => {
    await draw();
    expect(screen.getByRole('button', { name: /Maria Georgiou/ })).toHaveTextContent(/\+35799000001/);
  });

  it("never shows a player's email or phone", async () => {
    await draw();
    expect(screen.queryByText(new RegExp(LEAKED_EMAIL))).toBeNull();
    expect(screen.queryByText(new RegExp(LEAKED_PHONE.replace('+', '\\+')))).toBeNull();
  });

  it('opens a customer by kind and id', async () => {
    const onOpen = await draw();
    await fireEvent.press(screen.getByRole('button', { name: /Andreas/ }));
    await fireEvent.press(screen.getByRole('button', { name: /Maria Georgiou/ }));
    expect(onOpen.mock.calls).toEqual([
      ['player', 'u1'],
      ['contact', 'c1'],
    ]);
  });

  it('no customers yet', async () => {
    mockRpc.mockImplementationOnce(() => Promise.resolve({ data: [], error: null }));
    await render(<CustomersView venueId="v1" onOpen={jest.fn()} />);
    expect(await screen.findByText('No customers yet. Everyone who books here will show up here.')).toBeTruthy();
  });
});
