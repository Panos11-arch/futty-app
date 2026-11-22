import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { PricesView } from '@/components/venue/prices-view';
import { callsTo, refuse, resetRpc, rpc as mockRpc, writes } from '@/components/venue/setup-test-helpers';

// Prices (P6e; spec 13 "Venue setup", "Pitch prices"): one price per
// format, the same on every day and at every hour. Staff type it; it is read as whole cents (parseEurosInput), never a floating-point
// number, and the server decides whether it is allowed. A new price applies
// to new bookings only, and the screen says so.

loadWithFile(Modal, PricesView);

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const NOTE = 'New prices apply to new bookings only. Games already booked keep their price.';

beforeEach(() => resetRpc());

async function openFormat(format: string) {
  await render(<PricesView venueId="v1" />);
  await fireEvent.press(await screen.findByTestId(`price-${format}`));
}

describe('PricesView', () => {
  it("lists every format with the server's prices unchanged, and says new prices are for new bookings", async () => {
    await render(<PricesView venueId="v1" />);
    expect(await screen.findByTestId('price-5-a-side')).toHaveTextContent(/€50\.00 an hour/);
    expect(screen.queryByText(/peak|weekend/i)).toBeNull();
    expect(screen.getByTestId('price-7-a-side')).toHaveTextContent(/€70\.00 an hour/);
    expect(screen.getByTestId('price-6-a-side')).toHaveTextContent(/No price, so it can’t be booked/);
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it('sends a typed price as whole cents, and only the price', async () => {
    await openFormat('5-a-side');
    expect(screen.getAllByText(NOTE).length).toBeGreaterThan(1);
    expect(screen.queryByText(/peak|weekend/i)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Price an hour'), '60,50');
    await fireEvent.press(screen.getByText('Save price'));
    await waitFor(() => expect(callsTo('set_price_rule')).toHaveLength(1));
    expect(callsTo('set_price_rule')[0]).toEqual({
      p_venue_id: 'v1',
      p_format: '5-a-side',
      p_price_cents: 6050,
    });
  });

  it("a €0 price goes to the server and is stopped with the server's message", async () => {
    refuse('set_price_rule', 'invalid_price');
    await openFormat('7-a-side');
    await fireEvent.changeText(screen.getByLabelText('Price an hour'), '0');
    await fireEvent.press(screen.getByText('Save price'));
    expect(await screen.findByText('Every price must be more than €0.')).toBeTruthy();
    expect(callsTo('set_price_rule')[0]).toMatchObject({ p_price_cents: 0 });
  });

  it('text that is not an amount is stopped in the app, calling nothing', async () => {
    await openFormat('7-a-side');
    await fireEvent.changeText(screen.getByLabelText('Price an hour'), 'seventy');
    await fireEvent.press(screen.getByText('Save price'));
    expect(await screen.findByText('Enter a price like 50 or 50.50.')).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it('removes a format’s price', async () => {
    await openFormat('7-a-side');
    await fireEvent.press(screen.getByText('Remove price'));
    await waitFor(() => expect(callsTo('remove_price_rule')).toEqual([{ p_venue_id: 'v1', p_format: '7-a-side' }]));
  });
});
