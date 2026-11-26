import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AccessibilityInfo, AppState, type AppStateStatus } from 'react-native';

import { HomeBanner } from '@/components/home/home-banner';
import { BANNER_ROTATE_MS } from '@/lib/home-banner';

// The focus effect is captured so a test can leave Home (run its cleanup)
// and come back (run it again).
let mockFocus: { effect: () => void | (() => void); cleanup?: void | (() => void) } | null = null;
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (effect: () => void | (() => void)) =>
      useEffect(() => {
        mockFocus = { effect, cleanup: effect() };
        return () => {
          if (typeof mockFocus?.cleanup === 'function') mockFocus.cleanup();
        };
      }, [effect]),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
let mockPremium = false;
jest.mock('@/lib/use-profile', () => ({
  useProfile: () => ({ status: 'ready', profile: { is_premium: mockPremium } }),
}));
let mockReduceMotion = false;
jest.mock('@/components/ui/foundation', () => ({
  ...jest.requireActual('@/components/ui/foundation'),
  useReduceMotion: () => mockReduceMotion,
}));

let screenReaderListener: ((on: boolean) => void) | null = null;
let appStateListener: ((state: AppStateStatus) => void) | null = null;

function activeDot(): number {
  const dots = screen.getAllByTestId(/^home-banner-dot-/, { includeHiddenElements: true });
  return dots.findIndex((d) => d.props.accessibilityState?.selected);
}

async function renderBanner() {
  await render(<HomeBanner />);
  await act(async () => {
    fireEvent(screen.getByTestId('home-banner-list'), 'layout', { nativeEvent: { layout: { width: 300, height: 80 } } });
  });
}

async function wait(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

/** Lets the timer run for `ms` in one-second steps, rendering between steps
 *  (each move starts the next timer only after its re-render). */
async function waitSteps(ms: number) {
  for (let left = ms; left > 0; left -= 1000) await wait(Math.min(1000, left));
}

describe('Home rotating banner (spec 15 section 0.6)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPremium = false;
    mockReduceMotion = false;
    mockFocus = null;
    jest.mocked(router.push).mockClear();
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((name: string, fn: (on: boolean) => void) => {
      if (name === 'screenReaderChanged') screenReaderListener = fn;
      return { remove: jest.fn() };
    }) as never);
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: AppStateStatus) => void) => {
      appStateListener = fn;
      return { remove: jest.fn() };
    }) as never);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows Team of the Week, Profile, Leagues and Go Premium, starting on the first', async () => {
    await renderBanner();
    expect(screen.getByTestId('home-banner-team-of-the-week')).toBeTruthy();
    expect(screen.getByTestId('home-banner-profile')).toBeTruthy();
    expect(screen.getByTestId('home-banner-leagues')).toBeTruthy();
    expect(screen.getByTestId('home-banner-premium')).toBeTruthy();
    expect(activeDot()).toBe(0);
  });

  it('a Premium player gets no Go Premium slide', async () => {
    mockPremium = true;
    await renderBanner();
    expect(screen.queryByTestId('home-banner-premium')).toBeNull();
    expect(screen.getAllByTestId(/^home-banner-dot-/, { includeHiddenElements: true })).toHaveLength(3);
  });

  it.each([
    ['team-of-the-week', '/match/team-of-the-week'],
    ['profile', '/profile'],
    ['leagues', '/leagues'],
    ['premium', '/account/premium'],
  ])('the %s slide opens its screen', async (id, href) => {
    await renderBanner();
    await fireEvent.press(screen.getByTestId(`home-banner-${id}`));
    expect(router.push).toHaveBeenCalledWith(href);
  });

  it('moves on every 5 seconds and wraps back to the first', async () => {
    await renderBanner();
    await wait(BANNER_ROTATE_MS - 1);
    expect(activeDot()).toBe(0);
    await wait(1);
    expect(activeDot()).toBe(1);
    await waitSteps(BANNER_ROTATE_MS * 3);
    expect(activeDot()).toBe(0);
  });

  it('a swipe shows that slide and gets a full 5 seconds', async () => {
    await renderBanner();
    const list = screen.getByTestId('home-banner-list');
    await wait(BANNER_ROTATE_MS - 1000);
    await act(async () => {
      fireEvent(list, 'scrollBeginDrag');
    });
    // Held by the finger: no move.
    await waitSteps(BANNER_ROTATE_MS * 2);
    expect(activeDot()).toBe(0);
    await act(async () => {
      fireEvent(list, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 600, y: 0 } } });
    });
    expect(activeDot()).toBe(2);
    await wait(BANNER_ROTATE_MS - 1);
    expect(activeDot()).toBe(2);
    await wait(1);
    expect(activeDot()).toBe(3);
  });

  it('never moves with Reduce motion', async () => {
    mockReduceMotion = true;
    await renderBanner();
    await waitSteps(BANNER_ROTATE_MS * 3);
    expect(activeDot()).toBe(0);
  });

  it('stops while Home is off screen, and starts again on return', async () => {
    await renderBanner();
    const focus = mockFocus!;
    await act(async () => {
      if (typeof focus.cleanup === 'function') focus.cleanup();
    });
    await waitSteps(BANNER_ROTATE_MS * 3);
    expect(activeDot()).toBe(0);
    await act(async () => {
      focus.cleanup = focus.effect();
    });
    await wait(BANNER_ROTATE_MS);
    expect(activeDot()).toBe(1);
  });

  it('stops while the app is in the background, and starts again when it is back', async () => {
    await renderBanner();
    await act(async () => appStateListener!('background'));
    await waitSteps(BANNER_ROTATE_MS * 3);
    expect(activeDot()).toBe(0);
    await act(async () => appStateListener!('active'));
    await wait(BANNER_ROTATE_MS);
    expect(activeDot()).toBe(1);
  });

  it('never moves while VoiceOver or TalkBack is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    await renderBanner();
    await waitSteps(BANNER_ROTATE_MS * 3);
    expect(activeDot()).toBe(0);
  });

  it('stops when a screen reader is turned on, and starts again when it is off', async () => {
    await renderBanner();
    await act(async () => screenReaderListener!(true));
    await waitSteps(BANNER_ROTATE_MS * 3);
    expect(activeDot()).toBe(0);
    await act(async () => screenReaderListener!(false));
    await wait(BANNER_ROTATE_MS);
    expect(activeDot()).toBe(1);
  });
});
