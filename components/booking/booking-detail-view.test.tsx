import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';

import { BookingDetailView, OLD_RULES_WORDS, type BookingDetailViewProps } from '@/components/booking/booking-detail-view';
import { loadWithFile } from '@/components/ui/test-utils';
import type { BookingDetailData } from '@/lib/booking-detail';
import { bookerDetail, mySpotQuote, playerDetail, switchInfo, wholeTeamQuote } from '@/lib/booking-detail.fixtures';

// The cancel sheet is a Modal: load it with the file, not in the first test.
loadWithFile(Modal, BookingDetailView);

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/calendar', () => ({ addBookingToCalendar: jest.fn(), syncBookingInCalendar: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const now = new Date('2026-11-16T08:00:00Z');
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

function props(detail: BookingDetailData, overrides: Partial<BookingDetailViewProps> = {}): BookingDetailViewProps {
  return {
    state: { status: 'ready', data: detail },
    onRetry: jest.fn(),
    onRefresh: jest.fn(),
    onQuote: jest.fn(async (scope) => ({ quote: scope === 'my_spot' ? mySpotQuote() : wholeTeamQuote() })),
    onConfirmCancel: jest.fn(async () => ({ status: 'cancelled' as const })),
    onInvite: jest.fn(async () => null),
    onShare: jest.fn(),
    onAddToCalendar: jest.fn(),
    inCalendar: false,
    onDirections: jest.fn(),
    onPayShare: jest.fn(),
    notice: null,
    squadNeed: <Text>Squad need panel</Text>,
    now,
    ...overrides,
  };
}

const rowFor = (name: string) => screen.getByTestId(`roster-${name}`);

describe('BookingDetailView: cancel', () => {
  it('shows the quote before cancelling, and a second tap confirms', async () => {
    const p = props(playerDetail());
    await render(<BookingDetailView {...p} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel my spot' }));
    expect(p.onQuote).toHaveBeenCalledWith('my_spot');
    expect(await screen.findByText('€1.00 is kept. €5.80 becomes credit at Nuevo Campo.')).toBeTruthy();
    expect(p.onConfirmCancel).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: cancel my spot' }));
    expect(p.onConfirmCancel).toHaveBeenCalledTimes(1);
    expect(p.onConfirmCancel).toHaveBeenCalledWith({ scope: 'my_spot', quote: 'q1' });
  });

  it('the booker cancels the whole team: the €6.00 charge shows first', async () => {
    const p = props(bookerDetail());
    await render(<BookingDetailView {...p} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel whole team' }));
    expect(p.onQuote).toHaveBeenCalledWith('whole_team');
    expect(await screen.findByText(/costs €6\.00/)).toBeTruthy();
    expect(p.onConfirmCancel).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: cancel the whole team' }));
    expect(p.onConfirmCancel).toHaveBeenCalledWith({ scope: 'whole_team', quote: 'q2' });
  });

  it('a changed quote is shown again and needs another tap', async () => {
    const changed = mySpotQuote({ quote: 'q9', lines: [{ ...mySpotQuote().lines[0], kept_cents: 680, credit_cents: 0, action: 'keep' }] });
    const p = props(playerDetail(), {
      onConfirmCancel: jest.fn().mockResolvedValueOnce({ status: 'changed', quote: changed }).mockResolvedValue({ status: 'cancelled' }),
    });
    await render(<BookingDetailView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel my spot' }));
    await screen.findByText(/becomes credit/);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: cancel my spot' }));

    expect(await screen.findByText('Nothing comes back. €6.80 is kept.')).toBeTruthy();
    expect(screen.getByText(/has changed/)).toBeTruthy();
    expect(p.onConfirmCancel).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: cancel my spot' }));
    expect(p.onConfirmCancel).toHaveBeenLastCalledWith({ scope: 'my_spot', quote: 'q9' });
  });

  it('a quote that fails to load shows why and offers no confirm', async () => {
    const p = props(playerDetail(), { onQuote: jest.fn(async () => ({ error: 'The game has started, so it can no longer be cancelled.' })) });
    await render(<BookingDetailView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel my spot' }));
    expect(await screen.findByText('The game has started, so it can no longer be cancelled.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm: cancel my spot' })).toBeNull();
  });

  it('cancel buttons follow can_cancel', async () => {
    await render(<BookingDetailView {...props(playerDetail())} />);
    expect(screen.getByRole('button', { name: 'Cancel my spot' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel whole team' })).toBeNull();

    await render(<BookingDetailView {...props(bookerDetail({ can_cancel: { my_spot: false, whole_team: true } }))} />);
    expect(screen.queryByRole('button', { name: 'Cancel my spot' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel whole team' })).toBeTruthy();
  });

  it('a booking made before P4a: no money promise, says the old rules apply, and still needs a second tap', async () => {
    const detail = bookerDetail();
    const p = props({ ...detail, booking: { ...detail.booking, payment_mode: null } });
    await render(<BookingDetailView {...p} />);
    expect(screen.queryByRole('button', { name: 'Cancel my spot' })).toBeNull();
    expect(screen.queryByText(/You see exactly what happens to the money/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel whole team' }));
    expect(p.onQuote).not.toHaveBeenCalled();
    expect(await screen.findByText(OLD_RULES_WORDS)).toBeTruthy();
    expect(OLD_RULES_WORDS).toBe('This booking was made under the old rules. Cancelling follows those rules.');
    expect(p.onConfirmCancel).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: cancel the whole team' }));
    expect(p.onConfirmCancel).toHaveBeenCalledWith({ scope: 'whole_team', quote: null });
  });

  it('a booking with a quote says the money is shown first', async () => {
    await render(<BookingDetailView {...props(playerDetail())} />);
    expect(screen.getByText('You see exactly what happens to the money before anything is cancelled.')).toBeTruthy();
  });

  it('closing the sheet while the quote loads keeps it closed when the quote arrives', async () => {
    let resolve: (r: { quote: ReturnType<typeof mySpotQuote> }) => void = () => {};
    const p = props(playerDetail(), { onQuote: jest.fn(() => new Promise((r) => (resolve = r))) });
    await render(<BookingDetailView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel my spot' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my spot' }));
    await act(async () => resolve({ quote: mySpotQuote() }));
    expect(screen.queryByRole('button', { name: 'Confirm: cancel my spot' })).toBeNull();
    expect(screen.queryByText('€1.00 is kept. €5.80 becomes credit at Nuevo Campo.')).toBeNull();
  });
});

describe('BookingDetailView: roster', () => {
  it('the booker sees everyone’s amounts, unchanged (580 -> €5.80)', async () => {
    await render(<BookingDetailView {...props(bookerDetail())} />);
    expect(within(rowFor('s1')).getByText('€5.80')).toBeTruthy();
    expect(within(rowFor('s2')).getByText('€0.80 + €5.00 cash')).toBeTruthy();
    expect(within(rowFor('s3')).getByText('€0.80 + €5.00 cash')).toBeTruthy();
    expect(within(rowFor('s4')).getByText('€5.80')).toBeTruthy();
  });

  it('another player sees only their own amount; everyone sees names and paid state', async () => {
    await render(<BookingDetailView {...props(playerDetail())} />);
    expect(within(rowFor('s2')).getByText('€0.80 + €5.00 cash')).toBeTruthy();
    for (const id of ['s1', 's3', 's4']) expect(within(rowFor(id)).queryByText(/€/)).toBeNull();
    expect(within(rowFor('s1')).getByText('Dimitris')).toBeTruthy();
    expect(within(rowFor('s1')).getByLabelText('Paid')).toBeTruthy();
    expect(within(rowFor('s2')).getByLabelText('Cash')).toBeTruthy();
    expect(within(rowFor('s3')).getByText('Paid in cash at the venue')).toBeTruthy();
    expect(within(rowFor('s4')).getByLabelText('Unpaid')).toBeTruthy();
  });
});

describe('BookingDetailView: countdown', () => {
  it('follows the server’s cutoff', async () => {
    const p = props(playerDetail({ next_cutoff: { kind: 'free_hour_ends', at: at(42) } }));
    await render(<BookingDetailView {...p} />);
    expect(screen.getByText('Free cancellation ends in 42 min')).toBeTruthy();

    // The booker paid €5.80 by card; the free hour is over.
    await render(<BookingDetailView {...props(bookerDetail({ next_cutoff: { kind: 'refunds_stop', at: at(28 * 60) } }))} />);
    expect(screen.getByText('Cancel in the next 1 d 4 h and you get credit at Nuevo Campo, minus €1.00.')).toBeTruthy();

    await render(<BookingDetailView {...props(bookerDetail({ next_cutoff: null }))} />);
    expect(screen.getByText('Cancelling now gives no money back.')).toBeTruthy();
  });

  it('no countdown for a player who hasn’t paid', async () => {
    const detail = bookerDetail({ next_cutoff: { kind: 'refunds_stop', at: at(28 * 60) } });
    await render(<BookingDetailView {...props({ ...detail, me: { ...detail.me!, status: 'pending' } })} />);
    expect(screen.queryByText(/Cancel in the next/)).toBeNull();
  });

  it('asks the server for the next cutoff once this one passes', async () => {
    const p = props(playerDetail({ next_cutoff: { kind: 'free_hour_ends', at: at(0) } }));
    await render(<BookingDetailView {...p} />);
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('no countdown on a cancelled booking', async () => {
    const detail = bookerDetail({ next_cutoff: null });
    await render(<BookingDetailView {...props({ ...detail, booking: { ...detail.booking, status: 'cancelled' } })} />);
    expect(screen.queryByText(/money back/)).toBeNull();
    expect(screen.getByText('This booking was cancelled.')).toBeTruthy();
  });
});

describe('BookingDetailView: paying a pending booking', () => {
  it('the booker sees the server’s deadline, in Cyprus time', async () => {
    const detail = bookerDetail();
    const pending = {
      ...detail,
      booking: { ...detail.booking, status: 'pending_payment', payment_window_ends_at: '2026-11-16T08:15:00+00:00' },
      me: { ...detail.me!, status: 'pending' },
    };
    await render(<BookingDetailView {...props(pending)} />);
    expect(screen.getByText('Pay by 10:15 or the booking is released.')).toBeTruthy();
  });

  it('not once the booking is confirmed', async () => {
    await render(<BookingDetailView {...props(bookerDetail())} />);
    expect(screen.queryByText(/or the booking is released/)).toBeNull();
  });
});

describe('BookingDetailView: actions', () => {
  it('Add to calendar, Directions and Share call the screen', async () => {
    const p = props(playerDetail());
    await render(<BookingDetailView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add to calendar' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Directions' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Share' }));
    expect(p.onAddToCalendar).toHaveBeenCalledTimes(1);
    expect(p.onDirections).toHaveBeenCalledTimes(1);
    expect(p.onShare).toHaveBeenCalledTimes(1);
  });

  it('says when the game is already in the calendar', async () => {
    await render(<BookingDetailView {...props(playerDetail(), { inCalendar: true })} />);
    expect(screen.getByRole('button', { name: 'Update calendar event' })).toBeTruthy();
  });

  it('invite and Need players are the booker’s only', async () => {
    await render(<BookingDetailView {...props(playerDetail())} />);
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
    expect(screen.queryByText('Squad need panel')).toBeNull();

    await render(<BookingDetailView {...props(bookerDetail())} />);
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(screen.getByText('Squad need panel')).toBeTruthy();
  });

  it('invites by username and says so', async () => {
    const p = props(bookerDetail());
    await render(<BookingDetailView {...p} />);
    await fireEvent.changeText(screen.getByLabelText('Username'), ' maria ');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Invite' }));
    });
    expect(p.onInvite).toHaveBeenCalledWith('maria');
    expect(await screen.findByText("Invite sent to maria. They'll show up here once they accept.")).toBeTruthy();
  });

  it('an invite error shows on the field', async () => {
    const p = props(bookerDetail(), { onInvite: jest.fn(async () => 'No player with that username.') });
    await render(<BookingDetailView {...p} />);
    await fireEvent.changeText(screen.getByLabelText('Username'), 'nobody');
    await fireEvent.press(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByText('No player with that username.')).toBeTruthy();
  });

  it('an unpaid spot offers Pay my share with the server’s amount', async () => {
    const detail = playerDetail();
    const p = props({ ...detail, me: { ...detail.me!, status: 'pending', payment_method: 'card', amount_cents: 580, cash_cents: 0 } });
    await render(<BookingDetailView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pay my share: €5.80' }));
    expect(p.onPayShare).toHaveBeenCalledTimes(1);
  });
});

describe('BookingDetailView: Gipedo Pano (P8)', () => {
  const gipedo = {
    team: { id: 't1', name: 'Lions' },
    opponent: { state: 'offered' as const, team: { id: 't2', name: 'Tigers' } },
    my_side: 'b' as const,
    pull_out: null,
    choice_due: false,
    choice: null,
    play_normal_cents: 6550,
    settlement: null,
  };

  it('the opponent captain holds their card from here, and sees where the game stands', async () => {
    const detail = playerDetail({ gipedo, me: { ...playerDetail().me!, status: 'pending', amount_cents: 6550 } });
    const p = props(detail);
    await render(<BookingDetailView {...p} />);
    expect(screen.getByText('Tigers offered to play. Waiting for their card to be held.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Hold my card: €65.50' }));
    expect(p.onPayShare).toHaveBeenCalled();
  });

  it('a captain pulls out through the panel, with the fee per player from the pull-out quote', async () => {
    const detail = bookerDetail({
      gipedo: {
        ...gipedo,
        my_side: 'a',
        opponent: { state: 'held', team: { id: 't2', name: 'Tigers' } },
        pull_out: { kind: 'fee', cents: 1200, fee_per_player_cents: 120 },
      },
      can_cancel: { my_spot: false, whole_team: false },
    });
    const onGipedoPullOut = jest.fn(async () => null);
    await render(<BookingDetailView {...props(detail, { onGipedoPullOut })} />);
    expect(screen.queryByRole('button', { name: 'Cancel whole team' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Pull out' }));
    expect(screen.getByText('€12.00 is taken from your hold (€1.20 per player) and the rest is released.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: pull out' }));
    expect(onGipedoPullOut).toHaveBeenCalledTimes(1);
  });

  it('no Gipedo panel on an ordinary booking', async () => {
    await render(<BookingDetailView {...props(playerDetail())} />);
    expect(screen.queryByText('Gipedo Pano')).toBeNull();
  });
});

describe('BookingDetailView: switching 5 v 5 / 6 v 6 (P12)', () => {
  it('the booker who can switch sees it; a player never does', async () => {
    const onSwitch = jest.fn(async () => null);
    await render(<BookingDetailView {...props(bookerDetail({ switch: switchInfo() }), { onSwitch })} />);
    expect(screen.getByRole('button', { name: 'Switch to 5 v 5' })).toBeTruthy();

    await render(<BookingDetailView {...props(playerDetail({ switch: switchInfo({ can_switch: false, refusal: 'not_booker' }) }), { onSwitch })} />);
    expect(screen.queryByRole('button', { name: 'Switch to 5 v 5' })).toBeNull();
  });

  it('two taps switch it, with the side the server offered', async () => {
    const onSwitch = jest.fn(async () => null);
    await render(<BookingDetailView {...props(bookerDetail({ switch: switchInfo() }), { onSwitch })} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Switch to 5 v 5' }));
    expect(onSwitch).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm: switch to 5 v 5' }));
    expect(onSwitch).toHaveBeenCalledWith(5);
  });
});

describe('BookingDetailView: weather (P11)', () => {
  it('shows the weather strip for a game still to come', async () => {
    await render(<BookingDetailView {...props(playerDetail(), { weather: <Text>Forecast here</Text> })} />);
    expect(within(screen.getByTestId('booking-weather')).getByText('Forecast here')).toBeTruthy();
  });

  it('not for a cancelled game', async () => {
    const detail = playerDetail();
    const cancelled = { ...detail, booking: { ...detail.booking, status: 'cancelled' } };
    await render(<BookingDetailView {...props(cancelled, { weather: <Text>Forecast here</Text> })} />);
    expect(screen.queryByTestId('booking-weather')).toBeNull();
  });

  it('not once the game has started', async () => {
    await render(
      <BookingDetailView {...props(playerDetail(), { weather: <Text>Forecast here</Text>, now: new Date('2026-11-16T17:30:00Z') })} />,
    );
    expect(screen.queryByTestId('booking-weather')).toBeNull();
  });
});

describe('BookingDetailView: check-in (P6 check-in QR)', () => {
  it('shows the check-in panel, also once the game has started', async () => {
    await render(
      <BookingDetailView {...props(playerDetail(), { checkIn: <Text>Check-in here</Text>, now: new Date('2026-11-16T17:30:00Z') })} />,
    );
    expect(within(screen.getByTestId('booking-check-in')).getByText('Check-in here')).toBeTruthy();
  });

  it('not for a cancelled game', async () => {
    const detail = playerDetail();
    const cancelled = { ...detail, booking: { ...detail.booking, status: 'cancelled' } };
    await render(<BookingDetailView {...props(cancelled, { checkIn: <Text>Check-in here</Text> })} />);
    expect(screen.queryByTestId('booking-check-in')).toBeNull();
  });
});

describe("BookingDetailView: a venue that isn't taking new players (P7)", () => {
  it('not live (from the server): one line instead of Invite a player', async () => {
    await render(<BookingDetailView {...props(bookerDetail({ venueTakingPlayers: false }))} />);
    expect(screen.getByText("This venue isn't taking new players on Futty right now.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull();
    expect(screen.queryByText('Invite a player')).toBeNull();
    expect(screen.queryByText('Squad need panel')).toBeNull();
  });

  it('live: the invite is there, and no line', async () => {
    await render(<BookingDetailView {...props(bookerDetail({ venueTakingPlayers: true }))} />);
    expect(screen.getByText('Invite a player')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(screen.queryByText("This venue isn't taking new players on Futty right now.")).toBeNull();
  });

  it("not known: the invite stays (the server still decides)", async () => {
    await render(<BookingDetailView {...props(bookerDetail({ venueTakingPlayers: null }))} />);
    expect(screen.getByText('Invite a player')).toBeTruthy();
  });
});

// P6e: the venue offers a player (spec 13 "Venue-offered players"). The
// booker answers from a banner; an accepted venue player is in the roster,
// tagged and with no amount; only the booker can remove him.
describe('BookingDetailView: venue players', () => {
  const offered = { id: 'o1', name: 'Kostas', state: 'offered' as const, can_answer: true, can_remove: false };
  const accepted = { id: 'o2', name: 'Loizos', state: 'accepted' as const, can_answer: false, can_remove: true };

  it('the booker sees the offer by name and accepts it with its id', async () => {
    const p = props(bookerDetail({ venue_players: [offered] }), { onAnswerVenuePlayer: jest.fn(async () => null) });
    await render(<BookingDetailView {...p} />);
    expect(screen.getByText('The venue offered a player: Kostas')).toBeTruthy();
    expect(screen.getByText("Kostas plays free; the team's amounts don't change.")).toBeTruthy();
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Accept Kostas' })));
    expect(p.onAnswerVenuePlayer).toHaveBeenCalledWith('o1', true);
  });

  it('the booker can decline it', async () => {
    const p = props(bookerDetail({ venue_players: [offered] }), { onAnswerVenuePlayer: jest.fn(async () => null) });
    await render(<BookingDetailView {...p} />);
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Decline Kostas' })));
    expect(p.onAnswerVenuePlayer).toHaveBeenCalledWith('o1', false);
  });

  it('shows a refusal under the offer', async () => {
    const p = props(bookerDetail({ venue_players: [offered] }), {
      onAnswerVenuePlayer: jest.fn(async () => 'Every spot is taken now, so there’s no room for a venue player.'),
    });
    await render(<BookingDetailView {...p} />);
    await act(() => fireEvent.press(screen.getByRole('button', { name: 'Accept Kostas' })));
    expect(screen.getByText('Every spot is taken now, so there’s no room for a venue player.')).toBeTruthy();
  });

  it('an accepted venue player is in the roster, tagged, with no amount, and takes a spot', async () => {
    const p = props(bookerDetail({ venue_players: [accepted] }), { onRemoveVenuePlayer: jest.fn(async () => null) });
    await render(<BookingDetailView {...p} />);
    const row = screen.getByTestId('venue-player-o2');
    expect(row).toHaveTextContent(/Loizos.*Venue player · Plays free/);
    expect(row).not.toHaveTextContent(/€/);
    expect(screen.getByText('5 of 12 spots taken')).toBeTruthy();
    await act(() => fireEvent.press(within(row).getByRole('button', { name: 'Remove Loizos' })));
    expect(p.onRemoveVenuePlayer).toHaveBeenCalledWith('o2');
  });

  it('another player sees the accepted venue player only: no offer, no Remove', async () => {
    const p = props(playerDetail({ venue_players: [{ name: 'Loizos', state: 'accepted' }] }));
    await render(<BookingDetailView {...p} />);
    expect(screen.getByText('Loizos')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove Loizos' })).toBeNull();
    expect(screen.queryByText(/The venue offered a player/)).toBeNull();
  });

  it('no venue players: nothing extra', async () => {
    await render(<BookingDetailView {...props(bookerDetail())} />);
    expect(screen.queryByText(/venue offered/i)).toBeNull();
    expect(screen.getByText('4 of 12 spots taken')).toBeTruthy();
  });

  it('never calls the player "he": every line uses his name', async () => {
    await render(<BookingDetailView {...props(bookerDetail({ venue_players: [offered, accepted] }))} />);
    expect(screen.queryByText(/\bhe\b/i)).toBeNull();
  });
});

describe('BookingDetailView: testIDs for the Maestro tests (.maestro)', () => {
  it('names the booking status, the cancel buttons, the quote lines and the confirm', async () => {
    const p = props(bookerDetail());
    await render(<BookingDetailView {...p} />);
    expect(screen.getByTestId(`booking-detail-status-${bookerDetail().booking.status}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('booking-detail-cancel-whole-team'));
    expect(await screen.findByTestId('cancel-quote-line-0')).toBeTruthy();
    expect(within(screen.getByTestId('cancel-quote')).getByText(/costs €6\.00/)).toBeTruthy();
    expect(screen.getByTestId('cancel-keep')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('cancel-confirm'));
    expect(p.onConfirmCancel).toHaveBeenCalledWith({ scope: 'whole_team', quote: 'q2' });
  });

  it('names my-spot cancel, the notice and the cancelled message', async () => {
    await render(<BookingDetailView {...props(playerDetail(), { notice: 'Your spot is cancelled.' })} />);
    expect(screen.getByTestId('booking-detail-cancel-my-spot')).toBeTruthy();
    expect(within(screen.getByTestId('booking-detail-notice')).getByText('Your spot is cancelled.')).toBeTruthy();
    const detail = bookerDetail();
    await render(<BookingDetailView {...props({ ...detail, booking: { ...detail.booking, status: 'cancelled' } })} />);
    expect(screen.getByTestId('booking-detail-cancelled')).toBeTruthy();
    // No pill for a cancelled booking, so no status wrapper either.
    expect(screen.queryByTestId('booking-detail-status-cancelled')).toBeNull();
  });

  it('names a refused cancellation', async () => {
    const p = props(playerDetail(), { onConfirmCancel: jest.fn(async () => ({ status: 'error' as const, message: 'Too late.' })) });
    await render(<BookingDetailView {...p} />);
    await fireEvent.press(screen.getByTestId('booking-detail-cancel-my-spot'));
    await fireEvent.press(await screen.findByTestId('cancel-confirm'));
    expect(within(await screen.findByTestId('cancel-error')).getByText('Too late.')).toBeTruthy();
  });
});
