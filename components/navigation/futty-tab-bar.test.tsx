// S2 (spec 15 section 0.5): the bar fixed at the bottom of every tab: Home,
// Community, the Card button, Rankings, Profile. The selected tab sits in a
// soft green pill, dark ink in light mode and mint in dark mode.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { Modal, View } from 'react-native';

import { FuttyTabBar } from '@/components/navigation/futty-tab-bar';
import { CARD_BUTTON, MIN_TOUCH, TAB_BAR_HEIGHT } from '@/components/ui/foundation';
import { flatStyle, loadWithFile, withTheme } from '@/components/ui/test-utils';
import { darkPalette, lightPalette } from '@/constants/futty-theme';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ status: 'ready', profile: { is_premium: false }, reload: jest.fn() }),
}));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

// The Card button's sheet (S19): the card and its QR.
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('@/lib/player-card', () => ({
  ...jest.requireActual('@/lib/player-card'),
  fetchMyPlayerCard: () =>
    Promise.resolve({
      status: 'ready',
      card: {
        username: 'dimi',
        full_name: 'Dimi Card',
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
        show_qr: true,
      },
    }),
}));

loadWithFile(Image, Modal);

const ROUTES: [name: string, title: string, testID: string | undefined][] = [
  ['index', 'Home', 'tab-home'],
  ['community', 'Community', 'tab-community'],
  ['rankings', 'Rankings', 'tab-rankings'],
  ['profile', 'Profile', 'tab-profile'],
  // Hidden routes: in the navigator, never on the bar.
  ['team', 'Team', undefined],
  ['leagues', 'Leagues', undefined],
  ['play', 'Play', undefined],
];

function props(focused = 0) {
  const routes = ROUTES.map(([name]) => ({ key: `${name}-key`, name, params: undefined }));
  const descriptors = Object.fromEntries(
    ROUTES.map(([name, title, testID]) => [
      `${name}-key`,
      {
        options: {
          title,
          tabBarButtonTestID: testID,
          tabBarAccessibilityLabel: `${title}, tab`,
          // The icon reports the colour it was drawn in, so tests can read it.
          tabBarIcon: ({ color }: { color: string }) => <View testID={`icon-${name}`} accessibilityHint={color} />,
        },
      },
    ]),
  );
  const navigation = {
    emit: jest.fn((_event: { type: string; target: string }) => ({ defaultPrevented: false })),
    navigate: jest.fn(),
  };
  const state = { index: focused, routes, key: 'tabs', routeNames: routes.map((r) => r.name), type: 'tab', stale: false, history: [] };
  return {
    state,
    descriptors,
    navigation,
    insets: { top: 0, right: 0, bottom: 34, left: 0 },
  } as unknown as Parameters<typeof FuttyTabBar>[0] & { navigation: typeof navigation };
}

async function draw(p = props(), appearance: 'light' | 'dark' = 'light', textScale?: number) {
  await render(withTheme(<FuttyTabBar {...p} />, { appearance, ...(textScale ? { textScale } : {}) }));
  return p;
}

const BAR_IDS = ['tab-home', 'tab-community', 'tab-card', 'tab-rankings', 'tab-profile'];

describe('items', () => {
  it('shows Home, Community, the Card button, Rankings and Profile, in that order', async () => {
    await draw();
    // In tree order.
    const ids = screen.getAllByTestId(/^tab-(home|community|card|rankings|profile)$/).map((n) => n.props.testID);
    expect(ids).toEqual(BAR_IDS);
  });

  it('never shows the hidden routes (play, team, leagues) or the old Book tab', async () => {
    await draw();
    for (const label of ['Play', 'Team', 'Leagues', 'Book']) expect(screen.queryByText(label)).toBeNull();
  });

  it('the Card button has no label', async () => {
    await draw();
    expect(screen.queryByText('My card')).toBeNull();
    expect(screen.getByTestId('tab-card')).toBeTruthy();
  });

  it('every tab is at least 44 points and labelled for screen readers', async () => {
    await draw();
    for (const id of ['tab-home', 'tab-community', 'tab-rankings', 'tab-profile']) {
      const item = screen.getByTestId(id);
      expect(item.props.accessibilityLabel).toMatch(/, tab$/);
      expect(flatStyle(item).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH);
    }
  });
});

describe('the selected pill', () => {
  it.each([
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const)('%s: a soft green pill on the selected tab only, in its ink', async (appearance, palette) => {
    await draw(props(1), appearance);
    expect(flatStyle(screen.getByTestId('tab-community-pill')).backgroundColor).toBe(palette.tabSelectedBg);
    expect(flatStyle(screen.getByText('Community')).color).toBe(palette.tabSelectedInk);
    expect(screen.getByTestId('icon-community').props.accessibilityHint).toBe(palette.tabSelectedInk);
    expect(screen.getByTestId('tab-community').props.accessibilityState).toMatchObject({ selected: true });
    for (const other of ['home', 'rankings', 'profile']) {
      expect(flatStyle(screen.getByTestId(`tab-${other}-pill`)).backgroundColor).toBeUndefined();
      expect(screen.getByTestId(`tab-${other}`).props.accessibilityState).toMatchObject({ selected: false });
    }
    expect(flatStyle(screen.getByText('Home')).color).toBe(palette.muted);
  });

  it('is dark ink in light mode and mint in dark mode', () => {
    expect(lightPalette.tabSelectedInk).toBe(lightPalette.greenInk);
    expect(darkPalette.tabSelectedInk).toBe(darkPalette.green);
  });

  it('marks no tab while a hidden route (Play) is showing', async () => {
    await draw(props(6));
    for (const id of ['home', 'community', 'rankings', 'profile']) {
      expect(flatStyle(screen.getByTestId(`tab-${id}-pill`)).backgroundColor).toBeUndefined();
    }
  });
});

describe('tapping', () => {
  it.each([
    ['tab-community', 'community'],
    ['tab-rankings', 'rankings'],
    ['tab-profile', 'profile'],
  ])('%s goes to %s', async (id, name) => {
    const p = await draw(props(0));
    await fireEvent.press(screen.getByTestId(id));
    expect(p.navigation.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'tabPress', target: `${name}-key` }));
    expect(p.navigation.navigate).toHaveBeenCalledWith(name, undefined);
  });

  it('pressing the tab already showing does not navigate again', async () => {
    const p = await draw(props(0));
    await fireEvent.press(screen.getByTestId('tab-home'));
    expect(p.navigation.navigate).not.toHaveBeenCalled();
  });

  it('respects a screen that prevents the tab press', async () => {
    const p = props(0);
    p.navigation.emit.mockReturnValue({ defaultPrevented: true });
    await draw(p);
    await fireEvent.press(screen.getByTestId('tab-profile'));
    expect(p.navigation.navigate).not.toHaveBeenCalled();
  });

  it('the Card button opens the player card (S19); its avatar and name go to Profile', async () => {
    const p = await draw(props(0));
    expect(screen.queryByTestId('my-card-sheet')).toBeNull();
    await fireEvent.press(screen.getByTestId('tab-card'));
    expect(screen.getByTestId('my-card-sheet')).toBeTruthy();
    await fireEvent.press(await screen.findByTestId('my-card-open-profile'));
    expect(p.navigation.navigate).toHaveBeenCalledWith('profile', undefined);
  });
});

describe('fixed and level', () => {
  it('has a fixed height (the row plus the home indicator), in the tab bar tokens', async () => {
    await draw();
    expect(flatStyle(screen.getByTestId('tab-bar'))).toMatchObject({
      backgroundColor: lightPalette.tabBar,
      borderTopColor: lightPalette.tabBarBorder,
      paddingBottom: 34,
    });
    expect(flatStyle(screen.getByTestId('tab-bar-row')).height).toBe(TAB_BAR_HEIGHT);
  });

  it('uses the dark bar tokens in dark mode', async () => {
    await draw(props(), 'dark');
    expect(flatStyle(screen.getByTestId('tab-bar'))).toMatchObject({
      backgroundColor: darkPalette.tabBar,
      borderTopColor: darkPalette.tabBarBorder,
    });
  });

  it('the Card button does not make the bar taller, even with large text', async () => {
    await draw(props(), 'light', 1.3);
    const row = flatStyle(screen.getByTestId('tab-bar-row'));
    expect(row.height).toBe(TAB_BAR_HEIGHT);
    expect(row.alignItems).toBe('stretch');
    expect(CARD_BUTTON).toBeLessThanOrEqual(TAB_BAR_HEIGHT);
  });

  it('centres the Card circle on the same line as the tab items (level, not raised)', async () => {
    await draw();
    // Every item, the Card button included, fills the row's full height and
    // centres its content, so all their centres sit on the row's middle line.
    for (const id of BAR_IDS) {
      const style = flatStyle(screen.getByTestId(id));
      expect(style).toMatchObject({ flex: 1, alignItems: 'center', justifyContent: 'center' });
      expect(style.position).not.toBe('absolute');
      expect(style.top).toBeUndefined();
      expect(style.marginTop ?? 0).toBe(0);
      expect(style.transform).toBeUndefined();
    }
  });

  it('is laid out in the normal flow, never floating over the screen', async () => {
    await draw();
    const bar = flatStyle(screen.getByTestId('tab-bar'));
    expect(bar.position).not.toBe('absolute');
    expect(bar.transform).toBeUndefined();
  });
});
