import { mockAuth, pending } from './mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ConfirmEmailScreen from '@/app/confirm-email';

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({ email: 'new@futty.cy' });
});

describe('Confirm email', () => {
  it('names the address and goes back to sign in', async () => {
    await render(<ConfirmEmailScreen />);
    expect(screen.getByText('new@futty.cy')).toBeTruthy();
    await fireEvent.press(button("I've confirmed, sign in"));
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });

  it('resends once with loading, then shows the notice', async () => {
    const request = pending();
    mockAuth.resendConfirmation.mockReturnValue(request.promise);
    await render(<ConfirmEmailScreen />);
    await fireEvent.press(button('Resend confirmation email'));
    expect(button('Resend confirmation email').props.accessibilityState).toMatchObject({ busy: true });
    await fireEvent.press(button('Resend confirmation email'));
    await act(async () => request.resolve());
    expect(mockAuth.resendConfirmation).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Sent. Check your inbox, and your spam folder.')).toBeTruthy();
  });
});
