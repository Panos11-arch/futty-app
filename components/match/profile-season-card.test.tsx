import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProfileSeasonCard } from '@/components/match/profile-season-card';
import type { ProfileSeason } from '@/lib/match/profile-summary-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const season: ProfileSeason = {
  formats: ['5-a-side', '7-a-side'],
  games: 24,
  wins: 14,
  goals: 19,
  assists: 11,
  motm: 4,
  avgRating: 7.3,
  totw: 3,
};

describe('ProfileSeasonCard', () => {
  it('shows the seven tiles in image 19 order', async () => {
    await render(
      <ProfileSeasonCard state={{ status: 'ready', season }} format={null} formats={season.formats} onFormat={jest.fn()} onRetry={jest.fn()} />,
    );
    expect(screen.getByText('This season')).toBeTruthy();
    expect(screen.getByTestId('profile-season-tile-games')).toHaveTextContent('24Games');
    expect(screen.getByTestId('profile-season-tile-rating')).toHaveTextContent('7.3Avg rating');
    expect(screen.getByTestId('profile-season-tile-totw')).toHaveTextContent('3TOTW');
    expect(screen.queryByText('Showed up')).toBeNull();
    expect(screen.getByTestId('profile-season-format')).toHaveTextContent('All formats');
  });

  it('picks a format from the sheet, and back to all', async () => {
    const onFormat = jest.fn();
    const { rerender } = await render(
      <ProfileSeasonCard state={{ status: 'ready', season }} format={null} formats={season.formats} onFormat={onFormat} onRetry={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('profile-season-format'));
    await fireEvent.press(screen.getByTestId('profile-season-format-7-a-side'));
    expect(onFormat).toHaveBeenCalledWith('7-a-side');

    await rerender(
      <ProfileSeasonCard state={{ status: 'ready', season }} format="7-a-side" formats={season.formats} onFormat={onFormat} onRetry={jest.fn()} />,
    );
    expect(screen.getByTestId('profile-season-format')).toHaveTextContent('7-a-side');
    await fireEvent.press(screen.getByTestId('profile-season-format'));
    await fireEvent.press(screen.getByTestId('profile-season-format-all'));
    expect(onFormat).toHaveBeenLastCalledWith(null);
  });

  it('no formats played: no picker, zero tiles and a dash for the rating', async () => {
    const empty = { ...season, formats: [], games: 0, wins: 0, goals: 0, assists: 0, motm: 0, avgRating: null, totw: 0 };
    await render(
      <ProfileSeasonCard state={{ status: 'ready', season: empty }} format={null} formats={[]} onFormat={jest.fn()} onRetry={jest.fn()} />,
    );
    expect(screen.queryByTestId('profile-season-format')).toBeNull();
    expect(screen.getByTestId('profile-season-tile-rating')).toHaveTextContent('–Avg rating');
  });

  it('loading shows skeletons; an error offers Try again', async () => {
    const onRetry = jest.fn();
    await render(<ProfileSeasonCard state={{ status: 'loading' }} format={null} formats={[]} onFormat={jest.fn()} onRetry={onRetry} />);
    expect(screen.getByTestId('profile-season-skeleton')).toBeTruthy();
    await render(
      <ProfileSeasonCard state={{ status: 'error', message: 'x' }} format={null} formats={[]} onFormat={jest.fn()} onRetry={onRetry} />,
    );
    expect(screen.getByText('This season couldn’t load.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
