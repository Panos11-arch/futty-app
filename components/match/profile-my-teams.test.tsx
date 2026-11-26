import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ProfileMyTeams } from '@/components/match/profile-my-teams';
import type { MyTeam } from '@/lib/use-my-teams';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const team = (id: string, name: string, role: string, city: string | null): MyTeam =>
  ({ team: { id, name, city }, role }) as MyTeam;

beforeEach(() => (router.push as jest.Mock).mockReset());

describe('ProfileMyTeams', () => {
  it('lists each team with the role and area, and opens the team page', async () => {
    await render(
      <ProfileMyTeams
        state={{ status: 'ready', teams: [team('t1', 'Kato United', 'captain', 'Limassol'), team('t2', 'Sunday Friends', 'player', null)] }}
        onRetry={jest.fn()}
      />,
    );
    expect(screen.getByText('My teams')).toBeTruthy();
    expect(screen.getByText('Captain · Limassol')).toBeTruthy();
    expect(screen.getByText('Player')).toBeTruthy();
    await fireEvent.press(screen.getAllByTestId('profile-team-row')[1]);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/team-profile', params: { teamId: 't2' } });
  });

  it('New team opens the league sign-up', async () => {
    await render(<ProfileMyTeams state={{ status: 'ready', teams: [team('t1', 'Kato', 'captain', null)] }} onRetry={jest.fn()} />);
    await fireEvent.press(screen.getByTestId('profile-new-team'));
    expect(router.push).toHaveBeenCalledWith('/leagues');
  });

  it('no team: one line and one button', async () => {
    await render(<ProfileMyTeams state={{ status: 'ready', teams: [] }} onRetry={jest.fn()} />);
    expect(screen.getByText('No team yet')).toBeTruthy();
    expect(screen.getAllByTestId('profile-new-team')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('profile-new-team'));
    expect(router.push).toHaveBeenCalledWith('/leagues');
  });

  it('loading shows a skeleton; an error offers Try again', async () => {
    const onRetry = jest.fn();
    await render(<ProfileMyTeams state={{ status: 'loading' }} onRetry={onRetry} />);
    expect(screen.getByTestId('profile-teams-skeleton')).toBeTruthy();
    await render(<ProfileMyTeams state={{ status: 'error', message: 'x' }} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
