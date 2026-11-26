import './mocks';

import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Platform, StyleSheet } from 'react-native';

import { navigationRoutes } from './routes';

// S19: the Card button opens the player card, read from the server.
jest.mock('@/lib/player-card', () => ({
  ...jest.requireActual('@/lib/player-card'),
  fetchMyPlayerCard: () =>
    Promise.resolve({
      status: 'ready',
      card: {
        username: 'andreas',
        full_name: 'Andreas',
        avatar_style: 'initials',
        avatar_kit_colour: null,
        avatar_number: null,
        avatar_illustration: null,
        level: null,
        position: null,
        preferred_foot: null,
        favourite_player: null,
        member_since: null,
        teams: [],
        team_count: 0,
        show_qr: false,
      },
    }),
}));

// The first router render loads the whole route tree; under the full suite's
// load it can take longer than Jest's default 5 seconds.
jest.setTimeout(30_000);

// renderRouter doesn't await React Native Testing Library 14's async render,
// and redirects settle on (fake) timers, so let both finish.
async function settle() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

async function open(initialUrl: string) {
  const result = renderRouter(navigationRoutes(), { initialUrl });
  await result;
  await settle();
  // Not the result itself: it's a thenable, and an async function would
  // unwrap it and lose these methods.
  return { getPathname: result.getPathname, getSearchParams: result.getSearchParams };
}

async function press(element: Parameters<typeof fireEvent.press>[0]) {
  await fireEvent.press(element);
  await settle();
}

async function go(action: () => void) {
  await act(async () => action());
  await settle();
}

function tabLabels() {
  return screen
    .getAllByRole('button')
    .map((b) => b.props.accessibilityLabel as string | undefined)
    .filter((label): label is string => !!label && /, tab/.test(label));
}

type Node = { props: Record<string, unknown>; type: unknown; parent: Node | null };

function isInside(node: Node, testID: string) {
  for (let n = node.parent; n; n = n.parent) if (n.props.testID === testID) return true;
  return false;
}

describe('tab bar (S2)', () => {
  it('shows Home, Community, Rankings and Profile as tabs, with the Card button in the middle', async () => {
    await open('/');
    expect(tabLabels().map((l) => l.split(',')[0])).toEqual(['Home', 'Community', 'Rankings', 'Profile']);
    const ids = screen.getAllByTestId(/^tab-(home|community|card|rankings|profile)$/).map((n) => n.props.testID);
    expect(ids).toEqual(['tab-home', 'tab-community', 'tab-card', 'tab-rankings', 'tab-profile']);
  });

  it('Book and Play are no longer tabs', async () => {
    await open('/');
    expect(screen.queryByRole('button', { name: /^Book, tab/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Play, tab/ })).toBeNull();
  });

  // QA 24 November, bug 6: VoiceOver counts only the items on the bar.
  it('each tab reads its place among the 5 items on the bar', async () => {
    await open('/');
    expect(tabLabels()).toEqual(
      Platform.OS === 'ios'
        ? ['Home, tab, 1 of 5', 'Community, tab, 2 of 5', 'Rankings, tab, 4 of 5', 'Profile, tab, 5 of 5']
        : ['Home', 'Community', 'Rankings', 'Profile'],
    );
  });

  it.each([
    ['tab-community', '/community', 'Community screen'],
    ['tab-rankings', '/rankings', 'Rankings screen'],
    ['tab-profile', '/profile', 'Profile screen'],
  ])('%s opens %s', async (id, path, text) => {
    const r = await open('/');
    await press(screen.getByTestId(id));
    expect(r.getPathname()).toBe(path);
    expect(screen.getByText(text)).toBeTruthy();
    await press(screen.getByTestId('tab-home'));
    expect(r.getPathname()).toBe('/');
  });

  it('the Card button opens the player card (S19); its avatar and name go to Profile', async () => {
    const r = await open('/');
    await press(screen.getByTestId('tab-card'));
    expect(screen.getByTestId('my-card-sheet')).toBeTruthy();
    expect(await screen.findByTestId('my-card')).toBeTruthy();
    await press(screen.getByTestId('my-card-open-profile'));
    expect(r.getPathname()).toBe('/profile');
  });

  it('stays fixed at the bottom while a screen scrolls', async () => {
    await open('/');
    const bar = screen.getByTestId('tab-bar') as unknown as Node;
    // The bar is outside the screen's scroller, so scrolling can't move it.
    expect(isInside(bar, 'home-scroll')).toBe(false);
    const before = StyleSheet.flatten(screen.getByTestId('tab-bar').props.style);
    await fireEvent.scroll(screen.getByTestId('home-scroll'), {
      nativeEvent: { contentOffset: { y: 2000 }, contentSize: { height: 3400, width: 375 }, layoutMeasurement: { height: 700, width: 375 } },
    });
    await settle();
    expect(screen.getByTestId('tab-bar')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByTestId('tab-bar').props.style)).toEqual(before);
    expect(before.position).not.toBe('absolute');
  });
});

describe('header (S2)', () => {
  it('shows the Futty wordmark on Home and the tab name elsewhere, fixed above the screen', async () => {
    await open('/');
    expect(screen.getByRole('header', { name: 'Futty' })).toBeTruthy();
    expect(isInside(screen.getByTestId('app-header') as unknown as Node, 'home-scroll')).toBe(false);
    await press(screen.getByTestId('tab-community'));
    expect(screen.getByRole('header', { name: 'Community' })).toBeTruthy();
    await press(screen.getByTestId('tab-rankings'));
    expect(screen.getByRole('header', { name: 'Rankings' })).toBeTruthy();
  });

  it('the bell opens notifications and the menu opens Account', async () => {
    const r = await open('/');
    await press(screen.getByTestId('header-bell'));
    expect(r.getPathname()).toBe('/notifications');
    await go(() => router.back());
    await press(screen.getByTestId('header-menu'));
    expect(r.getPathname()).toBe('/account');
  });
});

describe('nothing from Book or Play becomes unreachable', () => {
  it('Home → Book a pitch (tab-book) opens the booking wizard; closing returns home', async () => {
    const r = await open('/');
    await press(screen.getByTestId('tab-book'));
    expect(screen.getByText('Book wizard')).toBeTruthy();
    await press(screen.getByText('Close wizard'));
    expect(r.getPathname()).toBe('/');
    expect(screen.getByText('Home screen')).toBeTruthy();
  });

  it('a /book link (notifications, saved searches, venue) opens the booking wizard', async () => {
    const r = await open('/book');
    expect(r.getPathname()).toBe('/book');
    expect(screen.getByText('Book wizard')).toBeTruthy();
  });

  it('Account → Play (tab-play) opens Play, with its own header', async () => {
    const r = await open('/');
    await press(screen.getByTestId('header-menu'));
    await press(screen.getByTestId('tab-play'));
    expect(r.getPathname()).toBe('/play');
    expect(screen.getByText('Play segment none team none')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Play' })).toBeTruthy();
  });

  it('/leagues opens the Leagues screen (S9)', async () => {
    const r = await open('/leagues');
    expect(r.getPathname()).toBe('/leagues');
    expect(screen.getByText('Leagues screen')).toBeTruthy();
  });

  it.each([['/team', 'teams']])('%s still opens Play on %s', async (url, segment) => {
    const r = await open(url);
    expect(r.getPathname()).toBe('/play');
    expect(r.getSearchParams().segment).toBe(segment);
    expect(screen.getByText(`Play segment ${segment} team none`)).toBeTruthy();
  });

  it('/community is the Community tab now', async () => {
    const r = await open('/community');
    expect(r.getPathname()).toBe('/community');
    expect(screen.getByText('Community screen')).toBeTruthy();
  });

  it('keeps the team id from the Activity > Teams link', async () => {
    const r = await open('/');
    await go(() => router.push({ pathname: '/(tabs)/team', params: { teamId: 't1' } }));
    expect(r.getPathname()).toBe('/play');
    expect(screen.getByText('Play segment teams team t1')).toBeTruthy();
  });

  it('"Open leagues link" pushed from Home lands on the Leagues screen (S9)', async () => {
    const r = await open('/');
    await press(screen.getByText('Open leagues link'));
    expect(r.getPathname()).toBe('/leagues');
    expect(screen.getByText('Leagues screen')).toBeTruthy();
  });

  it.each([['Open team link', 'teams']])('"%s" pushed from Home lands on %s', async (link, segment) => {
    const r = await open('/');
    await press(screen.getByText(link));
    expect(r.getPathname()).toBe('/play');
    expect(screen.getByText(`Play segment ${segment} team none`)).toBeTruthy();
  });
});
