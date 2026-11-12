import { mockAuth, pending } from './mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ResetPasswordScreen from '@/app/reset-password';

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.session = { user: { email: 'player@futty.cy' } };
  mockAuth.recoveryError = null;
});

afterAll(() => {
  mockAuth.session = null;
});

describe('Reset password', () => {
  it('empty and short password: inline errors', async () => {
    await render(<ResetPasswordScreen />);
    await fireEvent(screen.getByLabelText('New password'), 'blur');
    expect(screen.getByText('Choose a password.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('New password'), 'short');
    expect(screen.getByText('Password must be at least 8 characters.')).toBeTruthy();
    await fireEvent(screen.getByLabelText('Confirm new password'), 'blur');
    expect(screen.getByText('Enter the password again.')).toBeTruthy();
  });

  it('passwords that do not match: the same error as before, on submit', async () => {
    await render(<ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByLabelText('New password'), 'long enough');
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'different one');
    await fireEvent.press(button('Update password'));
    expect(screen.getByText('The two passwords do not match.')).toBeTruthy();
    expect(mockAuth.updatePassword).not.toHaveBeenCalled();
  });

  it('updates once with loading, then ends recovery', async () => {
    const request = pending();
    mockAuth.updatePassword.mockReturnValue(request.promise);
    await render(<ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByLabelText('New password'), 'long enough');
    await fireEvent.changeText(screen.getByLabelText('Confirm new password'), 'long enough');
    await fireEvent.press(button('Update password'));
    expect(button('Update password').props.accessibilityState).toMatchObject({ busy: true });
    await fireEvent.press(button('Update password'));
    await act(async () => request.resolve());
    expect(mockAuth.updatePassword).toHaveBeenCalledTimes(1);
    expect(mockAuth.endRecovery).toHaveBeenCalled();
  });

  it('an expired link still offers a new one', async () => {
    mockAuth.recoveryError = 'That link has expired.';
    await render(<ResetPasswordScreen />);
    expect(screen.getByText('Link expired')).toBeTruthy();
    expect(button('Request a new link')).toBeTruthy();
  });
});
