// A12 and S18: the Edit avatar screen. Initials, an illustration picked from
// a sheet (tap the initials), or a Futty kit: 8 kit colours and a shirt
// number from 1 to 99, with a live preview, saved to the player's own row.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import EditAvatarScreen from '@/app/edit-avatar';
import { ILLUSTRATION_SVGS } from '@/assets/avatars/illustrations';
import { loadWithFile } from '@/components/ui/test-utils';

loadWithFile(EditAvatarScreen);

const mockUpdate = jest.fn();
const mockBack = jest.fn();
const mockReload = jest.fn();
const mockTap = jest.fn();
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
  avatar_illustration: null,
};
let mockProfile: Record<string, unknown> = { status: 'ready', reload: mockReload, profile: baseProfile };

jest.mock('expo-router', () => ({
  router: { back: () => mockBack() },
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: () => mockTap(), success: jest.fn(), error: jest.fn() } }));
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
    SvgXml: (props: object) => React.createElement(View, props),
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
      avatar_illustration: null,
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
    expect(mockUpdate).toHaveBeenCalledWith('me', {
      avatar_style: 'initials',
      avatar_kit_colour: null,
      avatar_number: null,
      avatar_illustration: null,
    });
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

describe('Edit avatar: illustrations (S18)', () => {
  const withSaved = (fields: Record<string, unknown>) => {
    mockProfile = { status: 'ready', reload: mockReload, profile: { ...baseProfile, ...fields } };
  };
  const previewArt = () => within(preview()).queryByTestId('avatar-illustration');
  const openSheet = () => fireEvent.press(screen.getByTestId('edit-avatar-initials'));

  beforeEach(() => mockTap.mockReset());

  it('tapping the initials opens the sheet: Use my initials and the avatars', async () => {
    await render(<EditAvatarScreen />);
    expect(screen.queryByText('Choose avatar')).toBeNull();
    expect(screen.getByTestId('edit-avatar-initials')).toHaveProp('accessibilityLabel', 'Change avatar');

    await openSheet();
    expect(screen.getByText('Choose avatar')).toBeTruthy();
    expect(screen.getByTestId('avatar-sheet-use-initials')).toBeTruthy();
    expect(screen.getByText('Use my initials')).toBeTruthy();
    const first = screen.getByTestId('avatar-sheet-item-avatar-01');
    expect(first).toHaveProp('accessibilityLabel', 'Avatar 1');
    expect(first).toHaveProp('accessibilityState', expect.objectContaining({ selected: false }));
    expect(screen.getByTestId('avatar-sheet-list')).toHaveProp('data', expect.arrayContaining(['avatar-01', 'avatar-48']));
    expect(screen.getByTestId('avatar-sheet-list').props.data).toHaveLength(48);
  });

  it('picking an avatar previews it, with a light haptic', async () => {
    await render(<EditAvatarScreen />);
    await openSheet();
    await fireEvent.press(screen.getByTestId('avatar-sheet-item-avatar-03'));

    expect(mockTap).toHaveBeenCalledTimes(1);
    expect(previewArt()).toHaveProp('xml', ILLUSTRATION_SVGS['avatar-03']);
    expect(within(preview()).queryByText('AG')).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('saves the illustration with the kit cleared, then goes back', async () => {
    await render(<EditAvatarScreen />);
    await openSheet();
    await fireEvent.press(screen.getByTestId('avatar-sheet-item-avatar-05'));
    await fireEvent.press(screen.getByTestId('edit-avatar-save'));

    expect(mockUpdate).toHaveBeenCalledWith('me', {
      avatar_style: 'illustration',
      avatar_kit_colour: null,
      avatar_number: null,
      avatar_illustration: 'avatar-05',
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('previews a saved illustration and marks it in the sheet', async () => {
    withSaved({ avatar_style: 'illustration', avatar_illustration: 'avatar-02' });
    await render(<EditAvatarScreen />);
    expect(previewArt()).toHaveProp('xml', ILLUSTRATION_SVGS['avatar-02']);
    // An illustration sits on the Initials tab.
    expect(screen.getByLabelText('Initials')).toHaveProp('accessibilityState', expect.objectContaining({ selected: true }));

    await openSheet();
    expect(screen.getByTestId('avatar-sheet-item-avatar-02')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: true })
    );
    expect(screen.getByTestId('avatar-sheet-item-avatar-01')).toHaveProp(
      'accessibilityState',
      expect.objectContaining({ selected: false })
    );
  });

  it('Use my initials goes back to initials and saves them', async () => {
    withSaved({ avatar_style: 'illustration', avatar_illustration: 'avatar-02' });
    await render(<EditAvatarScreen />);
    await openSheet();
    await fireEvent.press(screen.getByTestId('avatar-sheet-use-initials'));

    expect(previewArt()).toBeNull();
    expect(within(preview()).getByText('AG')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('edit-avatar-save'));
    expect(mockUpdate).toHaveBeenCalledWith('me', {
      avatar_style: 'initials',
      avatar_kit_colour: null,
      avatar_number: null,
      avatar_illustration: null,
    });
  });

  it('a kit replaces a saved illustration and clears it', async () => {
    withSaved({ avatar_style: 'illustration', avatar_illustration: 'avatar-02' });
    await render(<EditAvatarScreen />);
    await fireEvent.press(screen.getByTestId('edit-avatar-style-kit'));
    // Kit stays as it was: no sheet from its preview.
    expect(screen.queryByTestId('edit-avatar-initials')).toBeNull();
    expect(screen.getByLabelText('Andreas Georgiou, shirt 10')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('edit-avatar-save'));
    expect(mockUpdate).toHaveBeenCalledWith('me', {
      avatar_style: 'kit',
      avatar_kit_colour: 'kitRed',
      avatar_number: 10,
      avatar_illustration: null,
    });
  });

  it('going back to Initials keeps the picked illustration', async () => {
    await render(<EditAvatarScreen />);
    await openSheet();
    await fireEvent.press(screen.getByTestId('avatar-sheet-item-avatar-04'));
    await fireEvent.press(screen.getByTestId('edit-avatar-style-kit'));
    await fireEvent.press(screen.getByTestId('edit-avatar-style-initials'));
    expect(previewArt()).toHaveProp('xml', ILLUSTRATION_SVGS['avatar-04']);
  });

  it('shows initials for an illustration id the app does not have', async () => {
    withSaved({ avatar_style: 'illustration', avatar_illustration: 'avatar-99' });
    await render(<EditAvatarScreen />);
    expect(previewArt()).toBeNull();
    expect(within(preview()).getByText('AG')).toBeTruthy();
  });

  it('labels only: no explanation under the preview', async () => {
    await render(<EditAvatarScreen />);
    expect(screen.queryByText(/Other players see this/)).toBeNull();
    await openSheet();
    // Sheet title and button: 1 to 3 words.
    for (const label of ['Choose avatar', 'Use my initials', 'Save avatar']) {
      expect(label.split(' ').length).toBeLessThanOrEqual(3);
      expect(screen.getByText(label)).toBeTruthy();
    }
  });
});
