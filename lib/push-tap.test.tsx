import { render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { markNotificationRead } from '@/lib/notifications';
import { PushTapHandler, resetHandledPushTaps, routeForPushData } from '@/lib/push-tap';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/notifications', () => ({
  ...jest.requireActual('@/lib/notifications'),
  markNotificationRead: jest.fn(() => Promise.resolve({ error: null })),
}));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

const push = router.push as jest.Mock;
const markRead = markNotificationRead as jest.Mock;
const getLast = Notifications.getLastNotificationResponse as jest.Mock;
const addListener = Notifications.addNotificationResponseReceivedListener as jest.Mock;

function response(data: Record<string, unknown>, identifier = 'n-1', action = Notifications.DEFAULT_ACTION_IDENTIFIER) {
  return { actionIdentifier: action, notification: { request: { identifier, content: { data } } } };
}

/** The listener the handler registered for taps while the app is running. */
function tapWhileRunning(r: ReturnType<typeof response>) {
  const listener = addListener.mock.calls.at(-1)?.[0] as (r: unknown) => void;
  listener(r);
}

beforeEach(() => {
  jest.clearAllMocks();
  getLast.mockReturnValue(null);
  resetHandledPushTaps();
});

describe('routeForPushData', () => {
  it.each([
    ['matchId', { type: 'match_result_submitted', matchId: 'm1' }, { pathname: '/match/[id]', params: { id: 'm1' } }],
    ['bookingId', { type: 'booking_cancelled', bookingId: 'b1' }, { pathname: '/my-bookings', params: { bookingId: 'b1' } }],
    ['postId', { type: 'squad_post', postId: 'p1', postType: 'players' }, { pathname: '/join-squad-post', params: { postId: 'p1' } }],
    ['teamId', { type: 'team_invite', teamId: 't1' }, { pathname: '/play', params: { segment: 'teams', teamId: 't1' } }],
    [
      'a saved search’s freed slot',
      { type: 'saved_search_match', kind: 'slot', venueId: 'v1', day: '2026-11-20', start: '19:00' },
      { pathname: '/book', params: { venueId: 'v1' } },
    ],
    [
      'a saved search’s game asking for players',
      { type: 'saved_search_match', kind: 'squad_post', postId: 'p1', venueId: 'v1' },
      { pathname: '/join-squad-post', params: { postId: 'p1' } },
    ],
  ])('%s opens its screen', (_, data, href) => {
    expect(routeForPushData(data)).toEqual(href);
  });

  // A10 (decision 1j): these open the post-match flow, so players land on it
  // after the game and again when the vote and ratings open.
  it.each(['match_after_game', 'match_result_confirmed', 'motm_vote_open'])('%s opens the post-match flow', (type) => {
    expect(routeForPushData({ type, matchId: 'm1' })).toEqual({ pathname: '/match/after-game', params: { id: 'm1' } });
  });

  it.each(['match_reminder_24h', 'match_reminder_2h', 'match_result_submitted', 'match_result_disputed', 'followed_team_match'])(
    '%s still opens the match',
    (type) => {
      expect(routeForPushData({ type, matchId: 'm1' })).toEqual({ pathname: '/match/[id]', params: { id: 'm1' } });
    }
  );

  it('a post-match type without a match id falls through as before', () => {
    expect(routeForPushData({ type: 'match_after_game' })).toBe('/notifications');
    expect(routeForPushData({ type: 'motm_vote_open', bookingId: 'b1' })).toEqual({
      pathname: '/my-bookings',
      params: { bookingId: 'b1' },
    });
  });

  it('a tapped match_after_game push opens the flow', async () => {
    getLast.mockReturnValue(response({ type: 'match_after_game', matchId: 'm1', notificationId: 'row-9' }));
    await render(<PushTapHandler />);
    expect(push).toHaveBeenCalledWith({ pathname: '/match/after-game', params: { id: 'm1' } });
    expect(markRead).toHaveBeenCalledWith('row-9');
  });

  it('several ids: match, then booking, then post, then team', () => {
    expect(routeForPushData({ matchId: 'm1', bookingId: 'b1', postId: 'p1', teamId: 't1' })).toMatchObject({
      pathname: '/match/[id]',
    });
    // The opposition-matched push carries both.
    expect(routeForPushData({ postId: 'p1', bookingId: 'b1' })).toMatchObject({ pathname: '/my-bookings' });
    expect(routeForPushData({ postId: 'p1', teamId: 't1' })).toMatchObject({ pathname: '/join-squad-post' });
  });

  it.each([
    ['venue_new_booking', { bookingId: 'b1' }],
    ['venue_booking_cancelled', { bookingId: 'b1' }],
    ['venue_short_game', { bookingId: 'b1', joined: 8, players: 10 }],
    ['venue_daily_summary', { day: '2026-11-18' }],
  ])('%s opens the venue dashboard, never My Bookings', (type, extra) => {
    expect(routeForPushData({ type, venueId: 'v1', ...extra })).toBe('/venue-dashboard');
  });

  it('the venue type wins over a match id too', () => {
    expect(routeForPushData({ type: 'venue_new_booking', matchId: 'm1', bookingId: 'b1' })).toBe('/venue-dashboard');
    expect(routeForPushData({ type: 'team_of_the_week', teamOfTheWeekId: 't1', weekStart: '2026-11-09' })).toBe(
      '/match/team-of-the-week',
    );
  });

  it.each([
    ['an unknown type with no ids', { type: 'something_new' }],
    ['empty data', {}],
    ['no data', undefined],
    ['ids that are not strings', { matchId: 42, bookingId: null, postId: '' }],
  ])('%s falls back to the notifications list', (_, data) => {
    expect(routeForPushData(data)).toBe('/notifications');
  });
});

describe('PushTapHandler', () => {
  it('cold start: opens the tapped push, marks it read and clears it', async () => {
    getLast.mockReturnValue(response({ type: 'match_result_submitted', matchId: 'm1', notificationId: 'row-1' }));
    await render(<PushTapHandler />);
    expect(push).toHaveBeenCalledWith({ pathname: '/match/[id]', params: { id: 'm1' } });
    expect(markRead).toHaveBeenCalledWith('row-1');
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  it('a tap while open or in the background goes through the listener', async () => {
    await render(<PushTapHandler />);
    expect(push).not.toHaveBeenCalled();
    tapWhileRunning(response({ postId: 'p1', notificationId: 'row-2' }, 'n-2'));
    expect(push).toHaveBeenCalledWith({ pathname: '/join-squad-post', params: { postId: 'p1' } });
    expect(markRead).toHaveBeenCalledWith('row-2');
  });

  it('an unknown push opens the notifications list', async () => {
    await render(<PushTapHandler />);
    tapWhileRunning(response({ type: 'brand_new_type', notificationId: 'row-3' }, 'n-3'));
    expect(push).toHaveBeenCalledWith('/notifications');
  });

  it('the same push is never opened twice, even after a remount', async () => {
    const r = response({ matchId: 'm1' }, 'same');
    getLast.mockReturnValue(r);
    const first = await render(<PushTapHandler />);
    tapWhileRunning(r);
    await first.unmount();
    await render(<PushTapHandler />);
    expect(push).toHaveBeenCalledTimes(1);
  });

  it('a push without a notification row id still opens, but marks nothing', async () => {
    await render(<PushTapHandler />);
    tapWhileRunning(response({ postId: 'p1' }, 'legacy'));
    expect(push).toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
  });

  it('an action button other than the default tap is ignored', async () => {
    await render(<PushTapHandler />);
    tapWhileRunning(response({ matchId: 'm1' }, 'n-4', 'some-action'));
    expect(push).not.toHaveBeenCalled();
  });

  it('removes its listener on unmount', async () => {
    const remove = jest.fn();
    addListener.mockReturnValueOnce({ remove });
    const view = await render(<PushTapHandler />);
    await view.unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('shows pushes while the app is open: banner and list, no sound or badge', async () => {
    // Set when the module loads; load a fresh copy to see the call after clearAllMocks.
    jest.isolateModules(() => {
      jest.requireActual('@/lib/push-tap');
    });
    const handler = (Notifications.setNotificationHandler as jest.Mock).mock.calls.at(-1)?.[0];
    await expect(handler.handleNotification()).resolves.toEqual({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    });
  });
});

// P6e: venue-offered players. The booker's open their booking; the staff's
// open the venue dashboard, like every venue notice.
describe('routeForPushData: venue players', () => {
  it.each(['venue_player_offered', 'venue_player_withdrawn'])('%s opens the booking itself', (type) => {
    expect(routeForPushData({ type, bookingId: 'b1', offerId: 'o1', venueId: 'v1' })).toEqual({
      pathname: '/booking/[id]',
      params: { id: 'b1' },
    });
  });

  it.each(['venue_player_accepted', 'venue_player_declined', 'venue_player_removed'])(
    '%s opens the venue dashboard',
    (type) => {
      expect(routeForPushData({ type, bookingId: 'b1', offerId: 'o1', venueId: 'v1' })).toBe('/venue-dashboard');
    },
  );
});
