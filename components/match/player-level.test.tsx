import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { PlayerLevelView } from '@/components/match/player-level';
import type { PlayerLevel } from '@/lib/match/levels';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);

const level = (over: Partial<PlayerLevel> = {}): PlayerLevel => ({
  level: 3.45,
  provisional: true,
  reliabilityPct: 15,
  competitiveMatches: 3,
  source: 'questionnaire',
  ...over,
});

const ready = (l: PlayerLevel | null) => ({ status: 'ready' as const, level: l });

beforeEach(() => (router.push as jest.Mock).mockReset());

describe('PlayerLevelView', () => {
  it('shows the level with one decimal, the provisional tag and the reliability', async () => {
    await render(<PlayerLevelView state={ready(level())} onRetry={jest.fn()} />);
    expect(screen.getByTestId('player-level-value')).toHaveTextContent('3.5');
    expect(screen.getByText('Provisional')).toBeTruthy();
    expect(screen.getByText('Reliability 15%')).toBeTruthy();
  });

  it('no provisional tag once settled', async () => {
    await render(<PlayerLevelView state={ready(level({ level: 4, provisional: false, reliabilityPct: 30 }))} onRetry={jest.fn()} />);
    expect(screen.getByTestId('player-level-value')).toHaveTextContent('4.0');
    expect(screen.queryByText('Provisional')).toBeNull();
  });

  it('no row: "No level yet"', async () => {
    await render(<PlayerLevelView state={ready(null)} onRetry={jest.fn()} />);
    expect(screen.getByText('No level yet')).toBeTruthy();
    expect(screen.queryByTestId('set-starting-level')).toBeNull();
  });

  it('own profile with no questionnaire level: offers the questions', async () => {
    await render(<PlayerLevelView state={ready(null)} onRetry={jest.fn()} own />);
    await fireEvent.press(screen.getByTestId('set-starting-level'));
    expect(router.push).toHaveBeenCalledWith('/starting-level');
  });

  it('own profile, already answered: no offer', async () => {
    await render(<PlayerLevelView state={ready(level())} onRetry={jest.fn()} own />);
    expect(screen.queryByTestId('set-starting-level')).toBeNull();
  });

  it('skeleton while loading, an inline error with retry', async () => {
    const onRetry = jest.fn();
    const view = await render(<PlayerLevelView state={{ status: 'loading' }} onRetry={onRetry} />);
    expect(screen.getByTestId('player-level-skeleton')).toBeTruthy();
    await view.rerender(<PlayerLevelView state={{ status: 'error', message: 'x' }} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('never shows XP or a tier', async () => {
    await render(<PlayerLevelView state={ready(level())} onRetry={jest.fn()} own />);
    expect(screen.queryByText(/XP|tier/)).toBeNull();
  });
});
