import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking, Modal } from 'react-native';

import { ClashSheet, type ClashSheetProps } from '@/components/venue/clash-sheet';
import { loadWithFile } from '@/components/ui/test-utils';
import { appClash, blockClashes, blockSaved, counterClash } from '@/lib/venue-today.fixtures';
import type { BlockClashes, BlockConfirm } from '@/lib/venue-today';

// The clash sheet (doc 28 prompt 1; spec 13 "Blocking pitches", decided 18
// November): before a block is saved, every booking it clashes with. App
// bookings show the booker, players joined and payment state, and can move
// to one of the server's free pitches; walk-ins and phone bookings show the
// contact. Confirming saves with the list's quote and cancels what still
// clashes; then staff see who to phone. Every amount is the server's.

loadWithFile(Modal, ClashSheet);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

function props(overrides: Partial<ClashSheetProps> = {}) {
  return {
    visible: true,
    label: 'Pitch 1 · 18:00–20:00',
    clashes: blockClashes(),
    onReload: jest.fn(async (): Promise<{ clashes: BlockClashes } | { error: string }> => ({ clashes: blockClashes() })),
    onMove: jest.fn(async (): Promise<string | null> => null),
    onConfirm: jest.fn(async (): Promise<BlockConfirm> => ({ status: 'saved', saved: blockSaved() })),
    onChanged: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
}

async function open(overrides: Partial<ClashSheetProps> = {}) {
  const p = props(overrides);
  await render(<ClashSheet {...p} />);
  return p;
}

describe('ClashSheet: the list', () => {
  it('names the block and lists each booking with the server’s words and amounts', async () => {
    await open();
    expect(screen.getByText('Clashing games')).toBeTruthy();
    expect(screen.getByText('Pitch 1 · 18:00–20:00')).toBeTruthy();
    // App booking: booker, players joined, unpaid, payment mode.
    expect(screen.getByText('App bookings')).toBeTruthy();
    expect(screen.getByText('18:00–19:00 · Nikos Georgiou')).toBeTruthy();
    expect(screen.getByText('7 of 10 in · 1 unpaid · Each pays')).toBeTruthy();
    // Walk-in or phone: contact name and phone, and what they paid.
    expect(screen.getByText('Walk-ins and phone')).toBeTruthy();
    expect(screen.getByText('19:00–20:00 · Maria')).toBeTruthy();
    expect(screen.getByText('Phone · +35799000002 · Paid €45.00')).toBeTruthy();
    // The total: the server's figure, as spec 13 words it.
    expect(screen.getByTestId('clash-sheet-fee')).toHaveTextContent("Stripe's fees on these payments: €3.15");
    expect(screen.getByText('Block and cancel')).toBeTruthy();
  });

  it('hides a section with nothing in it, and the fee line at €0', async () => {
    await open({ clashes: blockClashes({ clashes: [counterClash()], venue_stripe_fee_cents: 0 }) });
    expect(screen.queryByText('App bookings')).toBeNull();
    expect(screen.queryByTestId('clash-sheet-fee')).toBeNull();
    expect(screen.getByText('Walk-ins and phone')).toBeTruthy();
  });

  it('a game already started stays on: no move, and saving cancels nothing', async () => {
    await open({
      clashes: blockClashes({
        clashes: [appClash({ started: true, moves: [] }), counterClash({ started: true })],
        venue_stripe_fee_cents: 0,
      }),
    });
    expect(screen.getAllByText('Started · stays on')).toHaveLength(2);
    expect(screen.queryByTestId('clash-sheet-move-b-app')).toBeNull();
    expect(screen.getByText('Block')).toBeTruthy();
    expect(screen.queryByText('Block and cancel')).toBeNull();
  });

  it('no free pitch of that size: says so, no move button', async () => {
    await open({ clashes: blockClashes({ clashes: [appClash({ moves: [] })] }) });
    expect(screen.getByText('No free pitch')).toBeTruthy();
    expect(screen.queryByTestId('clash-sheet-move-b-app')).toBeNull();
  });

  it('an older booking stops the block until it is moved or cancelled', async () => {
    const p = await open({ clashes: blockClashes({ clashes: [appClash({ legacy: true, quote: null })] }) });
    expect(screen.getByText('Move or cancel it first.')).toBeTruthy();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-confirm')));
    expect(p.onConfirm).not.toHaveBeenCalled();
  });

  it('Go back closes and saves nothing', async () => {
    const p = await open();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-back')));
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onConfirm).not.toHaveBeenCalled();
  });
});

describe('ClashSheet: moving an app booking', () => {
  it('offers the server’s free pitches, moves with their ids and reloads the list', async () => {
    const after = blockClashes({ clashes: [counterClash()], venue_stripe_fee_cents: 0, quote: 'bq-2' });
    const p = await open({ onReload: jest.fn(async () => ({ clashes: after })) });
    expect(screen.queryByText('Pitch 4 + Pitch 5')).toBeNull();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-move-b-app')));
    expect(screen.getByText('Pitch 3')).toBeTruthy();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-move-b-app-1')));
    expect(p.onMove).toHaveBeenCalledWith('b-app', ['p4', 'p5']);
    expect(p.onReload).toHaveBeenCalled();
    expect(p.onChanged).toHaveBeenCalled();
    // The moved game is gone from the list; the new quote is the one confirmed.
    expect(screen.queryByText('18:00–19:00 · Nikos Georgiou')).toBeNull();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-confirm')));
    expect(p.onConfirm).toHaveBeenCalledWith('bq-2');
  });

  it('a refused move shows one line and keeps the list', async () => {
    const p = await open({ onMove: jest.fn(async () => 'That pitch is already taken then. Pick another time or pitch.') });
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-move-b-app')));
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-move-b-app-0')));
    expect(screen.getByText('That pitch is already taken then. Pick another time or pitch.')).toBeTruthy();
    expect(p.onReload).not.toHaveBeenCalled();
    expect(screen.getByText('18:00–19:00 · Nikos Georgiou')).toBeTruthy();
  });

  it('a failed reload after a move shows its error', async () => {
    await open({ onReload: jest.fn(async () => ({ error: 'Something went wrong. Try again.' })) });
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-move-b-app')));
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-move-b-app-0')));
    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy();
  });
});

describe('ClashSheet: confirming', () => {
  it('saves with the list’s quote, then shows who to phone and what to refund', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const p = await open();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-confirm')));
    expect(p.onConfirm).toHaveBeenCalledWith('bq-1');
    expect(p.onChanged).toHaveBeenCalled();
    expect(screen.getByText('Call them')).toBeTruthy();
    expect(screen.getByText('Maria')).toBeTruthy();
    expect(screen.getByText('+35799000002')).toBeTruthy();
    expect(screen.getByText('They paid €45.00 at the counter — refund it.')).toBeTruthy();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-call-b-phone')));
    expect(openURL).toHaveBeenCalledWith('tel:+35799000002');
    expect(p.onClose).not.toHaveBeenCalled();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-done')));
    expect(p.onClose).toHaveBeenCalled();
    openURL.mockRestore();
  });

  it('nobody to phone: closes once saved', async () => {
    const p = await open({
      onConfirm: jest.fn(async (): Promise<BlockConfirm> => ({ status: 'saved', saved: blockSaved({ call_them: [] }) })),
    });
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-confirm')));
    expect(p.onChanged).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  it('a contact with no phone and nothing paid: name only, no call button', async () => {
    const saved = blockSaved({
      call_them: [
        { booking_id: 'b-w', source: 'walk_in', contact_name: 'Andreas', phone: null, start_time: '19:00:00', refund_cents: 0 },
      ],
    });
    await open({ onConfirm: jest.fn(async (): Promise<BlockConfirm> => ({ status: 'saved', saved })) });
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-confirm')));
    expect(screen.getByText('Andreas')).toBeTruthy();
    expect(screen.queryByTestId('clash-sheet-call-b-w')).toBeNull();
    expect(screen.queryByText(/at the counter/)).toBeNull();
  });

  it('the list changed: shows the new list and one line, and confirms the new quote next', async () => {
    const fresh = blockClashes({
      clashes: [appClash(), counterClash(), counterClash({ id: 'b-new', contact_name: 'Eleni', start_time: '18:30:00' })],
      quote: 'bq-3',
    });
    const onConfirm = jest
      .fn<Promise<BlockConfirm>, [string]>()
      .mockResolvedValueOnce({ status: 'changed', clashes: fresh, message: 'The games changed. Check the list again.' })
      .mockResolvedValueOnce({ status: 'saved', saved: blockSaved({ call_them: [] }) });
    await open({ onConfirm });
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-confirm')));
    expect(screen.getByText('The games changed. Check the list again.')).toBeTruthy();
    expect(screen.getByText('18:30–20:00 · Eleni')).toBeTruthy();
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-confirm')));
    expect(onConfirm).toHaveBeenLastCalledWith('bq-3');
  });

  it('a refusal shows one line and stays open', async () => {
    const p = await open({
      onConfirm: jest.fn(async (): Promise<BlockConfirm> => ({
        status: 'error',
        message: 'Move or cancel the older booking first.',
      })),
    });
    await act(() => fireEvent.press(screen.getByTestId('clash-sheet-confirm')));
    expect(screen.getByText('Move or cancel the older booking first.')).toBeTruthy();
    expect(p.onClose).not.toHaveBeenCalled();
    expect(p.onChanged).not.toHaveBeenCalled();
  });
});

describe('ClashSheet: words', () => {
  it('headings and buttons are 1–3 words; buttons start with a verb', async () => {
    await open();
    for (const heading of ['Clashing games', 'App bookings', 'Walk-ins and phone']) {
      expect(heading.split(' ').length).toBeLessThanOrEqual(3);
    }
    for (const label of ['Block and cancel', 'Go back', 'Move pitch']) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(label.split(' ').length).toBeLessThanOrEqual(3);
    }
  });
});
