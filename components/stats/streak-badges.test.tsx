import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { StreakBadges, StreakBadgesView } from '@/components/stats/streak-badges';
import { colors } from '@/constants/futty-theme';
import type { PlayerStreakBadges } from '@/lib/stats/streaks';

let mockState: unknown;
const mockArgs: unknown[][] = [];

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/stats/use-streak', () => ({
  usePlayerStreakBadges: (...args: unknown[]) => {
    mockArgs.push(args);
    return mockState;
  },
}));

const earned: PlayerStreakBadges['badges'] = [
  { badge: 'bronze', label: 'Bronze', weeks: 2, awardedAt: '2026-10-01T07:00:00+00:00' },
  { badge: 'silver', label: 'Silver', weeks: 4, awardedAt: '2026-10-29T07:00:00+00:00' },
];

const background = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).backgroundColor;

describe('StreakBadgesView (another player’s profile)', () => {
  it('a Premium player’s badges in colour', async () => {
    await render(<StreakBadgesView badges={{ inColour: true, badges: earned }} />);
    expect(screen.getByText('Streak badges')).toBeTruthy();
    expect(background('streak-badge-bronze-colour')).toBe(colors.badgeBronze);
    expect(background('streak-badge-silver-colour')).toBe(colors.badgeSilver);
  });

  it('a basic player’s badges greyed, with no upsell on someone else’s profile', async () => {
    await render(<StreakBadgesView badges={{ inColour: false, badges: earned }} />);
    expect(background('streak-badge-bronze-greyed')).toBe(colors.border);
    expect(background('streak-badge-silver-greyed')).toBe(colors.border);
    expect(screen.queryByText(/Go Premium/)).toBeNull();
  });

  it('only earned badges: nothing locked', async () => {
    await render(<StreakBadgesView badges={{ inColour: true, badges: earned }} />);
    expect(screen.queryAllByTestId(/-locked$/)).toHaveLength(0);
    expect(screen.queryByText('Gold')).toBeNull();
  });

  it('nothing at all for a player with no badges', async () => {
    await render(<StreakBadgesView badges={{ inColour: true, badges: [] }} />);
    expect(screen.queryByTestId('player-streak-badges')).toBeNull();
  });
});

describe('StreakBadges', () => {
  it('loads that player’s badges', async () => {
    mockState = { status: 'ready', badges: { inColour: false, badges: earned }, reload: jest.fn() };
    await render(<StreakBadges profileId="p2" />);
    expect(mockArgs).toContainEqual(['p2']);
    expect(screen.getByTestId('streak-badge-bronze-greyed')).toBeTruthy();
  });

  it('shows nothing while loading or after an error', async () => {
    mockState = { status: 'loading', reload: jest.fn() };
    const { rerender } = await render(<StreakBadges profileId="p2" />);
    expect(screen.queryByTestId('player-streak-badges')).toBeNull();
    mockState = { status: 'error', message: 'x', reload: jest.fn() };
    await rerender(<StreakBadges profileId="p2" />);
    expect(screen.queryByTestId('player-streak-badges')).toBeNull();
  });
});
