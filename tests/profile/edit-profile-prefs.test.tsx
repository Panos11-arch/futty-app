import { fireEvent, render, screen } from '@testing-library/react-native';

import EditProfileScreen from '@/app/edit-profile';
import { loadWithFile } from '@/components/ui/test-utils';

// The screen pulls in many React Native modules; load them with the file, not inside the first test.
loadWithFile(EditProfileScreen);

const mockUpdate = jest.fn();
const mockBack = jest.fn();
const mockProfile = {
  status: 'ready',
  reload: jest.fn(),
  profile: {
    id: 'me',
    email: 'me@futty.test',
    username: 'andreas',
    full_name: 'Andreas',
    phone: null,
    gender: null,
    date_of_birth: null,
    bio: null,
    city: null,
    position: 'Midfielder',
    preferred_foot: 'Left',
    preferred_days: ['sat'],
    preferred_times: [],
    show_phone_publicly: false,
    role: 'player',
    is_premium: false,
    xp: 0,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goals: 0,
    created_at: '',
  },
};
const mockAuth = { isUsernameAvailable: jest.fn().mockResolvedValue(true) };

jest.mock('expo-router', () => ({ router: { back: () => mockBack() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/lib/use-profile', () => ({
  ...jest.requireActual<typeof import('@/lib/use-profile')>('@/lib/use-profile'),
  useProfile: () => mockProfile,
  updateProfile: (...a: unknown[]) => mockUpdate(...a),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({ error: null });
  mockBack.mockReset();
});

describe('Edit profile: preferences', () => {
  it('saves position, foot, preferred days and times', async () => {
    await render(<EditProfileScreen />);
    await fireEvent.press(screen.getByText('Striker'));
    await fireEvent.press(screen.getByText('Right'));
    await fireEvent.press(screen.getByText('Mon'));
    await fireEvent.press(screen.getByText('Sat')); // already chosen: turns it off
    await fireEvent.press(screen.getByText('Thu'));
    await fireEvent.press(screen.getByText('Evening'));
    await fireEvent.press(screen.getByText('Save changes'));

    expect(mockUpdate).toHaveBeenCalledWith(
      'me',
      expect.objectContaining({
        position: 'Striker',
        preferred_foot: 'Right',
        preferred_days: ['mon', 'thu'],
        preferred_times: ['evening'],
      }),
    );
    expect(mockBack).toHaveBeenCalled();
  }, 20000);

  it('keeps the saved preferences when nothing changes', async () => {
    await render(<EditProfileScreen />);
    await fireEvent.press(screen.getByText('Save changes'));
    expect(mockUpdate).toHaveBeenCalledWith('me', expect.objectContaining({ preferred_days: ['sat'], preferred_times: [] }));
  });
});
