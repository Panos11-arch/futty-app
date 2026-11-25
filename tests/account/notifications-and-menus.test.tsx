import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Modal, Share } from 'react-native';

import AccountMenuScreen from '@/app/account/index';
import PrivacySettingsScreen from '@/app/account/settings/privacy';
import SecuritySettingsScreen from '@/app/account/settings/security';
import NotificationsScreen, { groupByDay } from '@/app/notifications';
import { DocFAQ } from '@/components/doc-screen';
import HelpScreen from '@/app/account/help';
import { loadWithFile } from '@/components/ui/test-utils';

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
let mockUnread = 0;
jest.mock('@/lib/use-messages', () => ({ useUnreadMessages: () => mockUnread }));
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ ...mockProfile, reload: jest.fn() }),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));
jest.mock('@/lib/app-lock', () => ({
  useAppLock: () => ({ supported: true, enabled: false, label: 'Face ID', setEnabled: mockSetAppLock }),
}));
jest.mock('@/lib/futty-ai', () => ({ FUTTY_AI_HREF: '/futty-ai' }));

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

describe('Account menu (S2: the header menu opens it)', () => {
  it('lists the rows and each goes to its route', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'venue_owner', is_premium: false } };
    await render(<AccountMenuScreen />);
    for (const [testID, label, target] of [
      ['account-my-bookings', 'My bookings', '/my-bookings'],
      ['account-payments', 'Payments', '/account/payments'],
      ['account-messages', 'Messages', '/messages'],
      ['account-saved-searches', 'Saved searches', '/account/saved-searches'],
      ['account-premium', 'Go Premium', '/account/premium'],
      ['account-settings', 'Settings', '/account/settings'],
      ['account-help', 'Help', '/account/help'],
      ['account-venue-dashboard', 'Venue dashboard', '/venue-dashboard'],
      ['tab-play', 'Play', '/play'],
      ['account-leaderboards', 'Leaderboards', '/match/leaderboards'],
      ['account-activity', 'Your activity', '/account/activity'],
      ['account-edit-profile', 'Edit profile', '/edit-profile'],
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
      await fireEvent.press(screen.getByTestId(testID));
      expect(router.push).toHaveBeenLastCalledWith(target);
    }
    await fireEvent.press(screen.getByTestId('account-log-out'));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('shows the spec rows first, in the spec order', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'venue_owner', is_premium: false } };
    await render(<AccountMenuScreen />);
    const ids = screen.getAllByTestId(/^(account-(?!menu)|tab-play)/).map((n) => n.props.testID);
    expect(ids.slice(0, 8)).toEqual([
      'account-my-bookings',
      'account-payments',
      'account-messages',
      'account-saved-searches',
      'account-premium',
      'account-settings',
      'account-help',
      'account-venue-dashboard',
    ]);
  });

  it('shows Venue dashboard to venue staff only', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'player', is_premium: false } };
    await render(<AccountMenuScreen />);
    expect(screen.queryByTestId('account-venue-dashboard')).toBeNull();
    expect(screen.queryByText('Venue dashboard')).toBeNull();
  });

  it('hides Venue dashboard while the profile loads', async () => {
    mockProfile = { status: 'loading' };
    await render(<AccountMenuScreen />);
    expect(screen.queryByTestId('account-venue-dashboard')).toBeNull();
  });

  // S13: Messages, third as in spec 15, with the unread count.
  it('Messages shows the unread count, and none at 0', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'player', is_premium: false } };
    mockUnread = 3;
    await render(<AccountMenuScreen />);
    expect(screen.getByRole('button', { name: 'Messages, 3 unread' })).toBeTruthy();
    expect(screen.getByTestId('account-messages-badge', { includeHiddenElements: true })).toBeTruthy();
    mockUnread = 0;
    await render(<AccountMenuScreen />);
    expect(screen.getByRole('button', { name: 'Messages' })).toBeTruthy();
    expect(screen.queryByTestId('account-messages-badge', { includeHiddenElements: true })).toBeNull();
  });

  it('says Manage Premium to a Premium player (from the server)', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'player', is_premium: true } };
    await render(<AccountMenuScreen />);
    expect(screen.getByRole('button', { name: 'Manage Premium' })).toBeTruthy();
  });

  it('moved Terms, Privacy policy and How Futty works into Help', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'player', is_premium: false } };
    await render(<AccountMenuScreen />);
    for (const label of ['Terms of use', 'Privacy policy', 'How Futty works']) expect(screen.queryByText(label)).toBeNull();
  });

  it('Share profile shares the same message', async () => {
    mockProfile = { status: 'ready', profile: { username: 'ann', role: 'player' } };
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await render(<AccountMenuScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Share profile' }));
    expect(share).toHaveBeenCalledWith({ message: 'Play with me on Futty — find me as @ann.' });
  });
});

describe('Help (S2: Futty AI, How Futty works, Terms and Privacy live here)', () => {
  it.each([
    ['help-how-it-works', 'How Futty works', '/account/how-it-works'],
    ['help-terms', 'Terms of use', '/account/terms'],
    ['help-privacy', 'Privacy policy', '/account/privacy-policy'],
  ])('%s opens %s', async (testID, label, target) => {
    await render(<HelpScreen />);
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
    await fireEvent.press(screen.getByTestId(testID));
    expect(router.push).toHaveBeenLastCalledWith(target);
  });

  it('tells you to book from Home, not the old Book tab', async () => {
    await render(<HelpScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'How do I book a pitch?' }));
    expect(screen.getByText(/Tap Book a pitch on Home/)).toBeTruthy();
    expect(screen.queryByText(/Book tab/)).toBeNull();
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

describe('Futty AI (S13A: opened from Help, on its own screens)', () => {
  it('Ask Futty AI opens my chats', async () => {
    await render(<HelpScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ask Futty AI' }));
    expect(router.push).toHaveBeenLastCalledWith('/futty-ai');
  });

  it('there is no floating Futty AI button any more', async () => {
    await render(<HelpScreen />);
    expect(screen.queryByRole('button', { name: 'Open Futty AI' })).toBeNull();
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
