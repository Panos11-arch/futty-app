import { mockAuth, pending } from './mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import ForgotPasswordScreen from '@/app/forgot-password';
import { flatStyle } from '@/components/ui/test-utils';

const button = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Forgot password', () => {
  it('empty and invalid email: inline errors on blur, the button stays off while empty', async () => {
    await render(<ForgotPasswordScreen />);
    await fireEvent(screen.getByLabelText('Email'), 'blur');
    expect(screen.getByText('Enter your email.')).toBeTruthy();
    expect(button('Send reset link').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText('Email'), 'nope');
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  // iPhone dev build: the field showed "Enter your email." the moment it was
  // tapped and would not take typing.
  it('Email: focusing keeps the same editable field, shows no error, and typing goes in', async () => {
    await render(<ForgotPasswordScreen />);
    const field = screen.getByLabelText('Email');
    await fireEvent(field, 'focus');
    expect(screen.getByLabelText('Email')).toBe(field);
    expect(field.props.editable).toBe(true);
    expect(screen.queryByText('Enter your email.')).toBeNull();
    await fireEvent.changeText(field, 'player@futty.cy');
    expect(screen.getByLabelText('Email')).toBe(field);
    expect(field.props.value).toBe('player@futty.cy');
    expect(flatStyle(field).lineHeight).toBeUndefined();
  });

  it('sends once with loading, then shows the sent state and the cooldown', async () => {
    const request = pending();
    mockAuth.requestPasswordReset.mockReturnValue(request.promise);
    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'player@futty.cy');
    await fireEvent.press(button('Send reset link'));
    expect(button('Send reset link').props.accessibilityState).toMatchObject({ busy: true });
    await fireEvent.press(button('Send reset link'));
    await act(async () => request.resolve());
    expect(mockAuth.requestPasswordReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('If that address has an account, a reset link is on its way.')).toBeTruthy();
    expect(screen.getByText(/You can request another link in \d+s\./)).toBeTruthy();
  });
});
