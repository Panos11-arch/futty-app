import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { BookingSheet, type BookingSheetActions } from '@/components/venue/booking-sheet';
import { loadWithFile } from '@/components/ui/test-utils';
import { appBooking, appRoster, counterRoster, venueQuote, walkIn } from '@/lib/venue-today.fixtures';
import type { Roster } from '@/lib/venue-today';

// A booking's sheet on the venue dashboard (spec 13 "Cash at the venue",
// "Venue dashboard"; spec 05 section 12 items 1, 5, 6, 7 and 11a): the
// roster with each player's payment choice and state, the cash tick (second
// tap), run collection, the check-in code, a walk-in's payment and cancel,
// and the venue's cancel (quote first, second tap).

loadWithFile(Modal, BookingSheet);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

function actions(overrides: Partial<BookingSheetActions> = {}): BookingSheetActions {
  return {
    tickCash: jest.fn(async () => null),
    runCollection: jest.fn(async () => null),
    checkInCode: jest.fn(async () => ({ code: '9f2c4e1a' })),
    markCounterPaid: jest.fn(async () => null),
    cancelCounter: jest.fn(async () => null),
    venueQuote: jest.fn(async () => ({ quote: venueQuote() })),
    venueCancel: jest.fn(async () => ({ status: 'cancelled' as const })),
    ...overrides,
  };
}

async function open(roster: Roster, a = actions(), booking = appBooking()) {
  await render(
    <BookingSheet
      visible
      onClose={jest.fn()}
      booking={booking}
      state={{ status: 'ready', roster }}
      onRetry={jest.fn()}
      actions={a}
    />,
  );
  return a;
}

describe('BookingSheet: app booking roster', () => {
  it("lists every player's payment choice and state", async () => {
    await open(appRoster());
    expect(screen.getByTestId('player-s1')).toHaveTextContent(/Nikos Georgiou.*Booker.*Paid in app.*Checked in/);
    expect(screen.getByTestId('player-s2')).toHaveTextContent(/Eleni.*Cash, not yet paid/);
    expect(screen.getByTestId('player-s3')).toHaveTextContent(/Marios.*Cash, paid/);
    expect(screen.getByTestId('player-s4')).toHaveTextContent(/Petros.*Unpaid/);
  });

  it('ticks cash as paid only on the second tap, with the share id only', async () => {
    const a = await open(appRoster());
    await act(() => fireEvent.press(screen.getByText('Mark €6.00 cash paid')));
    expect(a.tickCash).not.toHaveBeenCalled();
    await act(() => fireEvent.press(screen.getByText('Confirm €6.00 cash received')));
    expect(a.tickCash).toHaveBeenCalledWith('s2');
  });

  it('can step back from the cash tick', async () => {
    const a = await open(appRoster());
    await act(() => fireEvent.press(screen.getByText('Mark €6.00 cash paid')));
    await act(() => fireEvent.press(screen.getByText('Not yet')));
    expect(screen.getByText('Mark €6.00 cash paid')).toBeTruthy();
    expect(a.tickCash).not.toHaveBeenCalled();
  });

  it('shows a refusal inline', async () => {
    const a = await open(appRoster(), actions({ tickCash: jest.fn(async () => 'Collection has already run for this game.') }));
    await act(() => fireEvent.press(screen.getByText('Mark €6.00 cash paid')));
    await act(() => fireEvent.press(screen.getByText('Confirm €6.00 cash received')));
    expect(a.tickCash).toHaveBeenCalled();
    expect(screen.getByText('Collection has already run for this game.')).toBeTruthy();
  });

  it('offers no early collection when the server says it cannot run', async () => {
    await open(appRoster());
    expect(screen.queryByText('Run collection now')).toBeNull();
  });

  it('runs collection early when the server says it can', async () => {
    const a = await open(appRoster({ can_run_collection: true }));
    await act(() => fireEvent.press(screen.getByText('Run collection now')));
    expect(a.runCollection).toHaveBeenCalledWith('b-app');
  });

  it('shows the check-in code', async () => {
    const a = await open(appRoster());
    await act(() => fireEvent.press(screen.getByText('Show check-in code')));
    expect(a.checkInCode).toHaveBeenCalledWith('m1');
    expect(screen.getByTestId('check-in-code')).toHaveTextContent('9f2c4e1a');
  });

  it('venue cancel shows the quote first and cancels on the second tap', async () => {
    const a = await open(appRoster());
    await act(() => fireEvent.press(screen.getByText('Cancel booking')));
    expect(a.venueQuote).toHaveBeenCalledWith('b-app');
    expect(a.venueCancel).not.toHaveBeenCalled();
    expect(
      screen.getByText('Marios: €0.80 back, by card refund or as credit at your venue, their choice. Hand back €6.00 cash.'),
    ).toBeTruthy();
    await act(() => fireEvent.press(screen.getByText('Cancel booking and refund players')));
    expect(a.venueCancel).toHaveBeenCalledWith('b-app', 'q-1');
    expect(screen.getByText('Booking cancelled. Every player has been told.')).toBeTruthy();
  });

  it('shows the new quote when it changed, to confirm again', async () => {
    const fresh = venueQuote({ quote: 'q-2', lines: [venueQuote().lines[0]] });
    const a = await open(
      appRoster(),
      actions({
        venueCancel: jest
          .fn()
          .mockResolvedValueOnce({ status: 'changed', quote: fresh })
          .mockResolvedValue({ status: 'cancelled' }),
      }),
    );
    await act(() => fireEvent.press(screen.getByText('Cancel booking')));
    await act(() => fireEvent.press(screen.getByText('Cancel booking and refund players')));
    expect(screen.getByText('What happens has changed. Check it again before cancelling.')).toBeTruthy();
    expect(screen.queryByText(/^Marios:/)).toBeNull();
    await act(() => fireEvent.press(screen.getByText('Cancel booking and refund players')));
    expect(a.venueCancel).toHaveBeenLastCalledWith('b-app', 'q-2');
  });

  it('says only "Cancel booking" when nobody has paid, so nobody is refunded', async () => {
    const unpaidOnly = venueQuote({ lines: [venueQuote().lines[3]] });
    const a = await open(appRoster(), actions({ venueQuote: jest.fn(async () => ({ quote: unpaidOnly })) }));
    await act(() => fireEvent.press(screen.getByText('Cancel booking')));
    expect(screen.queryByText('Cancel booking and refund players')).toBeNull();
    expect(screen.queryByText(/Stripe/)).toBeNull();
    await act(() => fireEvent.press(screen.getByText('Cancel booking')));
    expect(a.venueCancel).toHaveBeenCalledWith('b-app', 'q-1');
  });

  it('can keep the booking after reading the quote', async () => {
    const a = await open(appRoster());
    await act(() => fireEvent.press(screen.getByText('Cancel booking')));
    await act(() => fireEvent.press(screen.getByText('Keep booking')));
    expect(a.venueCancel).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel booking')).toBeTruthy();
  });
});

describe('BookingSheet: walk-in or phone booking', () => {
  it('is labelled walk-in, with the venue price and what was charged as the server sent them', async () => {
    await open(counterRoster(), actions(), walkIn());
    expect(screen.getByText('Walk-in')).toBeTruthy();
    expect(screen.getByText('Andreas')).toBeTruthy();
    expect(screen.getByText('Charged €45.50 · your price €50.00')).toBeTruthy();
    expect(screen.getByText('Not paid')).toBeTruthy();
  });

  it('is labelled phone', async () => {
    await open(counterRoster({ source: 'phone', charged_cents: 5000, paid_method: 'card', paid_at: 'x' }), actions(), walkIn());
    expect(screen.getByText('Phone')).toBeTruthy();
    expect(screen.getByText('Charged €50.00')).toBeTruthy();
    expect(screen.getByText('Paid card')).toBeTruthy();
    expect(screen.queryByText('Paid cash')).toBeNull();
  });

  it('labels what was charged when the venue has no price for that slot', async () => {
    await open(counterRoster({ venue_price_cents: null }), actions(), walkIn());
    expect(screen.getByText('Charged €45.50')).toBeTruthy();
    expect(screen.queryByText(/your price/i)).toBeNull();
  });

  it('marks it paid by cash or card on the second tap, with its id only', async () => {
    const a = await open(counterRoster(), actions(), walkIn());
    await act(() => fireEvent.press(screen.getByText('Paid card')));
    expect(a.markCounterPaid).not.toHaveBeenCalled();
    await act(() => fireEvent.press(screen.getByText('Confirm €45.50 paid by card')));
    expect(a.markCounterPaid).toHaveBeenCalledWith('b-walk', 'card');
  });

  it('can step back from marking it paid', async () => {
    const a = await open(counterRoster(), actions(), walkIn());
    await act(() => fireEvent.press(screen.getByText('Paid cash')));
    expect(screen.getByText('Confirm €45.50 paid in cash')).toBeTruthy();
    await act(() => fireEvent.press(screen.getByText('Not yet')));
    expect(screen.getByText('Paid cash')).toBeTruthy();
    expect(screen.getByText('Paid card')).toBeTruthy();
    expect(a.markCounterPaid).not.toHaveBeenCalled();
  });

  it('cancels an unpaid one on the second tap, saying the pitch is released', async () => {
    const a = await open(counterRoster(), actions(), walkIn());
    await act(() => fireEvent.press(screen.getByText('Cancel walk-in')));
    expect(a.cancelCounter).not.toHaveBeenCalled();
    expect(screen.getByText('The pitch is released for new bookings.')).toBeTruthy();
    expect(screen.queryByText(/comes off your revenue/)).toBeNull();
    await act(() => fireEvent.press(screen.getByText('Yes, cancel it')));
    expect(a.cancelCounter).toHaveBeenCalledWith('b-walk');
  });

  it('keeps it on "Keep it"', async () => {
    const a = await open(counterRoster({ source: 'phone' }), actions(), walkIn());
    await act(() => fireEvent.press(screen.getByText('Cancel phone booking')));
    await act(() => fireEvent.press(screen.getByText('Keep it')));
    expect(a.cancelCounter).not.toHaveBeenCalled();
    expect(screen.queryByText('Yes, cancel it')).toBeNull();
    expect(screen.getByText('Cancel phone booking')).toBeTruthy();
  });

  it('cancels it on the second tap, saying the money comes off revenue', async () => {
    const a = await open(counterRoster({ paid_method: 'cash', paid_at: 'x' }), actions(), walkIn());
    await act(() => fireEvent.press(screen.getByText('Cancel walk-in')));
    expect(a.cancelCounter).not.toHaveBeenCalled();
    expect(screen.getByText('€45.50 comes off your revenue. Hand it back at the counter.')).toBeTruthy();
    await act(() => fireEvent.press(screen.getByText('Yes, cancel it')));
    expect(a.cancelCounter).toHaveBeenCalledWith('b-walk');
  });
});

describe('BookingSheet: loading and errors', () => {
  it('shows an error with a retry', async () => {
    const onRetry = jest.fn();
    await render(
      <BookingSheet
        visible
        onClose={jest.fn()}
        booking={appBooking()}
        state={{ status: 'error', message: "You're not staff at this venue." }}
        onRetry={onRetry}
        actions={actions()}
      />,
    );
    expect(screen.getByText("You're not staff at this venue.")).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
