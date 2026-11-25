import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

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

// The screen asks before a back gesture or button drops unsaved changes
// (QA 24 November, bug 5): it listens for the navigator's beforeRemove.
type BeforeRemove = { preventDefault: () => void; data: { action: { type: string } } };
let mockBeforeRemove: ((e: BeforeRemove) => void) | null = null;
const mockDispatch = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockBack() },
  useNavigation: () => ({
    addListener: (event: string, listener: (e: BeforeRemove) => void) => {
      if (event === 'beforeRemove') mockBeforeRemove = listener;
      return () => undefined;
    },
    dispatch: (...a: unknown[]) => mockDispatch(...a),
  }),
}));
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
  mockDispatch.mockReset();
  mockAuth.isUsernameAvailable.mockReset().mockResolvedValue(true);
  mockBeforeRemove = null;
});

/** Leaves the screen as a back gesture would; true when it was stopped. */
function leave() {
  const action = { type: 'GO_BACK' };
  const preventDefault = jest.fn();
  mockBeforeRemove?.({ preventDefault, data: { action } });
  return { stopped: preventDefault.mock.calls.length > 0, action };
}

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

  // S12, A1: the date of birth is set once and locked; Edit profile neither
  // shows it nor sends it.
  it('has no date of birth field and never sends one', async () => {
    await render(<EditProfileScreen />);
    expect(screen.queryByText('Date of birth')).toBeNull();
    expect(screen.queryByLabelText(/date of birth/i)).toBeNull();
    await fireEvent.press(screen.getByText('Save changes'));
    expect(mockUpdate.mock.calls[0][1]).not.toHaveProperty('date_of_birth');
  });

  it('keeps the saved preferences when nothing changes', async () => {
    await render(<EditProfileScreen />);
    await fireEvent.press(screen.getByText('Save changes'));
    expect(mockUpdate).toHaveBeenCalledWith('me', expect.objectContaining({ preferred_days: ['sat'], preferred_times: [] }));
  });
});

// QA 24 November, bug 4: the username error sits under the username field.
describe('Edit profile: username errors', () => {
  it('an empty username: the rules under the field, nothing saved', async () => {
    await render(<EditProfileScreen />);
    await fireEvent.changeText(screen.getByDisplayValue('andreas'), '');
    await fireEvent.press(screen.getByText('Save changes'));
    const field = screen.getByTestId('edit-profile-username-field');
    expect(within(field).getByTestId('edit-profile-username-error')).toBeTruthy();
    expect(within(field).getByText(/letters, numbers/i)).toBeTruthy();
    expect(screen.getAllByText(/letters, numbers/i)).toHaveLength(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a taken username: said under the field', async () => {
    mockAuth.isUsernameAvailable.mockResolvedValue(false);
    await render(<EditProfileScreen />);
    await fireEvent.changeText(screen.getByDisplayValue('andreas'), 'maria');
    await fireEvent.press(screen.getByText('Save changes'));
    const field = screen.getByTestId('edit-profile-username-field');
    expect(within(field).getByText('"maria" is already taken.')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('a server error is one plain line, never the server text', async () => {
    mockUpdate.mockResolvedValue({ error: { message: 'duplicate key value violates unique constraint "profiles_pkey"' } });
    await render(<EditProfileScreen />);
    await fireEvent.press(screen.getByText('Save changes'));
    expect(screen.getByText('Something went wrong. Try again.')).toBeTruthy();
    expect(screen.queryByText(/duplicate key/)).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

// QA 24 November, bug 5: leaving with unsaved changes asks first.
describe('Edit profile: unsaved changes', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => alert.mockRestore());

  it('nothing changed: leaves without asking', async () => {
    await render(<EditProfileScreen />);
    expect(leave().stopped).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it('a change: asks, Keep editing stays, Discard leaves', async () => {
    await render(<EditProfileScreen />);
    await fireEvent.changeText(screen.getByDisplayValue('Andreas'), 'Andreas K');
    const { stopped, action } = leave();
    expect(stopped).toBe(true);
    expect(alert).toHaveBeenCalledWith('Discard changes?', undefined, expect.any(Array));
    const buttons = alert.mock.calls[0][2] as { text: string; style?: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(['Keep editing', 'Discard']);
    expect(buttons[1].style).toBe('destructive');
    buttons[0].onPress?.();
    expect(mockDispatch).not.toHaveBeenCalled();
    buttons[1].onPress?.();
    expect(mockDispatch).toHaveBeenCalledWith(action);
  });

  it('after saving: leaves without asking', async () => {
    await render(<EditProfileScreen />);
    await fireEvent.changeText(screen.getByDisplayValue('Andreas'), 'Andreas K');
    await fireEvent.press(screen.getByText('Save changes'));
    expect(mockBack).toHaveBeenCalled();
    expect(leave().stopped).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });
});
