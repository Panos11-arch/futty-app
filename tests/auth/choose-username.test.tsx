import { mockAuth, pending } from './mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ChooseUsernameScreen from '@/app/choose-username';

const mockSaveProfileSetup = jest.fn();
jest.mock('@/lib/auth-providers', () => ({
  saveProfileSetup: (...args: unknown[]) => mockSaveProfileSetup(...args),
}));

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  (mockAuth as { user?: { id: string } }).user = { id: 'u1' };
  mockAuth.isUsernameAvailable.mockResolvedValue(true);
  mockSaveProfileSetup.mockResolvedValue(null);
});

describe('Choose a username (new Apple or Google user)', () => {
  it('an empty username: inline error on blur, and the button stays off', async () => {
    await render(<ChooseUsernameScreen />);
    await fireEvent(screen.getByLabelText('Username'), 'blur');
    expect(screen.getByText('Enter a username.')).toBeTruthy();
    expect(button('Continue').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a username that breaks the rules: inline error on blur', async () => {
    await render(<ChooseUsernameScreen />);
    await fireEvent.changeText(screen.getByLabelText('Username'), 'no spaces!');
    await fireEvent(screen.getByLabelText('Username'), 'blur');
    expect(screen.getAllByText(/3–24 characters/).length).toBeGreaterThan(0);
  });

  it('a taken username shows inline and saves nothing', async () => {
    mockAuth.isUsernameAvailable.mockResolvedValue(false);
    await render(<ChooseUsernameScreen />);
    await fireEvent.changeText(screen.getByLabelText('Username'), 'taken_name');
    await fireEvent.press(button('Continue'));
    expect(screen.getByText('"taken_name" is already taken.')).toBeTruthy();
    expect(mockSaveProfileSetup).not.toHaveBeenCalled();
  });

  it('saves the username and name once, with loading', async () => {
    const request = pending<string | null>();
    mockSaveProfileSetup.mockReturnValue(request.promise);
    await render(<ChooseUsernameScreen />);
    await fireEvent.changeText(screen.getByLabelText('Username'), 'new_player');
    await fireEvent.changeText(screen.getByLabelText('Full name (optional)'), 'Dimitris Malas');
    await fireEvent.press(button('Continue'));
    await fireEvent.press(button('Continue'));
    expect(button('Continue').props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => request.resolve(null));
    expect(mockSaveProfileSetup).toHaveBeenCalledTimes(1);
    expect(mockSaveProfileSetup).toHaveBeenCalledWith('u1', 'new_player', 'Dimitris Malas');
  });

  it('a save error shows inline', async () => {
    mockSaveProfileSetup.mockResolvedValue('"new_player" is already taken.');
    await render(<ChooseUsernameScreen />);
    await fireEvent.changeText(screen.getByLabelText('Username'), 'new_player');
    await fireEvent.press(button('Continue'));
    expect(screen.getByText('"new_player" is already taken.')).toBeTruthy();
  });
});
