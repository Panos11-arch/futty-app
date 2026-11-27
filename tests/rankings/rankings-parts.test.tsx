// S15: the Rankings header (switch, format chips, "how" link) and its two
// sheets, whose lines must stay true to match-record.md decisions 1k and 1m.
import { fireEvent, render, screen } from '@testing-library/react-native';

import { formatChipLabel, RankingsHeader } from '@/components/match/rankings-header';
import { HOW_IT_WORKS, HOW_ITS_PICKED, HowItsPickedSheet, HowItWorksSheet } from '@/components/match/rankings-sheets';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const props = () => ({
  view: 'totw' as const,
  onChangeView: jest.fn(),
  format: '7-a-side' as const,
  onChangeFormat: jest.fn(),
  onPressHow: jest.fn(),
});

describe('RankingsHeader', () => {
  it('the switch, five format chips and the "how" link', async () => {
    const p = props();
    await render(<RankingsHeader {...p} />);
    expect(screen.getByText('Team of the Week')).toBeTruthy();
    expect(screen.getByText('Power ranking')).toBeTruthy();
    for (const chip of ['5-a-side', '6', '7', '9', '11']) expect(screen.getByText(chip)).toBeTruthy();
    expect(screen.getByText('How it’s picked')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('rankings-power'));
    expect(p.onChangeView).toHaveBeenCalledWith('power');
    await fireEvent.press(screen.getByTestId('rankings-format-11'));
    expect(p.onChangeFormat).toHaveBeenCalledWith('11-a-side');
    await fireEvent.press(screen.getByTestId('rankings-how'));
    expect(p.onPressHow).toHaveBeenCalled();
  });

  it('on Power ranking the link is "How it works"', async () => {
    await render(<RankingsHeader {...props()} view="power" />);
    expect(screen.getByLabelText('How it works')).toBeTruthy();
  });

  it('chip labels: the first in full, the rest as a number', () => {
    expect(formatChipLabel('5-a-side')).toBe('5-a-side');
    expect(formatChipLabel('9-a-side')).toBe('9');
  });
});

describe('the "how" sheets', () => {
  it('How it’s picked: Premium only, best rating, goals not positions, no Friendly games (decision 1k)', async () => {
    await render(<HowItsPickedSheet visible onClose={jest.fn()} />);
    expect(HOW_ITS_PICKED).toEqual([
      'Only Futty Premium players can be picked',
      'Best average rating that week',
      'Places come from goals, not positions',
      'Friendly games don’t count',
    ]);
    for (const line of HOW_ITS_PICKED) expect(screen.getByText(line)).toBeTruthy();
  });

  it('How it works: 1000 start, stronger wins earn more, leagues count more, listed after 3, no Friendly games (decision 1m)', async () => {
    await render(<HowItWorksSheet visible onClose={jest.fn()} />);
    expect(HOW_IT_WORKS).toEqual([
      'Everyone starts at 1000',
      'Beating a stronger team earns more',
      'Leagues and tournaments count more than non-league games',
      'A team appears after 3 matches',
      'Friendly games don’t count',
    ]);
    for (const line of HOW_IT_WORKS) expect(screen.getByText(line)).toBeTruthy();
  });

  it('labels only: every line is one line of at most 10 words', () => {
    for (const line of [...HOW_ITS_PICKED, ...HOW_IT_WORKS]) {
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(10);
      expect(line).not.toMatch(/\n|\.$/);
    }
  });
});
