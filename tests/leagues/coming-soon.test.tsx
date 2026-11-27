// S9: Coming soon (image 16) for a league with no season in sign-up or
// running, and for a tournament before its sign-up opens (image 17, S10A).
import './mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import ComingSoonScreen from '@/app/(tabs)/leagues/coming-soon';

const g = globalThis as { mockSearchParams?: Record<string, string> };

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

beforeEach(() => {
  jest.clearAllMocks();
  (router.canGoBack as jest.Mock).mockReturnValue(true);
});

describe('Coming soon', () => {
  it('a league: its name, city and format, the line, and Back to leagues', async () => {
    g.mockSearchParams = { name: 'Limassol 5-a-side League', scope: 'limassol', format: '5-a-side' };
    await render(<ComingSoonScreen />);
    expect(screen.getByText('Limassol 5-a-side League')).toBeTruthy();
    expect(screen.getByText('Limassol · 5-a-side league')).toBeTruthy();
    expect(screen.getByText('L5', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getByText('This league hasn’t started yet. Check back here for sign-up.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('coming-soon-back'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('without a name, names it "<City> <format> League"; island-wide is the Cyprus Open', async () => {
    g.mockSearchParams = { scope: 'island-wide', format: '11-a-side' };
    await render(<ComingSoonScreen />);
    expect(screen.getByText('Cyprus Open 11-a-side League')).toBeTruthy();
    expect(screen.getByText('Island-wide · 11-a-side league')).toBeTruthy();
  });

  it('a tournament says sign-up hasn’t opened (image 17)', async () => {
    g.mockSearchParams = { kind: 'tournament', name: 'Nuevo Campo Cup', scope: 'limassol', format: '5-a-side' };
    await render(<ComingSoonScreen />);
    expect(screen.getByText('Nuevo Campo Cup')).toBeTruthy();
    expect(screen.getByText('Limassol · 5-a-side tournament')).toBeTruthy();
    expect(screen.getByText('Sign-up hasn’t opened yet. Check back here for dates and sign-up.')).toBeTruthy();
    expect(screen.getByText('NC', { includeHiddenElements: true })).toBeTruthy();
  });

  it('a tournament with its size shows "16 teams" (image 17)', async () => {
    g.mockSearchParams = { kind: 'tournament', name: 'Nuevo Campo Cup', scope: 'limassol', format: '5-a-side', teams: '16' };
    await render(<ComingSoonScreen />);
    expect(screen.getByText('Limassol · 5-a-side tournament · 16 teams')).toBeTruthy();
  });

  it('the header back link goes back too; opened first, Back opens the Leagues screen', async () => {
    g.mockSearchParams = { scope: 'nicosia', format: '7-a-side' };
    await render(<ComingSoonScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Back to Leagues' }));
    expect(router.back).toHaveBeenCalledTimes(1);
    (router.canGoBack as jest.Mock).mockReturnValue(false);
    await fireEvent.press(screen.getByTestId('coming-soon-back'));
    expect(router.replace).toHaveBeenCalledWith('/leagues');
  });

  it('labels: the button is 1-3 words', async () => {
    g.mockSearchParams = { scope: 'nicosia', format: '7-a-side' };
    await render(<ComingSoonScreen />);
    expect(screen.getByTestId('coming-soon-back').props.accessibilityLabel.split(' ').length).toBeLessThanOrEqual(3);
  });
});
