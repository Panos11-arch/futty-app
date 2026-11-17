import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { HoursView } from '@/components/venue/hours-view';
import { callsTo, refuse, resetRpc, rpc as mockRpc, writes } from '@/components/venue/setup-test-helpers';

// Opening hours (P6e; spec 13 "Venue setup"): one tap opens a day, the
// second saves the whole week. Hours that only grow save at once; shorter
// hours or a closed day may put booked games outside them, so nothing is
// sent until staff confirm that players will be told.

loadWithFile(Modal, HoursView);

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const WARNING =
  "If any games are already booked then, they stay on and their players will be told you've closed new bookings.";

const WEEK = [
  { weekday: 1, opens: '08:00', closes: '23:00' },
  { weekday: 2, opens: '08:00', closes: '23:00' },
  { weekday: 3, opens: '08:00', closes: '23:00' },
  { weekday: 4, opens: '08:00', closes: '23:00' },
  { weekday: 5, opens: '08:00', closes: '23:00' },
  { weekday: 6, opens: '09:00', closes: '24:00' },
];

beforeEach(() => resetRpc());

async function openDay(weekday: number) {
  await render(<HoursView venueId="v1" />);
  await fireEvent.press(await screen.findByTestId(`hours-day-${weekday}`));
}

describe('HoursView', () => {
  it("lists every weekday with the server's hours, closed days too", async () => {
    await render(<HoursView venueId="v1" />);
    expect(await screen.findByTestId('hours-day-1')).toHaveTextContent(/Monday.*08:00–23:00/);
    expect(screen.getByTestId('hours-day-6')).toHaveTextContent(/Saturday.*09:00–midnight/);
    expect(screen.getByTestId('hours-day-7')).toHaveTextContent(/Sunday.*Closed/);
    expect(mockRpc).toHaveBeenCalledWith('venue_setup', { p_venue_id: 'v1' });
  });

  it('saves longer hours at once, sending the whole week', async () => {
    await openDay(1);
    await fireEvent.press(screen.getByTestId('closes-24:00'));
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(callsTo('set_venue_hours')).toHaveLength(1));
    expect(callsTo('set_venue_hours')[0]).toEqual({
      p_venue_id: 'v1',
      p_hours: [{ weekday: 1, opens: '08:00', closes: '24:00' }, ...WEEK.slice(1)],
    });
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('opens a closed day without asking', async () => {
    await openDay(7);
    await fireEvent.press(screen.getByRole('tab', { name: 'Open' }));
    await fireEvent.press(screen.getByTestId('opens-10:00'));
    await fireEvent.press(screen.getByTestId('closes-20:00'));
    await fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(callsTo('set_venue_hours')).toHaveLength(1));
    expect(callsTo('set_venue_hours')[0]).toEqual({
      p_venue_id: 'v1',
      p_hours: [...WEEK, { weekday: 7, opens: '10:00', closes: '20:00' }],
    });
  });

  it('closing a day calls nothing until staff confirm players will be told', async () => {
    await openDay(2);
    await fireEvent.press(screen.getByRole('tab', { name: 'Closed' }));
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText(WARNING)).toBeTruthy();
    expect(writes()).toEqual([]);

    await fireEvent.press(screen.getByText('Yes, save hours'));
    await waitFor(() => expect(callsTo('set_venue_hours')).toHaveLength(1));
    expect(callsTo('set_venue_hours')[0]).toEqual({
      p_venue_id: 'v1',
      p_hours: WEEK.filter((d) => d.weekday !== 2),
    });
  });

  it('a later opening asks first too, and Back sends nothing', async () => {
    await openDay(3);
    await fireEvent.press(screen.getByTestId('opens-10:00'));
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText(WARNING)).toBeTruthy();
    await fireEvent.press(screen.getByText('Back'));
    expect(screen.queryByText(WARNING)).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('greys out closing times at or before the opening time', async () => {
    await openDay(1);
    expect(screen.getByTestId('closes-08:00')).toBeDisabled();
    expect(screen.getByTestId('closes-07:30')).toBeDisabled();
    expect(screen.getByTestId('closes-08:30')).toBeEnabled();
  });

  it("shows the server's refusal in words", async () => {
    refuse('set_venue_hours', 'not_venue_staff');
    await openDay(1);
    await fireEvent.press(screen.getByTestId('closes-24:00'));
    await fireEvent.press(screen.getByText('Save'));
    expect(await screen.findByText("You're not staff at this venue.")).toBeTruthy();
  });
});
