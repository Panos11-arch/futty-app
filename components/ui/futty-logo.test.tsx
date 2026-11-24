import { act, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { FuttyLogo } from '@/components/ui/futty-logo';
import { flatStyle, loadWithFile } from '@/components/ui/test-utils';
import { colors } from '@/constants/futty-theme';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

let mockProfile: Record<string, unknown>;
const mockReload = jest.fn();
const mockFocusEffects: (() => void)[] = [];

jest.mock('@/lib/use-profile', () => ({ useProfile: () => ({ ...mockProfile, reload: mockReload }) }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    // Runs on mount like the real one, and again whenever a test calls focus().
    useFocusEffect: (effect: () => void) =>
      useEffect(() => {
        mockFocusEffects.push(effect);
        effect();
        return () => {
          mockFocusEffects.splice(mockFocusEffects.indexOf(effect), 1);
        };
      }, [effect]),
  };
});

loadWithFile(Image);

const focus = () => act(() => mockFocusEffects.forEach((effect) => effect()));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FuttyLogo', () => {
  it('shows the basic logo while the profile is loading', async () => {
    mockProfile = { status: 'loading' };
    await render(<FuttyLogo />);
    const logo = screen.getByTestId('futty-logo-basic');
    expect(logo.props.accessibilityLabel).toBe('Futty');
    expect(flatStyle(logo).backgroundColor).toBe(colors.surface);
    expect(screen.queryByTestId('futty-logo-premium')).toBeNull();
  });

  it('shows the basic logo (mint F on white) to a basic player', async () => {
    mockProfile = { status: 'ready', profile: { is_premium: false } };
    await render(<FuttyLogo />);
    expect(screen.getByTestId('futty-logo-basic')).toBeTruthy();
    expect(screen.queryByTestId('futty-logo-premium')).toBeNull();
  });

  it('shows the Premium logo (neon F on black) to a Premium player', async () => {
    mockProfile = { status: 'ready', profile: { is_premium: true } };
    await render(<FuttyLogo size={64} />);
    const logo = screen.getByTestId('futty-logo-premium');
    expect(logo.props.accessibilityLabel).toBe('Futty Premium');
    expect(flatStyle(logo)).toMatchObject({ width: 64, height: 64, backgroundColor: colors.logoBlack });
    expect(screen.queryByTestId('futty-logo-basic')).toBeNull();
  });

  it.each([{ status: 'error', message: 'offline' }, { status: 'missing' }])(
    'shows the basic logo when the profile is $status',
    async (state) => {
      mockProfile = state;
      await render(<FuttyLogo />);
      expect(screen.getByTestId('futty-logo-basic')).toBeTruthy();
    }
  );

  it('refetches the profile when its screen comes back into focus, not on first mount', async () => {
    mockProfile = { status: 'ready', profile: { is_premium: false } };
    await render(<FuttyLogo />);
    expect(mockReload).not.toHaveBeenCalled();
    await focus();
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('keeps the Premium logo while a refetch is loading, so it does not flicker', async () => {
    mockProfile = { status: 'ready', profile: { is_premium: true } };
    const view = await render(<FuttyLogo />);
    mockProfile = { status: 'loading' };
    await view.rerender(<FuttyLogo />);
    expect(screen.getByTestId('futty-logo-premium')).toBeTruthy();
  });
});
