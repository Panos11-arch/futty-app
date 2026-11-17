import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Modal, Share, StyleSheet } from 'react-native';

import AccountMenuScreen from '@/app/account/index';
import PrivacySettingsScreen from '@/app/account/settings/privacy';
import SecuritySettingsScreen from '@/app/account/settings/security';
import NotificationsScreen, { groupByDay } from '@/app/notifications';
import { DocFAQ } from '@/components/doc-screen';
import { FuttyAiChat } from '@/components/futty-ai-chat';
import { loadWithFile } from '@/components/ui/test-utils';
import { colors } from '@/constants/futty-theme';

loadWithFile(Modal);

let mockNotifications: Record<string, unknown>;
let mockProfile: Record<string, unknown>;
let mockInviteStatuses = new Map<string, string>();
const mockNotificationsReload = jest.fn();
const mockMarkRead = jest.fn();
const mockAccept = jest.fn();
const mockDecline = jest.fn();
const mockSetAppLock = jest.fn();
const mockUpdateProfile = jest.fn();
const mockSignOut = jest.fn();
const mockSendAi = jest.fn();

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-notifications', () => ({
  useNotifications: () => ({ ...mockNotifications, reload: mockNotificationsReload }),
}));
jest.mock('@/lib/notifications', () => ({
  ...jest.requireActual('@/lib/notifications'),
  markNotificationRead: (...args: unknown[]) => mockMarkRead(...args),
}));
jest.mock('@/lib/invites', () => ({
  acceptInvite: (...args: unknown[]) => mockAccept(...args),
  declineInvite: (...args: unknown[]) => mockDecline(...args),
  describeInviteError: (e: { message: string }) => e.message,
  inviteStatuses: () => Promise.resolve(mockInviteStatuses),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' }, signOut: mockSignOut }) }));
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ ...mockProfile, reload: jest.fn() }),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));
jest.mock('@/lib/app-lock', () => ({
  useAppLock: () => ({ supported: true, enabled: false, label: 'Face ID', setEnabled: mockSetAppLock }),
}));
jest.mock('@/lib/futty-ai', () => ({ sendFuttyAiMessage: (...args: unknown[]) => mockSendAi(...args) }));

const note = (id: string, created_at: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'booking_cancelled',
  title: `Title ${id}`,
  body: `Body ${id}`,
  data: {},
  read_at: null,
  created_at,
  ...over,
});

beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2026-11-17T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
});
afterAll(() => jest.useRealTimers());

beforeEach(() => {
  jest.clearAllMocks();
  mockInviteStatuses = new Map();
  mockMarkRead.mockResolvedValue({ error: null });
});

describe('groupByDay', () => {
  it('uses the Cyprus calendar day, whatever the phone’s zone', () => {
    // 22:30 UTC on the 16th is already 00:30 on the 17th in Cyprus.
    const now = new Date('2026-11-17T10:00:00Z');
    const groups = groupByDay(
      [note('a', '2026-11-16T22:30:00Z'), note('b', '2026-11-16T21:30:00Z'), note('c', '2026-11-10T09:00:00Z')],
      now
    );
    expect(groups.map((g) => [g.title, g.items.map((n) => n.id)])).toEqual([
      ['Today', ['a']],
      ['Earlier', ['b', 'c']],
    ]);
  });

  it('leaves out an empty group', () => {
    expect(groupByDay([note('c', '2026-11-10T09:00:00Z')], new Date('2026-11-17T10:00:00Z')).map((g) => g.title)).toEqual([
      'Earlier',
    ]);
  });
});

describe('Notifications', () => {
  it('loading', async () => {
    mockNotifications = { status: 'loading' };
    await render(<NotificationsScreen />);
    expect(screen.getByTestId('notifications-skeleton')).toBeTruthy();
  });

  it('error retries the same load', async () => {
    mockNotifications = { status: 'error', message: 'offline' };
    await render(<NotificationsScreen />);
    mockNotificationsReload.mockClear();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockNotificationsReload).toHaveBeenCalledTimes(1);
  });

  it('empty', async () => {
    mockNotifications = { status: 'ready', notifications: [] };
    await render(<NotificationsScreen />);
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });

  it('rows with an unread dot, grouped Today / Earlier; a tap marks read and opens the same place', async () => {
    mockNotifications = {
      status: 'ready',
      notifications: [
        note('n1', '2026-11-17T09:00:00Z'),
        note('n2', '2026-11-12T09:00:00Z', { read_at: '2026-11-12T10:00:00Z' }),
      ],
    };
    const view = await render(<NotificationsScreen />);
    expect(view.toJSON()).toMatchSnapshot();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Earlier')).toBeTruthy();
    expect(screen.getAllByTestId('notification-unread-dot')).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Unread. Title n1. Body n1' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/my-bookings'));
    expect(mockMarkRead).toHaveBeenCalledWith('n1');
  });

  it.each(['venue_new_booking', 'venue_booking_cancelled', 'venue_short_game', 'venue_daily_summary'])(
    'a %s row opens the venue dashboard, not My Bookings',
    async (type) => {
      mockNotifications = {
        status: 'ready',
        notifications: [note('v1', '2026-11-17T09:00:00Z', { type, data: { venueId: 'venue-1', bookingId: 'b1' } })],
      };
      await render(<NotificationsScreen />);
      await fireEvent.press(screen.getByRole('button', { name: 'Unread. Title v1. Body v1' }));
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/venue-dashboard'));
      expect(router.push).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/my-bookings' }));
      expect(router.push).not.toHaveBeenCalledWith('/my-bookings');
    }
  );

  it.each(['venue_player_offered', 'venue_player_withdrawn'])('a %s row opens the booking', async (type) => {
    mockNotifications = {
      status: 'ready',
      notifications: [note('p1', '2026-11-17T09:00:00Z', { type, data: { venueId: 'venue-1', bookingId: 'b1', offerId: 'o1' } })],
    };
    await render(<NotificationsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Unread. Title p1. Body p1' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/booking/[id]', params: { id: 'b1' } }));
  });

  it.each(['venue_player_accepted', 'venue_player_declined', 'venue_player_removed'])(
    'a %s row opens the venue dashboard',
    async (type) => {
      mockNotifications = {
        status: 'ready',
        notifications: [note('s1', '2026-11-17T09:00:00Z', { type, data: { venueId: 'venue-1', bookingId: 'b1', offerId: 'o1' } })],
      };
      await render(<NotificationsScreen />);
      await fireEvent.press(screen.getByRole('button', { name: 'Unread. Title s1. Body s1' }));
      await waitFor(() => expect(router.push).toHaveBeenCalledWith('/venue-dashboard'));
    }
  );

  it('accepting a game invite answers it and goes on to pay, as before', async () => {
    mockAccept.mockResolvedValue({ error: null });
    mockInviteStatuses = new Map([['inv1', 'pending']]);
    mockNotifications = {
      status: 'ready',
      notifications: [note('n3', '2026-11-17T09:00:00Z', { type: 'booking_invite', data: { inviteId: 'inv1', bookingId: 'b9' } })],
    };
    await render(<NotificationsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith({ pathname: '/booking-payment', params: { bookingId: 'b9' } })
    );
    expect(mockAccept).toHaveBeenCalledWith('inv1');
    expect(mockMarkRead).toHaveBeenCalledWith('n3');
  });
});

describe('Account menu', () => {
  it('grouped rows in sentence case, same targets', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'venue_owner' } };
    const view = await render(<AccountMenuScreen />);
    expect(view.toJSON()).toMatchSnapshot();
    for (const [label, target] of [
      ['Edit profile', '/edit-profile'],
      ['My bookings', '/my-bookings'],
      ['Your activity', '/account/activity'],
      ['Your payments', '/account/payments'],
      ['Venue dashboard', '/venue-dashboard'],
      ['Terms of use', '/account/terms'],
      ['Privacy policy', '/account/privacy-policy'],
    ]) {
      await fireEvent.press(screen.getByRole('button', { name: label }));
      expect(router.push).toHaveBeenLastCalledWith(target);
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('Share profile shares the same message', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'player' } };
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await render(<AccountMenuScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share profile' }));
    expect(share).toHaveBeenCalledWith({ message: 'Play with me on Futty — find me as @ann.' });
  });
});

describe('Privacy settings', () => {
  it('the switch saves the same field', async () => {
    mockUpdateProfile.mockResolvedValue({ error: null });
    mockProfile = { status: 'ready', profile: { id: 'me', show_phone_publicly: false } };
    await render(<PrivacySettingsScreen />);
    await fireEvent(screen.getByLabelText('Show my phone number'), 'valueChange', true);
    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith('me', { show_phone_publicly: true }));
  });
});

describe('Doc FAQ', () => {
  it('opens and closes its answer', async () => {
    await render(<DocFAQ question="How do I book a pitch?">Open the Book tab.</DocFAQ>);
    expect(screen.queryByText('Open the Book tab.')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'How do I book a pitch?' }));
    expect(screen.getByText('Open the Book tab.')).toBeTruthy();
  });
});

describe('Futty AI chat', () => {
  it('same bubbles as the fixture chat, and sends the whole conversation', async () => {
    mockSendAi.mockResolvedValue({ data: { reply: 'Open the Book tab.' }, error: null });
    await render(<FuttyAiChat />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Futty AI' }));
    await fireEvent.changeText(screen.getByLabelText('Message to Futty AI'), ' How do I book? ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Open the Book tab.');
    expect(mockSendAi).toHaveBeenCalledWith([{ role: 'user', content: 'How do I book?' }]);
    expect(StyleSheet.flatten(screen.getByTestId('bubble-mine').props.style).backgroundColor).toBe(colors.brandSoft);
    expect(StyleSheet.flatten(screen.getByTestId('bubble-theirs').props.style).backgroundColor).toBe(colors.surface);
  });

  it('shows the same error when Futty AI can’t be reached', async () => {
    mockSendAi.mockResolvedValue({ data: null, error: { message: 'x' } });
    await render(<FuttyAiChat />);
    await fireEvent.press(screen.getByRole('button', { name: 'Open Futty AI' }));
    await fireEvent.changeText(screen.getByLabelText('Message to Futty AI'), 'hi');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText("Couldn't reach Futty AI — try again in a moment.")).toBeTruthy();
  });
});

describe('Invites and security', () => {
  it('declining a team invite answers it and stays put', async () => {
    mockDecline.mockResolvedValue({ error: null });
    mockInviteStatuses = new Map([['inv2', 'pending']]);
    mockNotifications = {
      status: 'ready',
      notifications: [note('n4', '2026-11-17T09:00:00Z', { type: 'team_invite', data: { inviteId: 'inv2' } })],
    };
    await render(<NotificationsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Decline' }));
    expect(await screen.findByText('Declined')).toBeTruthy();
    expect(mockDecline).toHaveBeenCalledWith('inv2');
    expect(mockAccept).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('the app lock switch calls the same setter', async () => {
    mockSetAppLock.mockResolvedValue(undefined);
    await render(<SecuritySettingsScreen />);
    await fireEvent(screen.getByLabelText('Lock with Face ID'), 'valueChange', true);
    await waitFor(() => expect(mockSetAppLock).toHaveBeenCalledWith(true));
  });
});
