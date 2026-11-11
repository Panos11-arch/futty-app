import './mocks';

import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { navigationRoutes } from './routes';

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

function tabNames() {
  return screen
    .getAllByRole('button')
    .map((b) => b.props.accessibilityLabel as string | undefined)
    .filter((label): label is string => !!label && /, tab/.test(label))
    .map((label) => label.split(',')[0]);
}

describe('tab bar', () => {
  it('shows exactly Home, Book, Play and Profile, in that order', async () => {
    await open('/');
    expect(tabNames()).toEqual(['Home', 'Book', 'Play', 'Profile']);
  });

  it('opens Play from its tab', async () => {
    const r = await open('/');
    await press(screen.getByRole('button', { name: /^Play, tab/ }));
    expect(r.getPathname()).toBe('/play');
  });
});

describe('old routes land on Play with the right segment', () => {
  it.each([
    ['/team', 'teams'],
    ['/leagues', 'leagues'],
    ['/community', 'community'],
  ])('%s opens Play on %s', async (url, segment) => {
    const r = await open(url);
    expect(r.getPathname()).toBe('/play');
    expect(r.getSearchParams().segment).toBe(segment);
    expect(screen.getByText(`Play segment ${segment} team none`)).toBeTruthy();
  });

  it('keeps the team id from the Activity > Teams link', async () => {
    const r = await open('/');
    await go(() => router.push({ pathname: '/(tabs)/team', params: { teamId: 't1' } }));
    expect(r.getPathname()).toBe('/play');
    expect(screen.getByText('Play segment teams team t1')).toBeTruthy();
  });

  it.each([
    ['Open leagues link', 'leagues'],
    ['Open team link', 'teams'],
  ])('"%s" pushed from Home lands on %s', async (link, segment) => {
    const r = await open('/');
    await press(screen.getByText(link));
    expect(r.getPathname()).toBe('/play');
    expect(screen.getByText(`Play segment ${segment} team none`)).toBeTruthy();
  });

  it('switches segment when a second link arrives while Play is open', async () => {
    const r = await open('/leagues');
    expect(screen.getByText('Play segment leagues team none')).toBeTruthy();
    await go(() => router.push('/community'));
    expect(r.getPathname()).toBe('/play');
    expect(screen.getByText('Play segment community team none')).toBeTruthy();
  });
});

describe('Book tab', () => {
  it('opens the booking wizard over the current tab, and closing returns there', async () => {
    const r = await open('/');
    await press(screen.getByRole('button', { name: /^Book, tab/ }));
    expect(screen.getByText('Book wizard')).toBeTruthy();
    await press(screen.getByText('Close wizard'));
    expect(r.getPathname()).toBe('/');
    expect(screen.getByText('Home screen')).toBeTruthy();
  });

  it('a /book link (Home quick action, booking_slot notification) opens the wizard; back returns home', async () => {
    const r = await open('/');
    await press(screen.getByText('Open book link'));
    expect(screen.getByText('Book wizard')).toBeTruthy();
    await press(screen.getByText('Close wizard'));
    expect(r.getPathname()).toBe('/');
    expect(screen.getByText('Home screen')).toBeTruthy();
  });

  it('closing the wizard from Play returns to Play', async () => {
    const r = await open('/');
    await press(screen.getByRole('button', { name: /^Play, tab/ }));
    await press(screen.getByRole('button', { name: /^Book, tab/ }));
    expect(screen.getByText('Book wizard')).toBeTruthy();
    await press(screen.getByText('Close wizard'));
    expect(r.getPathname()).toBe('/play');
  });
});
