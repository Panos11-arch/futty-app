import { fireEvent, render, screen } from '@testing-library/react-native';

import { MatchRow } from '@/components/match/match-row';
import { flatStyle } from '@/components/ui/test-utils';
import { colors } from '@/constants/futty-theme';
import {
  mockDisputed,
  mockDraw,
  mockForfeitNoShow,
  mockForfeitPulledOut,
  mockMatchItems,
  mockSideAWon,
  mockSideAWonNotCheckedIn,
  mockSideBWon,
  mockUpcoming,
  mockVoid,
} from '@/lib/match/mock';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

describe('MatchRow', () => {
  it.each(mockMatchItems.map((i) => [i.match.status, i.match.id, i] as const))(
    '%s (%s) shows the score line and when and where, in Cyprus time',
    async (_, __, item) => {
      await render(<MatchRow item={item} />);
      expect(screen.getByTestId('score-line')).toBeTruthy();
      const meta = screen.getByTestId('match-row-meta');
      expect(meta.props.children).toMatch(/^\w{3} \d{1,2} \w{3} · 19:00 · Lakatamia Sports$/);
      expect(flatStyle(meta).fontVariant).toEqual(['tabular-nums']);
    },
  );

  it.each([
    ['a win', mockSideAWon, 'W', colors.success],
    ['a loss', mockSideBWon, 'L', colors.danger],
    ['a draw', mockDraw, 'D', colors.inkMuted],
    ['a forfeit win', mockForfeitPulledOut, 'W', colors.success],
    ['a forfeit loss', mockForfeitNoShow, 'L (forfeit)', colors.danger],
  ] as const)("shows the viewer's result chip for %s", async (_, item, label, color) => {
    await render(<MatchRow item={item} />);
    const chip = screen.getByTestId('match-row-result');
    expect(chip).toBeTruthy();
    expect(flatStyle(screen.getByText(label)).color).toBe(color);
  });

  it('no result chip for a viewer who held a spot but did not check in (1b.2)', async () => {
    await render(<MatchRow item={mockSideAWonNotCheckedIn} />);
    expect(screen.queryByTestId('match-row-result')).toBeNull();
    expect(screen.getByText('3 – 1')).toBeTruthy();
  });

  it.each([
    ['scheduled', mockUpcoming],
    ['disputed', mockDisputed],
    ['void', mockVoid],
  ] as const)('no result chip while %s', async (_, item) => {
    await render(<MatchRow item={item} />);
    expect(screen.queryByTestId('match-row-result')).toBeNull();
  });

  it('opens the match when pressed, with a full spoken label and a 44 point target', async () => {
    const onPress = jest.fn();
    await render(<MatchRow item={mockSideAWon} onPress={onPress} />);
    const row = screen.getByRole('button', {
      name: 'Home FC 3, Away FC 1. Sat 7 Nov · 19:00, Lakatamia Sports. You won',
    });
    expect(flatStyle(row).minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.getByTestId('icon-chevron.right')).toBeTruthy();
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('without onPress: no button role, no chevron, but still one spoken summary', async () => {
    await render(<MatchRow item={mockSideAWon} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('icon-chevron.right')).toBeNull();
    const row = screen.getByTestId('match-row');
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(
      screen.getByLabelText('Home FC 3, Away FC 1. Sat 7 Nov · 19:00, Lakatamia Sports. You won'),
    ).toBe(row);
  });

  it('without onPress, a disputed match says why it has no score and gives no result', async () => {
    await render(<MatchRow item={mockDisputed} />);
    expect(
      screen.getByLabelText('Home FC v Away FC. Disputed · not in stats. Sun 1 Nov · 19:00, Lakatamia Sports'),
    ).toBeTruthy();
  });

  it('with onPress, the row itself is not a second accessible element', async () => {
    await render(<MatchRow item={mockSideAWon} onPress={jest.fn()} />);
    expect(screen.getByTestId('match-row').props.accessible).toBe(false);
    expect(screen.getByTestId('match-row').props.accessibilityLabel).toBeUndefined();
  });

  it('shows a skeleton in the shape of the row while loading', async () => {
    await render(<MatchRow loading />);
    expect(screen.getByTestId('match-row-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('score-line')).toBeNull();
  });
});
