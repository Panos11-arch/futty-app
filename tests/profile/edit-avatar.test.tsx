// A12: the Edit avatar screen. Initials or a Futty kit: 8 kit colours and a
// shirt number from 1 to 99, with a live preview, saved to the player's own
// profile row.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import EditAvatarScreen from '@/app/edit-avatar';
import { loadWithFile } from '@/components/ui/test-utils';

loadWithFile(EditAvatarScreen);

const mockUpdate = jest.fn();
const mockBack = jest.fn();
const mockReload = jest.fn();
const baseProfile = {
  id: 'me',
  email: 'me@futty.test',
  username: 'andreas',
  full_name: 'Andreas Georgiou',
  phone: null,
  gender: null,
  date_of_birth: null,
  bio: null,
  city: null,
  position: null,
  preferred_foot: null,
  preferred_days: [],
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
  avatar_style: 'initials',
  avatar_kit_colour: null,
  avatar_number: null,
};
let mockProfile: Record<string, unknown> = { status: 'ready', reload: mockReload, profile: baseProfile };

jest.mock('expo-router', () => ({
  router: { back: () => mockBack() },
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});
jest.mock('@/lib/use-profile', () => ({
  ...jest.requireActual<typeof import('@/lib/use-profile')>('@/lib/use-profile'),
  useProfile: () => mockProfile,
  updateProfile: (...a: unknown[]) => mockUpdate(...a),
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: (props: object) => React.createElement(View, props),
    Path: (props: object) => React.createElement(View, props),
  };
});

const preview = () => screen.getByTestId('avatar-preview');

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({ error: null });
  mockBack.mockReset();
  mockReload.mockReset();
  mockProfile = { status: 'ready', reload: mockReload, profile: baseProfile };
});

describe('Edit avatar', () => {
  it('previews the current avatar: initials by default', async () => {
    await render(<EditAvatarScreen />);
    expect(screen.getByLabelText('Andreas Georgiou')).toBeTruthy();
    expect(screen.getByText('AG')).toBeTruthy();
    expect(screen.queryByLabelText('Shirt number')).toBeNull();
  });

  it('previews a saved kit', async () => {
    mockProfile = {
      status: 'ready',
      reload: mockReload,
      profile: { ...baseProfile, avatar_style: 'kit', avatar_kit_colour: 'kitBlue', avatar_number: 9 },
    };
    await render(<EditAvatarScreen />);
    expect(screen.getByLabelText('Andreas Georgiou, shirt 9')).toBeTruthy();
    expect(screen.getByLabelText('Blue kit')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
  });

  it('switching to a kit shows the colours and number, and the preview follows each pick', async () => {
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByText('Kit'));
    // A kit starts on the first colour and number 10.
    expect(screen.getByLabelText('Andreas Georgiou, shirt 10')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Green kit'));
    expect(screen.getByLabelText('Green kit')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));
    expect(screen.getByLabelText('Red kit')).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));

    await fireEvent.changeText(screen.getByLabelText('Shirt number'), '23');
    expect(screen.getByLabelText('Andreas Georgiou, shirt 23')).toBeTruthy();
    expect(preview()).toBeTruthy();
  });

  it('keeps the number between 1 and 99 with the steppers', async () => {
    mockProfile = {
      status: 'ready',
      reload: mockReload,
      profile: { ...baseProfile, avatar_style: 'kit', avatar_kit_colour: 'kitRed', avatar_number: 99 },
    };
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByLabelText('Higher number'));
    expect(screen.getByLabelText('Andreas Georgiou, shirt 99')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Shirt number'), '1');
    await fireEvent.press(screen.getByLabelText('Lower number'));
    expect(screen.getByLabelText('Andreas Georgiou, shirt 1')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Higher number'));
    expect(screen.getByLabelText('Andreas Georgiou, shirt 2')).toBeTruthy();
  });

  it.each(['0', '100', ''])('refuses to save the number "%s"', async (typed) => {
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByText('Kit'));
    await fireEvent.changeText(screen.getByLabelText('Shirt number'), typed);
    expect(screen.getByText('Pick a number from 1 to 99.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save avatar'));
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('keeps only digits when typing', async () => {
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByText('Kit'));
    await fireEvent.changeText(screen.getByLabelText('Shirt number'), '7a.');
    expect(screen.getByLabelText('Shirt number')).toHaveProp('value', '7');
    expect(screen.getByLabelText('Andreas Georgiou, shirt 7')).toBeTruthy();
  });

  it('saves the kit to the player own profile, then goes back', async () => {
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByText('Kit'));
    await fireEvent.press(screen.getByLabelText('Yellow kit'));
    await fireEvent.changeText(screen.getByLabelText('Shirt number'), '8');
    await fireEvent.press(screen.getByText('Save avatar'));

    expect(mockUpdate).toHaveBeenCalledWith('me', {
      avatar_style: 'kit',
      avatar_kit_colour: 'kitYellow',
      avatar_number: 8,
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('saves initials with the kit cleared', async () => {
    mockProfile = {
      status: 'ready',
      reload: mockReload,
      profile: { ...baseProfile, avatar_style: 'kit', avatar_kit_colour: 'kitRed', avatar_number: 4 },
    };
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByText('Initials'));
    expect(screen.getByText('AG')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save avatar'));
    expect(mockUpdate).toHaveBeenCalledWith('me', { avatar_style: 'initials', avatar_kit_colour: null, avatar_number: null });
  });

  it('shows the error inline and lets the player try again', async () => {
    mockUpdate.mockResolvedValueOnce({ error: { message: 'network down' } });
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByText('Kit'));
    await fireEvent.press(screen.getByText('Save avatar'));

    expect(await screen.findByText('Couldn’t save your avatar: network down')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('shows a skeleton while the profile loads', async () => {
    mockProfile = { status: 'loading', reload: mockReload };
    await render(<EditAvatarScreen />);
    expect(screen.getByTestId('edit-avatar-skeleton')).toBeTruthy();
  });

  it('shows a load error with a retry', async () => {
    mockProfile = { status: 'error', message: 'offline', reload: mockReload };
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockReload).toHaveBeenCalled();
  });
});
