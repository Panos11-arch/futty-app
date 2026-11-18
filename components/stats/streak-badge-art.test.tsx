import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { StreakBadgeArt, streakBadgeArtFile, streakBadgeLook } from '@/components/stats/streak-badge-art';
import { DISABLED_OPACITY } from '@/components/ui/foundation';
import type { StreakBadgeKey } from '@/lib/stats/streaks';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

// LocalSvg loads the file at run time; under Jest it is a plain View carrying its testID and size.
jest.mock('react-native-svg/css', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { LocalSvg: (props: object) => <View {...props} /> };
});

const opacity = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).opacity;

const badge = (over: Partial<Parameters<typeof StreakBadgeArt>[0]> = {}) =>
  render(<StreakBadgeArt badge="gold" label="Gold" weeks={8} earned inColour {...over} />);

describe('streakBadgeLook and streakBadgeArtFile', () => {
  it.each([
    [true, true, 'colour', 'colour'],
    [true, false, 'greyed', 'greyed'],
    [false, true, 'locked', 'greyed'],
    [false, false, 'locked', 'greyed'],
  ] as const)('earned %s, in colour %s: %s look, %s file', (earned, inColour, look, file) => {
    expect(streakBadgeLook(earned, inColour)).toBe(look);
    expect(streakBadgeArtFile(look)).toBe(file);
  });
});

describe('StreakBadgeArt', () => {
  it('coloured: earned while Premium uses badge-<name>.svg at full opacity', async () => {
    await badge();
    expect(screen.getByTestId('streak-badge-gold-colour')).toBeTruthy();
    expect(screen.getByTestId('streak-badge-art-gold-colour')).toBeTruthy();
    expect(opacity('streak-badge-gold-colour')).toBeUndefined();
    expect(screen.getByLabelText('Gold streak badge, earned')).toBeTruthy();
    expect(screen.getByText('Gold')).toBeTruthy();
  });

  it('greyed: earned but not Premium uses badge-<name>-greyed.svg at full opacity', async () => {
    await badge({ inColour: false });
    expect(screen.getByTestId('streak-badge-gold-greyed')).toBeTruthy();
    expect(screen.getByTestId('streak-badge-art-gold-greyed')).toBeTruthy();
    expect(screen.queryByTestId('streak-badge-art-gold-colour')).toBeNull();
    expect(opacity('streak-badge-gold-greyed')).toBeUndefined();
    expect(screen.getByLabelText('Gold streak badge, earned, shown in colour with Premium')).toBeTruthy();
  });

  it('unearned: the greyed art faded, weeks in the label only (the art shows them)', async () => {
    await badge({ earned: false });
    expect(screen.getByTestId('streak-badge-art-gold-greyed')).toBeTruthy();
    expect(opacity('streak-badge-gold-locked')).toBe(DISABLED_OPACITY);
    expect(screen.getByLabelText('Gold streak badge, 8 weeks in a row')).toBeTruthy();
    expect(screen.queryByText('8 weeks')).toBeNull();
    expect(screen.getByText('Gold')).toBeTruthy();
  });

  it('draws the art at half its 120 x 140 size', async () => {
    await badge();
    const art = screen.getByTestId('streak-badge-art-gold-colour');
    expect(art.props.width).toBe(60);
    expect(art.props.height).toBe(70);
  });

  it.each(['bronze', 'silver', 'gold', 'platinum', 'diamond', 'champion'] as const)('%s has both files', async (b) => {
    const { rerender } = await badge({ badge: b });
    expect(screen.getByTestId(`streak-badge-art-${b}-colour`)).toBeTruthy();
    await rerender(<StreakBadgeArt badge={b} label="x" weeks={2} earned inColour={false} />);
    expect(screen.getByTestId(`streak-badge-art-${b}-greyed`)).toBeTruthy();
  });

  it('an unknown badge from a newer server shows its name without guessing art', async () => {
    await badge({ badge: 'legend' as StreakBadgeKey, label: 'Legend' });
    expect(screen.getByText('Legend')).toBeTruthy();
    expect(screen.queryByTestId(/^streak-badge-art-/)).toBeNull();
  });
});
