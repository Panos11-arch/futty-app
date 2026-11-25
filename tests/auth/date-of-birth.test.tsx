// S12: the date of birth screen (A1) and the locked screen (A2).
import { mockAuth } from './mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import AgeLockedScreen from '@/app/age-locked';
import DateOfBirthScreen from '@/app/date-of-birth';

// The picker: a tap picks 5 May 2000, as the native spinner would.
jest.mock('@react-native-community/datetimepicker', () => {
  const { Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: ({ testID, onChange }: { testID: string; onChange: (e: { type: string }, d: Date) => void }) =>
      createElement(Pressable, {
        testID,
        accessibilityRole: 'button',
        accessibilityLabel: 'Pick',
        onPress: () => onChange({ type: 'set' }, new Date(2000, 4, 5)),
      }),
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

const mockSave = jest.fn();
const mockMark = jest.fn();
jest.mock('@/lib/age', () => ({
  ...jest.requireActual<typeof import('@/lib/age')>('@/lib/age'),
  saveDateOfBirth: (...a: unknown[]) => mockSave(...a),
  markAgeStatus: (...a: unknown[]) => mockMark(...a),
}));

const button = (name: string) => screen.getByRole('button', { name });

async function pickDate() {
  await fireEvent.press(screen.getByTestId('dob-field'));
  await fireEvent.press(screen.getByTestId('dob-field-picker'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.signOut.mockResolvedValue(undefined);
});

describe('Date of birth screen', () => {
  it('a title, the field, Save off until a date is picked, and Sign out; no skip', async () => {
    await render(<DateOfBirthScreen />);
    expect(screen.getByTestId('dob-screen')).toBeTruthy();
    expect(screen.getByText('Date of birth', { exact: true })).toBeTruthy();
    expect(button('Save').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.queryByRole('button', { name: /skip|later|not now/i })).toBeNull();
    expect(button('Sign out')).toBeTruthy();
  });

  it('saves the picked date and tells the gate', async () => {
    mockSave.mockResolvedValue({ status: 'ok' });
    await render(<DateOfBirthScreen />);
    await pickDate();
    expect(screen.getByLabelText('Date of birth 2000-05-05')).toBeTruthy();
    await fireEvent.press(button('Save'));
    expect(mockSave).toHaveBeenCalledWith('2000-05-05');
    expect(mockMark).toHaveBeenCalledWith('ok');
  });

  it('under 14: the gate is told to lock', async () => {
    mockSave.mockResolvedValue({ status: 'too_young' });
    await render(<DateOfBirthScreen />);
    await pickDate();
    await fireEvent.press(button('Save'));
    expect(mockMark).toHaveBeenCalledWith('too_young');
  });

  it('an error: one line, and the gate is not told', async () => {
    mockSave.mockResolvedValue({ error: 'Check your date of birth and try again.' });
    await render(<DateOfBirthScreen />);
    await pickDate();
    await fireEvent.press(button('Save'));
    expect(screen.getByTestId('dob-error')).toBeTruthy();
    expect(screen.getByText('Check your date of birth and try again.')).toBeTruthy();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it('Sign out signs out', async () => {
    await render(<DateOfBirthScreen />);
    await fireEvent.press(button('Sign out'));
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  });
});

describe('Locked screen (under 14)', () => {
  it('says why, offers support and sign out, and nothing else', async () => {
    await render(<AgeLockedScreen />);
    expect(screen.getByTestId('age-locked-screen')).toBeTruthy();
    expect(screen.getByText('You must be 14 or older to use Futty.')).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual(['Contact support', 'Sign out']);
  });

  it('Contact support writes to support', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<AgeLockedScreen />);
    await fireEvent.press(screen.getByTestId('age-locked-support'));
    expect(open).toHaveBeenCalledWith('mailto:support@futty.app?subject=Futty%20account');
  });

  it('Sign out signs out', async () => {
    await render(<AgeLockedScreen />);
    await fireEvent.press(button('Sign out'));
    expect(mockAuth.signOut).toHaveBeenCalledTimes(1);
  });
});
