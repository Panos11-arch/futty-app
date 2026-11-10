import './mocks';

import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { FlatList, ScrollView, SectionList, Text } from 'react-native';

// Every hook the real Play content calls, loaded and empty.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/use-my-teams', () => ({ useMyTeams: () => ({ status: 'ready', teams: [], reload: jest.fn() }) }));
jest.mock('@/lib/use-leagues', () => ({ useLeagues: () => ({ status: 'ready', leagues: [], reload: jest.fn() }) }));
jest.mock('@/lib/use-fixtures', () => ({
  useMyFixtures: () => ({ status: 'ready', fixtures: [], reload: jest.fn() }),
  useMyCaptainTeamIds: () => new Set<string>(),
}));
jest.mock('@/lib/use-my-bookings', () => ({
  useMyUnscoredBookings: () => ({ status: 'ready', bookings: [], reload: jest.fn() }),
}));
jest.mock('@/lib/use-venues', () => ({ useVenues: () => ({ status: 'ready', venues: [], cities: [], reload: jest.fn() }) }));
jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ status: 'loading', reload: jest.fn() }) }));
jest.mock('@/lib/use-contacts', () => ({
  useContacts: () => ({ status: 'ready', matched: [], unmatched: [], load: jest.fn() }),
}));
jest.mock('@/lib/use-follows', () => ({
  useFollows: () => ({ status: 'ready', isFollowing: () => false, toggle: jest.fn(), reload: jest.fn() }),
}));
jest.mock('@/lib/use-blocks', () => ({
  useBlocks: () => ({ status: 'ready', isBlocked: () => false, toggle: jest.fn(), reload: jest.fn() }),
}));
jest.mock('@/lib/use-league-standings', () => ({
  useLeagueStandings: () => ({ status: 'ready', rows: [], reload: jest.fn() }),
}));
jest.mock('@/lib/community', () => ({ listTeams: () => new Promise(() => {}) }));

const routes = () => ({
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  play: require('@/app/(tabs)/play'),
});

async function settle() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

async function openPlay(url: string) {
  const result = renderRouter(routes(), { initialUrl: url });
  await result;
  await settle();
  return { getSearchParams: result.getSearchParams };
}

async function choose(label: string) {
  await fireEvent.press(screen.getByRole('tab', { name: label }));
  await settle();
}

function selectedTab() {
  return screen.getAllByRole('tab').find((t) => t.props.accessibilityState?.selected)?.props.accessibilityLabel;
}

type Node = { type: unknown; props: Record<string, unknown>; parent: Node | null; children: (Node | string)[] };

// Test Renderer only keeps host elements, so a FlatList or SectionList shows
// up as the native scroll view it renders. React Native's "VirtualizedLists
// should never be nested" warning is about a vertical list inside a vertical
// ScrollView, so the rule checked is: no vertical scroller inside another.
function isVerticalScroller(node: Node) {
  return typeof node.type === 'string' && /ScrollView/.test(node.type) && !node.props.horizontal;
}

/** Vertical scrollers that sit inside another vertical scroller. */
function nestedScrollers(root: Node) {
  let found = 0;
  function walk(node: Node, inside: boolean) {
    const here = isVerticalScroller(node);
    if (here && inside) found += 1;
    for (const child of node.children) if (typeof child !== 'string') walk(child, inside || here);
  }
  walk(root, false);
  return found;
}

describe('Play', () => {
  it('shows the four segments, Teams first by default', async () => {
    await openPlay('/play');
    expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel)).toEqual([
      'Teams',
      'Matches',
      'Leagues',
      'Community',
    ]);
    expect(selectedTab()).toBe('Teams');
    expect(screen.getByText(/not on a team yet/)).toBeTruthy();
  });

  it.each([
    ['teams', 'Teams'],
    ['matches', 'Matches'],
    ['leagues', 'Leagues'],
    ['community', 'Community'],
  ])('?segment=%s selects %s', async (segment, label) => {
    await openPlay(`/play?segment=${segment}`);
    expect(selectedTab()).toBe(label);
    expect(screen.getByTestId(`play-segment-${segment}`)).toBeTruthy();
  });

  it('renders the existing content in each segment', async () => {
    await openPlay('/play?segment=matches');
    expect(screen.getByText('Upcoming fixtures')).toBeTruthy();
    expect(screen.getByText('Previous games')).toBeTruthy();
    expect(screen.getByText(/No upcoming fixtures/)).toBeTruthy();
    await choose('Leagues');
    expect(screen.getByText('Matchmaking')).toBeTruthy();
    await choose('Community');
    expect(screen.getByText('Contacts')).toBeTruthy();
  });

  it('keeps the URL in step when you switch, so a later link to the old segment still applies', async () => {
    const r = await openPlay('/play?segment=leagues');
    await choose('Teams');
    expect(r.getSearchParams().segment).toBe('teams');
    expect(selectedTab()).toBe('Teams');
  });

  it('keeps an opened segment mounted but hidden', async () => {
    await openPlay('/play?segment=teams');
    await choose('Leagues');
    expect(screen.getByTestId('play-segment-teams', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('Play scrolling', () => {
  it('the check catches a list nested in a ScrollView', async () => {
    const { render } = jest.requireActual<typeof import('@testing-library/react-native')>('@testing-library/react-native');
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const view = await render(
      <ScrollView>
        <FlatList data={[1]} renderItem={() => <Text>row</Text>} />
        <SectionList sections={[{ data: [1] }]} renderItem={() => <Text>row</Text>} />
        <ScrollView horizontal />
      </ScrollView>,
    );
    expect(nestedScrollers(view.container as unknown as Node)).toBe(2);
    errors.mockRestore();
  });

  it('has no outer ScrollView: the header is fixed and segments scroll themselves', async () => {
    await openPlay('/play');
    for (const label of ['Matches', 'Leagues', 'Community']) await choose(label);
    for (const segment of ['teams', 'matches', 'leagues', 'community']) {
      const container = screen.getByTestId(`play-segment-${segment}`, { includeHiddenElements: true });
      let node = (container as unknown as Node).parent;
      while (node) {
        expect(isVerticalScroller(node)).toBe(false);
        node = node.parent;
      }
      // ...and each segment does scroll, inside its own container.
      expect(nestedScrollers(container as unknown as Node)).toBe(0);
      expect(JSON.stringify(container.children.map((c) => (typeof c === 'string' ? c : c.type)))).toMatch(/ScrollView/);
    }
  });

  it('never nests a virtualized list in a ScrollView, in any segment', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    await openPlay('/play');
    for (const label of ['Matches', 'Leagues', 'Community']) await choose(label);
    expect(nestedScrollers(screen.container as unknown as Node)).toBe(0);
    expect(errors.mock.calls.flat().join('\n')).not.toMatch(/VirtualizedLists should never be nested/);
    errors.mockRestore();
  });
});

