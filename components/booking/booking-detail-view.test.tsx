import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';

import { BookingDetailView, type BookingDetailViewProps } from '@/components/booking/booking-detail-view';
import { loadWithFile } from '@/components/ui/test-utils';
import { bookerDetail, mySpotQuote, playerDetail, wholeTeamQuote } from '@/lib/booking-detail.fixtures';
import type { BookingDetail } from '@/lib/booking-search';

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

function props(detail: BookingDetail, overrides: Partial<BookingDetailViewProps> = {}): BookingDetailViewProps {
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

  it('a booking made before P4a asks once more, without amounts, and cancels the whole booking', async () => {
    const detail = bookerDetail();
    const p = props({ ...detail, booking: { ...detail.booking, payment_mode: null } });
    await render(<BookingDetailView {...p} />);
    expect(screen.queryByRole('button', { name: 'Cancel my spot' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel whole team' }));
    expect(p.onQuote).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm: cancel the whole team' }));
    expect(p.onConfirmCancel).toHaveBeenCalledWith({ scope: 'whole_team', quote: null });
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

    await render(<BookingDetailView {...props(playerDetail({ next_cutoff: { kind: 'refunds_stop', at: at(28 * 60) } }))} />);
    expect(screen.getByText('Refunds stop in 1 d 4 h')).toBeTruthy();

    await render(<BookingDetailView {...props(playerDetail({ next_cutoff: null }))} />);
    expect(screen.getByText('Refunds have stopped for this game')).toBeTruthy();
  });

  it('asks the server for the next cutoff once this one passes', async () => {
    const p = props(playerDetail({ next_cutoff: { kind: 'free_hour_ends', at: at(0) } }));
    await render(<BookingDetailView {...p} />);
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
  });

  it('no countdown on a cancelled booking', async () => {
    const detail = playerDetail({ next_cutoff: null });
    await render(<BookingDetailView {...props({ ...detail, booking: { ...detail.booking, status: 'cancelled' } })} />);
    expect(screen.queryByText(/Refunds/)).toBeNull();
    expect(screen.getByText('This booking was cancelled.')).toBeTruthy();
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
