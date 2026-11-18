import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { GO_PREMIUM_BADGES, StreakCard, StreakCardView } from '@/components/stats/streak-card';
import { DISABLED_OPACITY } from '@/components/ui/foundation';
import type { MyStreak, StreakBadgeLevel } from '@/lib/stats/streaks';

let mockStreak: unknown;
const mockReload = jest.fn();
const mockPush = jest.fn();
let mockFocusEffects: (() => void)[] = [];

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-svg/css', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { LocalSvg: (props: object) => <View {...props} /> };
});
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (effect: () => void) => {
    mockFocusEffects.push(effect);
  },
}));
jest.mock('@/lib/auth', () => {
  const user = { id: 'me' };
  return { useAuth: () => ({ user }) };
});
jest.mock('@/lib/stats/use-streak', () => ({
  useMyStreak: (...args: unknown[]) => ({ ...(mockStreak as object), reload: mockReload, args }),
}));

const levels = (earned: number): StreakBadgeLevel[] =>
  (
    [
      ['bronze', 'Bronze', 2],
      ['silver', 'Silver', 4],
      ['gold', 'Gold', 8],
      ['platinum', 'Platinum', 12],
      ['diamond', 'Diamond', 20],
      ['champion', 'Champion', 30],
    ] as const
  ).map(([badge, label, weeks], i) => ({
    badge,
    label,
    weeks,
    earned: i < earned,
    awardedAt: i < earned ? '2026-11-16T07:00:00+00:00' : null,
  }));

const streak = (over: Partial<MyStreak>): MyStreak => ({ current: 5, best: 9, isPremium: true, badges: levels(3), ...over });

const ready = (s: MyStreak) => ({ status: 'ready' as const, streak: s });

const view = (s: MyStreak) => render(<StreakCardView state={ready(s)} onRetry={jest.fn()} onGoPremium={mockPush} />);

const opacity = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).opacity;
const art = (badge: string, file: 'colour' | 'greyed') => screen.getByTestId(`streak-badge-art-${badge}-${file}`);

beforeEach(() => {
  mockPush.mockReset();
  mockReload.mockReset();
  mockFocusEffects = [];
});

describe('StreakCardView', () => {
  it('shows the current and best streak in weeks', async () => {
    await view(streak({ current: 1, best: 9 }));
    expect(screen.getByText('Streak')).toBeTruthy();
    expect(screen.getByLabelText('Weeks in a row 1 week')).toBeTruthy();
    expect(screen.getByLabelText('Best 9 weeks')).toBeTruthy();
  });

  it('Premium: earned badges in their coloured art, the rest greyed art faded', async () => {
    await view(streak({ isPremium: true, badges: levels(3) }));
    for (const b of ['bronze', 'silver', 'gold']) expect(art(b, 'colour')).toBeTruthy();
    for (const b of ['platinum', 'diamond', 'champion']) {
      expect(art(b, 'greyed')).toBeTruthy();
      expect(opacity(`streak-badge-${b}-locked`)).toBe(DISABLED_OPACITY);
    }
    expect(screen.getByLabelText('Platinum streak badge, 12 weeks in a row')).toBeTruthy();
    expect(screen.getByLabelText('Champion streak badge, 30 weeks in a row')).toBeTruthy();
    expect(screen.queryByText(GO_PREMIUM_BADGES)).toBeNull();
  });

  it('basic: earned badges greyed, with "Go Premium to unlock streak badges"', async () => {
    await view(streak({ isPremium: false, badges: levels(2) }));
    expect(screen.queryByTestId('streak-badge-bronze-colour')).toBeNull();
    expect(screen.queryByTestId(/^streak-badge-art-.*-colour$/)).toBeNull();
    expect(art('bronze', 'greyed')).toBeTruthy();
    expect(art('silver', 'greyed')).toBeTruthy();
    expect(opacity('streak-badge-bronze-greyed')).toBeUndefined();
    expect(screen.getByLabelText('Bronze streak badge, earned, shown in colour with Premium')).toBeTruthy();
    expect(screen.getByText(GO_PREMIUM_BADGES)).toBeTruthy();
    fireEvent.press(screen.getByText(GO_PREMIUM_BADGES));
    expect(mockPush).toHaveBeenCalled();
  });

  it('greyed differs from not yet earned', async () => {
    await view(streak({ isPremium: false, badges: levels(1) }));
    expect(art('bronze', 'greyed')).toBeTruthy();
    expect(art('silver', 'greyed')).toBeTruthy();
    expect(opacity('streak-badge-bronze-greyed')).toBeUndefined();
    expect(opacity('streak-badge-silver-locked')).toBe(DISABLED_OPACITY);
    expect(screen.getByLabelText('Silver streak badge, 4 weeks in a row')).toBeTruthy();
  });

  it('after Premium ends the badges stay earned but are greyed again', async () => {
    const earned = levels(6);
    const { rerender } = await view(streak({ isPremium: true, badges: earned }));
    for (const b of ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion']) expect(art(b, 'colour')).toBeTruthy();
    await rerender(
      <StreakCardView state={ready(streak({ isPremium: false, badges: earned }))} onRetry={jest.fn()} onGoPremium={mockPush} />,
    );
    for (const b of ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion']) {
      expect(screen.getByTestId(`streak-badge-${b}-greyed`)).toBeTruthy();
      expect(art(b, 'greyed')).toBeTruthy();
    }
    expect(screen.queryByTestId(/^streak-badge-art-.*-colour$/)).toBeNull();
    expect(screen.getByText(GO_PREMIUM_BADGES)).toBeTruthy();
  });

  it('every player sees their streak, Premium or not', async () => {
    await view(streak({ isPremium: false, current: 0, best: 0, badges: levels(0) }));
    expect(screen.getByLabelText('Weeks in a row 0 weeks')).toBeTruthy();
    expect(screen.getAllByTestId(/-locked$/)).toHaveLength(6);
  });

  it('loading and error', async () => {
    const onRetry = jest.fn();
    const { rerender } = await render(
      <StreakCardView state={{ status: 'loading' }} onRetry={onRetry} onGoPremium={mockPush} />,
    );
    expect(screen.getByTestId('streak-card-loading')).toBeTruthy();
    await rerender(<StreakCardView state={{ status: 'error', message: 'x' }} onRetry={onRetry} onGoPremium={mockPush} />);
    fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('StreakCard', () => {
  it('loads the signed-in player’s streak, reloads on focus and opens Premium', async () => {
    mockStreak = ready(streak({ isPremium: false }));
    await render(<StreakCard />);
    mockFocusEffects.forEach((effect) => effect());
    expect(mockReload).toHaveBeenCalled();
    fireEvent.press(screen.getByText(GO_PREMIUM_BADGES));
    expect(mockPush).toHaveBeenCalledWith('/account/premium');
  });
});
