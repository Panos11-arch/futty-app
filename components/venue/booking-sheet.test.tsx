import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { BookingSheet, type BookingSheetActions } from '@/components/venue/booking-sheet';
import { loadWithFile } from '@/components/ui/test-utils';
import {
  appBooking,
  appRoster,
  counterRoster,
  rosterPlayer,
  venuePlayer,
  venueQuote,
  walkIn,
} from '@/lib/venue-today.fixtures';
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
jest.mock('react-native-qrcode-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return function QRCodeMock() {
    return React.createElement(View, { testID: 'check-in-qr' });
  };
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

function actions(overrides: Partial<BookingSheetActions> = {}): BookingSheetActions {
  return {
    tickCash: jest.fn(async () => null),
    runCollection: jest.fn(async () => null),
    checkInCode: jest.fn(async () => ({
      code: '9f2c4e1a',
      kickoffAt: '2026-11-20T18:00:00+00:00',
      endsAt: '2026-11-20T19:00:00+00:00',
    })),
    markCounterPaid: jest.fn(async () => null),
    cancelCounter: jest.fn(async () => null),
    venueQuote: jest.fn(async () => ({ quote: venueQuote() })),
    venueCancel: jest.fn(async () => ({ status: 'cancelled' as const })),
    offerPlayer: jest.fn(async () => null),
    withdrawPlayer: jest.fn(async () => null),
    markArrived: jest.fn(async () => null),
    unmarkArrived: jest.fn(async () => null),
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

  it('shows the check-in QR, its code and its window', async () => {
    const a = await open(appRoster());
    await act(() => fireEvent.press(screen.getByText('Check-in QR')));
    expect(a.checkInCode).toHaveBeenCalledWith('m1');
    expect(screen.getByTestId('check-in-qr')).toBeTruthy();
    expect(screen.getByTestId('check-in-code')).toHaveTextContent('9f2c 4e1a');
    expect(screen.getByText('Players can check in from 19:00 to 22:00.')).toBeTruthy();
  });

  it('words a check-in QR that cannot load', async () => {
    await open(appRoster(), actions({ checkInCode: jest.fn(async () => ({ error: "You're not staff at this venue." })) }));
    await act(() => fireEvent.press(screen.getByText('Check-in QR')));
    expect(screen.queryByTestId('check-in-qr')).toBeNull();
    expect(screen.getByText("You're not staff at this venue.")).toBeTruthy();
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

  it('shows the Stripe fee the server quoted, unchanged, before staff confirm', async () => {
    await open(appRoster());
    await act(() => fireEvent.press(screen.getByText('Cancel booking')));
    expect(screen.getByText("Stripe's fees on these payments: €1.37. This comes off your next payout.")).toBeTruthy();
  });

  it("shows nothing about Stripe's fees when the server says 0", async () => {
    const noFee = venueQuote({ venue_stripe_fee_cents: 0 });
    await open(appRoster(), actions({ venueQuote: jest.fn(async () => ({ quote: noFee })) }));
    await act(() => fireEvent.press(screen.getByText('Cancel booking')));
    expect(screen.getByText('Cancel booking and refund players')).toBeTruthy();
    expect(screen.queryByText(/Stripe/)).toBeNull();
  });

  it('says only "Cancel booking" when nobody has paid, so nobody is refunded', async () => {
    const unpaidOnly = venueQuote({ lines: [venueQuote().lines[3]], venue_stripe_fee_cents: 0 });
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

// P6e: staff offer a player to a short team (spec 13 "Venue-offered players").
// The roster's venue_players and can_offer_player are the server's; the app
// sends the booking id and the name, or the offer id, only.
describe('BookingSheet: venue players', () => {
  it('lists the players the venue offered, with their state', async () => {
    await open(
      appRoster({
        venue_players: [
          venuePlayer({ id: 'o1', name: 'Andreas', state: 'accepted' }),
          venuePlayer({ id: 'o2', name: 'Bambos', state: 'offered' }),
          venuePlayer({ id: 'o3', name: 'Christos', state: 'lapsed', can_withdraw: false }),
        ],
      }),
    );
    expect(screen.getByText('Venue players')).toBeTruthy();
    expect(screen.getByTestId('venue-player-o1')).toHaveTextContent(/Andreas.*Accepted/);
    expect(screen.getByTestId('venue-player-o2')).toHaveTextContent(/Bambos.*Offered, waiting for the booker/);
    expect(screen.getByTestId('venue-player-o3')).toHaveTextContent(/Christos.*Not answered before kickoff/);
    expect(screen.queryByRole('button', { name: 'Withdraw Christos' })).toBeNull();
  });

  it('withdraws a player with his offer id only', async () => {
    const a = await open(appRoster({ venue_players: [venuePlayer({ id: 'o1', name: 'Andreas', state: 'accepted' })] }));
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Withdraw Andreas' })));
    expect(a.withdrawPlayer).toHaveBeenCalledWith('o1');
  });

  it('shows no venue players section when there is nothing to show or do', async () => {
    await open(appRoster());
    expect(screen.queryByText('Venue players')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Offer a player' })).toBeNull();
  });

  it('offers a player by name: the booking id and the name only', async () => {
    const a = await open(appRoster({ can_offer_player: true }));
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Offer a player' })));
    expect(screen.getByText("The player plays free; the team's amounts don't change.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Offer the player' })).toBeDisabled();

    await act(() => fireEvent.changeText(screen.getByLabelText("Player's name"), 'Andreas'));
    expect(screen.getByText("Andreas plays free; the team's amounts don't change.")).toBeTruthy();
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Offer Andreas' })));
    expect(a.offerPlayer).toHaveBeenCalledWith('b-app', 'Andreas');
    // Done: the form closes.
    expect(screen.queryByLabelText("Player's name")).toBeNull();
  });

  it('keeps the form and shows the refusal when the server says no', async () => {
    const a = actions({ offerPlayer: jest.fn(async () => 'Every spot in this game is taken or already offered.') });
    await open(appRoster({ can_offer_player: true }), a);
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Offer a player' })));
    await act(() => fireEvent.changeText(screen.getByLabelText("Player's name"), 'Andreas'));
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Offer Andreas' })));
    expect(screen.getByText('Every spot in this game is taken or already offered.')).toBeTruthy();
    expect(screen.getByLabelText("Player's name")).toBeTruthy();
  });

  it('can step back from the offer', async () => {
    const a = await open(appRoster({ can_offer_player: true }));
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Offer a player' })));
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Not now' })));
    expect(screen.queryByLabelText("Player's name")).toBeNull();
    expect(a.offerPlayer).not.toHaveBeenCalled();
  });

  it('never calls the player "he": every line uses his name', async () => {
    await open(
      appRoster({ can_offer_player: true, venue_players: [venuePlayer({ name: 'Andreas', state: 'accepted' })] }),
    );
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Offer a player' })));
    expect(screen.queryByText(/\bhe\b/i)).toBeNull();
  });
});

// P6e no-shows (spec 13 "No-shows"): each player's attendance as the server
// named it, their final no-shows at this venue, and staff's tick for a spot
// holder who came but didn't scan. What staff can do is the server's
// can_mark_arrived and can_unmark_arrived; the app sends the match id and the
// player's id only.
describe('BookingSheet: attendance and no-shows', () => {
  const players = [
    rosterPlayer({ share_id: 'a1', profile_id: 'u1', name: 'Andreas', attendance: 'checked_in', check_in_method: 'qr' }),
    rosterPlayer({ share_id: 'a2', profile_id: 'u2', name: 'Bambos', attendance: 'checked_in', check_in_method: 'captain' }),
    rosterPlayer({
      share_id: 'a3',
      profile_id: 'u3',
      name: 'Christos',
      attendance: 'checked_in',
      check_in_method: 'venue',
      can_unmark_arrived: true,
    }),
    rosterPlayer({ share_id: 'a4', profile_id: 'u4', name: 'Demos', attendance: 'not_yet', can_mark_arrived: true }),
    rosterPlayer({ share_id: 'a5', profile_id: 'u5', name: 'Eleni', attendance: 'missing', can_mark_arrived: true }),
    rosterPlayer({ share_id: 'a6', profile_id: 'u6', name: 'Fotis', attendance: 'no_show', no_show_count: 2 }),
  ];

  it("shows each player's attendance in words", async () => {
    await open(appRoster({ players }));
    expect(screen.getByTestId('player-a1')).toHaveTextContent(/Andreas.*Checked in/);
    expect(screen.getByTestId('player-a2')).toHaveTextContent(/Bambos.*Checked in/);
    expect(screen.getByTestId('player-a3')).toHaveTextContent(/Christos.*Ticked by venue/);
    expect(screen.getByTestId('player-a4')).toHaveTextContent(/Demos.*Not checked in yet/);
    expect(screen.getByTestId('player-a5')).toHaveTextContent(/Eleni.*Didn't check in/);
    expect(screen.getByTestId('player-a6')).toHaveTextContent(/Fotis.*No-show/);
  });

  it('shows no attendance when the game has no match yet', async () => {
    await open(
      appRoster({ match_id: null, players: [rosterPlayer({ share_id: 'a1', name: 'Andreas', attendance: null })] }),
    );
    expect(screen.getByTestId('player-a1')).not.toHaveTextContent(/check|No-show|Ticked/i);
  });

  it("captions a player's no-shows at this venue only when there are some", async () => {
    await open(appRoster({ players }));
    expect(screen.getByTestId('player-a6')).toHaveTextContent(/2 no-shows here/);
    expect(screen.getByTestId('player-a1')).not.toHaveTextContent(/no-show/);
  });

  it('says "1 no-show here" for one', async () => {
    await open(appRoster({ players: [rosterPlayer({ share_id: 'a1', no_show_count: 1 })] }));
    expect(screen.getByTestId('player-a1')).toHaveTextContent(/1 no-show here/);
  });

  /** A button in one player's row. */
  const inRow = (shareId: string, name: string) =>
    within(screen.getByTestId(`player-${shareId}`)).queryByRole('button', { name });

  it('marks a player arrived in one tap, with the match id and their id only', async () => {
    const a = await open(appRoster({ players }));
    await act(() => fireEvent.press(inRow('a4', 'Mark arrived')!));
    expect(a.markArrived).toHaveBeenCalledWith('m1', 'u4');
    expect(a.markArrived).toHaveBeenCalledTimes(1);
  });

  it('offers "Mark arrived" only where the server says staff can', async () => {
    await open(appRoster({ players }));
    expect(inRow('a4', 'Mark arrived')).toBeTruthy();
    expect(inRow('a5', 'Mark arrived')).toBeTruthy();
    for (const shareId of ['a1', 'a2', 'a3', 'a6']) {
      expect(inRow(shareId, 'Mark arrived')).toBeNull();
    }
  });

  it('offers "Undo arrived" only for a venue tick', async () => {
    const a = await open(appRoster({ players }));
    for (const shareId of ['a1', 'a2', 'a4', 'a5', 'a6']) {
      expect(inRow(shareId, 'Undo arrived')).toBeNull();
    }
    await act(() => fireEvent.press(inRow('a3', 'Undo arrived')!));
    expect(a.unmarkArrived).toHaveBeenCalledWith('m1', 'u3');
  });

  it("shows the server's refusal in words, in that player's row", async () => {
    const a = actions({ unmarkArrived: jest.fn(async () => "They've already voted, so this can't be undone.") });
    await open(appRoster({ players }), a);
    await act(() => fireEvent.press(inRow('a3', 'Undo arrived')!));
    expect(screen.getByTestId('player-a3')).toHaveTextContent(/They've already voted, so this can't be undone\./);
    expect(screen.getByTestId('player-a4')).not.toHaveTextContent(/voted/);
  });
});
