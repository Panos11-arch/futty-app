import { mockAuth, pending } from './mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ConfirmEmailScreen from '@/app/confirm-email';

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.session = null;
  (useLocalSearchParams as jest.Mock).mockReturnValue({ email: 'new@futty.cy' });
});

describe('Confirm email', () => {
  it('names the address and says to open the link on this phone', async () => {
    await render(<ConfirmEmailScreen />);
    expect(screen.getByText('new@futty.cy')).toBeTruthy();
    expect(screen.getByText(/Open it on this phone\./)).toBeTruthy();
  });

  it('has no "I\'ve confirmed, sign in" button any more', async () => {
    await render(<ConfirmEmailScreen />);
    expect(screen.queryByRole('button', { name: "I've confirmed, sign in" })).toBeNull();
  });

  it('resends once with loading, then shows the notice', async () => {
    const request = pending();
    mockAuth.resendConfirmation.mockReturnValue(request.promise);
    await render(<ConfirmEmailScreen />);
    await fireEvent.press(button('Resend email'));
    expect(button('Resend email').props.accessibilityState).toMatchObject({ busy: true });
    await fireEvent.press(button('Resend email'));
    await act(async () => request.resolve());
    expect(mockAuth.resendConfirmation).toHaveBeenCalledTimes(1);
    expect(mockAuth.resendConfirmation).toHaveBeenCalledWith('new@futty.cy');
    expect(screen.getByText('Sent. Check your inbox, and your spam folder.')).toBeTruthy();
  });

  it('"Use a different email" goes back to sign up with the email kept', async () => {
    await render(<ConfirmEmailScreen />);
    await fireEvent.press(button('Use a different email'));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { mode: 'sign-up', email: 'new@futty.cy' },
    });
  });

  it('"Opened it on another device? Sign in" goes to sign in with the email', async () => {
    await render(<ConfirmEmailScreen />);
    await fireEvent.press(button('Opened it on another device? Sign in'));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { mode: 'sign-in', email: 'new@futty.cy' },
    });
  });

  it('once the link signs the user in, it shows signing in and offers nothing else', async () => {
    mockAuth.session = { user: { email: 'new@futty.cy' } };
    await render(<ConfirmEmailScreen />);
    expect(screen.getByLabelText('Signing you in')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resend email' })).toBeNull();
  });
});
