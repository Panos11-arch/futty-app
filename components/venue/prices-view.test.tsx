import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { PricesView } from '@/components/venue/prices-view';
import { callsTo, refuse, resetRpc, rpc as mockRpc, writes } from '@/components/venue/setup-test-helpers';

// Prices (P6e; spec 13 "Venue setup", "Prices and fees"): staff type each
// price; it is read as whole cents (parseEurosInput), never a floating-point
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
    expect(await screen.findByTestId('price-5-a-side')).toHaveTextContent(
      /€50\.00 an hour · peak €60\.00 \(Mon–Fri 17:00–closing\) · weekend €55\.00 \(Sat–Sun\)/,
    );
    expect(screen.getByTestId('price-7-a-side')).toHaveTextContent(/€70\.00 an hour/);
    expect(screen.getByTestId('price-6-a-side')).toHaveTextContent(/No price, so it can’t be booked/);
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it('sends a typed price as whole cents, with the bands it already has', async () => {
    await openFormat('5-a-side');
    expect(screen.getAllByText(NOTE).length).toBeGreaterThan(1);
    await fireEvent.changeText(screen.getByLabelText('Price an hour'), '60,50');
    await fireEvent.press(screen.getByText('Save price'));
    await waitFor(() => expect(callsTo('set_price_rule')).toHaveLength(1));
    expect(callsTo('set_price_rule')[0]).toEqual({
      p_venue_id: 'v1',
      p_format: '5-a-side',
      p_price_cents: 6050,
      p_peak_cents: 6000,
      p_weekend_cents: 5500,
      p_peak_weekdays: [1, 2, 3, 4, 5],
      p_peak_starts: '17:00',
      p_peak_ends: null,
      p_weekend_weekdays: [6, 7],
    });
  });

  it('a new price with peak hours: days, start and end as chosen, no weekend price', async () => {
    await openFormat('6-a-side');
    await fireEvent.changeText(screen.getByLabelText('Price an hour'), '48');
    await fireEvent.press(screen.getByLabelText('Peak price'));
    await fireEvent.changeText(screen.getByLabelText('Peak price an hour'), '55.5');
    await fireEvent.press(screen.getByTestId('peak-day-5'));
    await fireEvent.press(screen.getByTestId('peak-start-18:00'));
    await fireEvent.press(screen.getByTestId('peak-end-22:00'));
    await fireEvent.press(screen.getByText('Save price'));
    await waitFor(() => expect(callsTo('set_price_rule')).toHaveLength(1));
    expect(callsTo('set_price_rule')[0]).toEqual({
      p_venue_id: 'v1',
      p_format: '6-a-side',
      p_price_cents: 4800,
      p_peak_cents: 5550,
      p_weekend_cents: null,
      p_peak_weekdays: [1, 2, 3, 4],
      p_peak_starts: '18:00',
      p_peak_ends: '22:00',
      p_weekend_weekdays: [],
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

  it('greys out a day already in the other band', async () => {
    await openFormat('5-a-side');
    expect(screen.getByTestId('peak-day-6')).toBeDisabled();
    expect(screen.getByTestId('peak-day-1')).toBeEnabled();
    expect(screen.getByTestId('weekend-day-1')).toBeDisabled();
    expect(screen.getByTestId('weekend-day-7')).toBeEnabled();
    expect(screen.getByTestId('peak-end-17:00')).toBeDisabled();
    expect(screen.getByTestId('peak-end-17:30')).toBeEnabled();
  });

  it('removes a format’s price', async () => {
    await openFormat('7-a-side');
    await fireEvent.press(screen.getByText('Remove price'));
    await waitFor(() => expect(callsTo('remove_price_rule')).toEqual([{ p_venue_id: 'v1', p_format: '7-a-side' }]));
  });
});
