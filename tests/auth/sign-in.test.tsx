import { mockAuth, pending } from './mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import SignInScreen from '@/app/sign-in';

const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.signIn.mockResolvedValue(undefined);
  mockAuth.isUsernameAvailable.mockResolvedValue(true);
  mockAuth.signUp.mockResolvedValue({ needsEmailConfirmation: true });
});

describe('Sign in', () => {
  it('shows the wordmark, labelled fields and one primary button', async () => {
    await render(<SignInScreen />);
    expect(screen.getByRole('header', { name: 'Futty' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(button('Sign in')).toBeTruthy();
  });

  it('empty fields: inline errors once they lose focus, and the button stays off', async () => {
    await render(<SignInScreen />);
    expect(screen.queryByText('Enter your email.')).toBeNull();
    await fireEvent(screen.getByLabelText('Email'), 'blur');
    await fireEvent(screen.getByLabelText('Password'), 'blur');
    expect(screen.getByText('Enter your email.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(button('Sign in').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('an invalid email: inline error on blur', async () => {
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'anghelo');
    await fireEvent(screen.getByLabelText('Email'), 'blur');
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
  });

  it('shows loading while signing in and cannot be pressed twice', async () => {
    const request = pending();
    mockAuth.signIn.mockReturnValue(request.promise);
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'player@futty.cy');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret');
    await fireEvent.press(button('Sign in'));
    expect(button('Sign in').props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(button('Sign in'));
    expect(mockAuth.signIn).toHaveBeenCalledTimes(1);
    expect(mockAuth.signIn).toHaveBeenCalledWith('player@futty.cy', 'secret');
    await act(async () => request.resolve());
  });

  it('a server error shows inline', async () => {
    mockAuth.signIn.mockRejectedValue(new Error('Invalid login credentials'));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'player@futty.cy');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
    await fireEvent.press(button('Sign in'));
    expect(await screen.findByText('Invalid login credentials')).toBeTruthy();
    expect(button('Sign in').props.accessibilityState).toMatchObject({ busy: false });
  });
});

describe('Sign up', () => {
  async function openSignUp() {
    await render(<SignInScreen />);
    await fireEvent.press(button('No account yet? Sign up'));
  }

  it('a username that breaks the rules and a short password: inline errors on blur', async () => {
    await openSignUp();
    await fireEvent.changeText(screen.getByLabelText('Username'), 'a b');
    await fireEvent(screen.getByLabelText('Username'), 'blur');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'short');
    await fireEvent(screen.getByLabelText('Password'), 'blur');
    expect(screen.getByText('Usernames are 3–24 characters, letters, numbers and underscores only.')).toBeTruthy();
    expect(screen.getByText('Password must be at least 8 characters.')).toBeTruthy();
  });

  it('an empty username: inline error on blur', async () => {
    await openSignUp();
    await fireEvent(screen.getByLabelText('Username'), 'blur');
    expect(screen.getByText('Enter a username.')).toBeTruthy();
  });

  it('signs up once, with loading, then opens confirm email as before', async () => {
    const request = pending<{ needsEmailConfirmation: boolean }>();
    mockAuth.signUp.mockReturnValue(request.promise);
    await openSignUp();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'new@futty.cy');
    await fireEvent.changeText(screen.getByLabelText('Username'), 'new_player');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'long enough');
    await fireEvent.press(button('Sign up'));
    await fireEvent.press(button('Sign up'));
    await act(async () => request.resolve({ needsEmailConfirmation: true }));
    expect(mockAuth.signUp).toHaveBeenCalledTimes(1);
    expect(mockAuth.signUp).toHaveBeenCalledWith({
      email: 'new@futty.cy',
      password: 'long enough',
      username: 'new_player',
      fullName: '',
    });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/confirm-email', params: { email: 'new@futty.cy' } });
  });
});
