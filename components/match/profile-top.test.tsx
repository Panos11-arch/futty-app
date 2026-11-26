import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ProfileTop, type ProfileTopProps } from '@/components/match/profile-top';
import type { PlayerLevel } from '@/lib/match/levels';
import type { Profile } from '@/lib/use-profile';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const profile = (over: Partial<Profile> = {}) =>
  ({
    id: 'me',
    full_name: 'Panos Alepis',
    username: 'panos',
    city: 'Limassol',
    position: 'Midfielder',
    preferred_foot: 'Right',
    ...over,
  }) as Profile;

const level = (over: Partial<PlayerLevel> = {}): PlayerLevel => ({
  level: 6.4,
  provisional: false,
  reliabilityPct: 60,
  competitiveMatches: 12,
  source: 'questionnaire',
  ...over,
});

function props(over: Partial<ProfileTopProps> = {}): ProfileTopProps {
  return {
    profile: profile(),
    summary: {
      status: 'ready',
      summary: { followers: 128, following: 96, level: 6.4, provisional: false, levelChangeMonth: 0.2 },
    },
    level: { status: 'ready', level: level() },
    canShare: true,
    topInset: 0,
    onShare: jest.fn(),
    onMyCard: jest.fn(),
    ...over,
  };
}

beforeEach(() => (router.push as jest.Mock).mockReset());

describe('ProfileTop', () => {
  it('shows the name, subtitle, follow line and level with this month’s change', async () => {
    await render(<ProfileTop {...props()} />);
    expect(screen.getByTestId('profile-name')).toHaveTextContent('Panos Alepis');
    expect(screen.getByTestId('profile-subtitle')).toHaveTextContent('@panos · Limassol · Midfielder · Right foot');
    expect(screen.getByTestId('profile-follow-line')).toHaveTextContent('128 followers · 96 following');
    expect(screen.getByTestId('player-level-value')).toHaveTextContent('Level 6.4');
    expect(screen.getByTestId('player-level-change')).toHaveTextContent('of 10.0 · ▲0.2 this month');
    expect(screen.queryByTestId('profile-add-area')).toBeNull();
    expect(screen.queryByTestId('set-starting-level')).toBeNull();
  });

  it('asks for an area when there is none', async () => {
    await render(<ProfileTop {...props({ profile: profile({ city: null }) })} />);
    expect(screen.getByTestId('profile-subtitle')).toHaveTextContent('@panos · Midfielder · Right foot');
    await fireEvent.press(screen.getByTestId('profile-add-area'));
    expect(router.push).toHaveBeenCalledWith('/edit-profile');
  });

  it('every button goes to the right place', async () => {
    const p = props();
    await render(<ProfileTop {...p} />);
    await fireEvent.press(screen.getByTestId('profile-edit-avatar'));
    expect(router.push).toHaveBeenLastCalledWith('/edit-avatar');
    await fireEvent.press(screen.getByTestId('profile-edit'));
    expect(router.push).toHaveBeenLastCalledWith('/edit-profile');
    await fireEvent.press(screen.getByTestId('profile-settings'));
    expect(router.push).toHaveBeenLastCalledWith('/account');
    await fireEvent.press(screen.getByTestId('profile-my-card'));
    expect(p.onMyCard).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('profile-share'));
    expect(p.onShare).toHaveBeenCalled();
  });

  it('hides Share when the card has no QR (a minor, or no username)', async () => {
    await render(<ProfileTop {...props({ canShare: false })} />);
    expect(screen.queryByTestId('profile-share')).toBeNull();
    expect(screen.getByTestId('profile-settings')).toBeTruthy();
  });

  it('a provisional level is tagged, and no change shows only the scale', async () => {
    await render(
      <ProfileTop
        {...props({
          level: { status: 'ready', level: level({ provisional: true }) },
          summary: {
            status: 'ready',
            summary: { followers: 1, following: 0, level: 6.4, provisional: true, levelChangeMonth: null },
          },
        })}
      />,
    );
    expect(screen.getByTestId('player-level-provisional')).toBeTruthy();
    expect(screen.getByTestId('player-level-change')).toHaveTextContent(/^of 10\.0$/);
    expect(screen.getByTestId('profile-follow-line')).toHaveTextContent('1 follower · 0 following');
  });

  it('no level yet offers the starting questions', async () => {
    await render(<ProfileTop {...props({ level: { status: 'ready', level: null } })} />);
    expect(screen.getByText('No level yet')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('set-starting-level'));
    expect(router.push).toHaveBeenCalledWith('/starting-level');
  });

  it('shows skeletons while loading and leaves out what failed', async () => {
    await render(<ProfileTop {...props({ level: { status: 'loading' }, summary: { status: 'loading' } })} />);
    expect(screen.getByTestId('player-level-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('profile-follow-line')).toBeNull();
    await render(
      <ProfileTop {...props({ level: { status: 'error', message: 'x' }, summary: { status: 'error', message: 'x' } })} />,
    );
    expect(screen.queryByTestId('player-level')).toBeNull();
    expect(screen.queryByTestId('profile-follow-line')).toBeNull();
    expect(screen.getByTestId('profile-my-card')).toBeTruthy();
  });
});
