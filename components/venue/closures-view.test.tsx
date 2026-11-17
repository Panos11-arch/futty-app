import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { ClosuresView } from '@/components/venue/closures-view';
import { callsTo, refuse, resetRpc, rpc as mockRpc, writes } from '@/components/venue/setup-test-helpers';
import { venueSetup } from '@/lib/venue-setup.fixtures';

// Closures (P6e; spec 13 "Venue setup"): a range of days closed to new
// bookings. Adding one may tell players in games already booked then, so it
// calls nothing until staff confirm. Removing one only reopens new bookings.

loadWithFile(Modal, ClosuresView);

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: (props: object) => React.createElement(View, props),
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

const WARNING =
  "If any games are already booked then, they stay on and their players will be told you've closed new bookings.";

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
  // 23:30 UTC on 17 November is 01:30 on 18 November in Cyprus (UTC+2).
  jest.setSystemTime(new Date('2026-11-17T23:30:00Z'));
  resetRpc();
});

afterEach(() => jest.useRealTimers());

/** Picks a calendar day in the date picker, as the phone's picker hands it back. */
async function pick(testID: string, year: number, month: number, day: number) {
  await fireEvent(screen.getByTestId(testID), 'onChange', { type: 'set' }, new Date(year, month - 1, day, 12));
}

describe('ClosuresView', () => {
  it('lists closures that have not ended, with their reason', async () => {
    await render(<ClosuresView venueId="v1" />);
    expect(await screen.findByText('Thu 24 Dec 2026 – Sat 26 Dec 2026')).toBeTruthy();
    expect(screen.getByText('Christmas')).toBeTruthy();
  });

  it('says when there are none', async () => {
    resetRpc(venueSetup({ closures: [] }));
    await render(<ClosuresView venueId="v1" />);
    expect(await screen.findByText(/No closures coming up/)).toBeTruthy();
  });

  it('starts on today in Cyprus, not on the phone’s own day', async () => {
    await render(<ClosuresView venueId="v1" />);
    await fireEvent.press(await screen.findByText('Add closure'));
    expect(screen.getByTestId('closure-from')).toHaveTextContent(/Wed 18 Nov 2026/);
    expect(screen.getByTestId('closure-to')).toHaveTextContent(/Wed 18 Nov 2026/);
  });

  it('adding calls nothing until staff confirm, then sends the days and reason', async () => {
    await render(<ClosuresView venueId="v1" />);
    await fireEvent.press(await screen.findByText('Add closure'));
    await fireEvent.press(screen.getByTestId('closure-from'));
    await pick('closure-from-picker', 2026, 12, 31);
    await fireEvent.press(screen.getByTestId('closure-to'));
    await pick('closure-to-picker', 2027, 1, 2);
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'New Year');

    await fireEvent.press(screen.getByTestId('closure-add'));
    expect(await screen.findByText(WARNING)).toBeTruthy();
    expect(writes()).toEqual([]);

    await fireEvent.press(screen.getByText('Yes, add closure'));
    await waitFor(() => expect(callsTo('add_venue_closure')).toHaveLength(1));
    expect(callsTo('add_venue_closure')[0]).toEqual({
      p_venue_id: 'v1',
      p_starts_on: '2026-12-31',
      p_ends_on: '2027-01-02',
      p_reason: 'New Year',
    });
  });

  it('moves the last day up when the first day passes it', async () => {
    await render(<ClosuresView venueId="v1" />);
    await fireEvent.press(await screen.findByText('Add closure'));
    await fireEvent.press(screen.getByTestId('closure-from'));
    await pick('closure-from-picker', 2026, 12, 24);
    expect(screen.getByTestId('closure-to')).toHaveTextContent(/Thu 24 Dec 2026/);
  });

  it("shows the server's refusal in words", async () => {
    refuse('add_venue_closure', 'day_in_past');
    await render(<ClosuresView venueId="v1" />);
    await fireEvent.press(await screen.findByText('Add closure'));
    await fireEvent.press(screen.getByTestId('closure-add'));
    await fireEvent.press(await screen.findByText('Yes, add closure'));
    expect(await screen.findByText('That closure has already ended.')).toBeTruthy();
  });

  it('removes a closure with one tap, sending only its id', async () => {
    await render(<ClosuresView venueId="v1" />);
    await fireEvent.press(await screen.findByLabelText('Remove closure Thu 24 Dec 2026 – Sat 26 Dec 2026'));
    await waitFor(() => expect(callsTo('remove_venue_closure')).toEqual([{ p_closure_id: 'c1' }]));
  });
});
