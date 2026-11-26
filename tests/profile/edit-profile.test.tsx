// S19: Edit profile holds the player card's fields: Position (Goalkeeper,
// Defender, Midfielder, Forward; Striker became Forward), Strong foot and
// Favourite player (at most 40 characters, trimmed, empty saves null).
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import EditProfileScreen from '@/app/edit-profile';
import { withTheme } from '@/components/ui/test-utils';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/phone-field', () => ({ PhoneField: () => null }));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockBack() },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ isUsernameAvailable: jest.fn(() => Promise.resolve(true)) }) }));

const PROFILE = {
  id: 'me',
  username: 'dimi',
  full_name: 'Dimi Card',
  phone: null,
  gender: null,
  bio: null,
  city: null,
  position: 'Midfielder',
  preferred_foot: 'Right',
  favourite_player: 'Iniesta',
  preferred_days: [],
  preferred_times: [],
  show_phone_publicly: false,
};
let mockProfile: Record<string, unknown> = { status: 'ready', profile: PROFILE };
const mockUpdate = jest.fn();
jest.mock('@/lib/use-profile', () => ({
  ...jest.requireActual('@/lib/use-profile'),
  useProfile: () => mockProfile,
  updateProfile: (...args: unknown[]) => mockUpdate(...args),
}));

beforeEach(() => {
  mockProfile = { status: 'ready', profile: PROFILE };
  mockUpdate.mockReset().mockResolvedValue({ error: null });
  mockBack.mockReset();
});

async function draw() {
  await render(withTheme(<EditProfileScreen />));
}

async function save() {
  await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
  return mockUpdate.mock.calls[0][1] as Record<string, unknown>;
}

describe('Edit profile: the player card fields', () => {
  it('shows skeletons while the profile loads', async () => {
    mockProfile = { status: 'loading' };
    await draw();
    expect(screen.getByTestId('edit-profile-skeleton')).toBeTruthy();
  });

  it('offers Goalkeeper, Defender, Midfielder and Forward, never Striker', async () => {
    await draw();
    for (const position of ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']) {
      expect(screen.getByText(position)).toBeTruthy();
    }
    expect(screen.queryByText('Striker')).toBeNull();
  });

  it('calls the foot "Strong foot", with Left, Right and Both', async () => {
    await draw();
    expect(screen.getByText('Strong foot')).toBeTruthy();
    expect(screen.queryByText('Preferred foot')).toBeNull();
    for (const foot of ['Left', 'Right', 'Both']) expect(screen.getByText(foot)).toBeTruthy();
  });

  it('loads the favourite player, limited to 40 characters', async () => {
    await draw();
    const field = screen.getByTestId('edit-profile-favourite-player');
    expect(field.props.value).toBe('Iniesta');
    expect(field.props.maxLength).toBe(40);
    expect(screen.getByLabelText('Favourite player')).toBeTruthy();
  });

  it('saves Forward and a trimmed favourite player', async () => {
    await draw();
    await fireEvent.press(screen.getByText('Forward'));
    await fireEvent.changeText(screen.getByTestId('edit-profile-favourite-player'), '  Mohamed Salah ');
    const fields = await save();
    expect(mockUpdate.mock.calls[0][0]).toBe('me');
    expect(fields).toMatchObject({ position: 'Forward', preferred_foot: 'Right', favourite_player: 'Mohamed Salah' });
    expect(mockBack).toHaveBeenCalled();
  });

  it('saves an emptied favourite player as null', async () => {
    await draw();
    await fireEvent.changeText(screen.getByTestId('edit-profile-favourite-player'), '   ');
    expect((await save()).favourite_player).toBeNull();
  });

  it('shows one line when saving fails, and stays', async () => {
    mockUpdate.mockResolvedValue({ error: { message: 'profiles_favourite_player_check' } });
    await draw();
    await save();
    expect(screen.queryByText(/profiles_favourite_player_check/)).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
  });
});
