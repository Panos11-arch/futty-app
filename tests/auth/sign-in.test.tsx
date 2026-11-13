import { mockApple, mockAuth, mockGoogleFlow, mockSupabase, mockWebBrowser, pending } from './mocks';

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

describe('Continue with Apple and Google (P13)', () => {
  const cancelled = Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' });

  beforeEach(() => {
    mockApple.isAvailableAsync.mockResolvedValue(true);
    mockApple.signInAsync.mockResolvedValue({
      identityToken: 'id-token',
      fullName: { givenName: 'Dimitris', familyName: 'Malas' },
    });
    mockSupabase.auth.signInWithIdToken.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockGoogleFlow.signInWithOAuth.mockResolvedValue({ data: { url: 'https://auth/google' }, error: null });
    mockGoogleFlow.exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: 'at', refresh_token: 'rt' } },
      error: null,
    });
    mockSupabase.auth.setSession.mockResolvedValue({ error: null });
    mockSupabase.profileUpdate.mockResolvedValue({ error: null });
    mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'futtyapp://auth/callback?code=the-code',
    });
  });

  async function renderReady() {
    await render(<SignInScreen />);
    await act(async () => {});
  }

  it('shows the Apple button when Apple sign-in is available', async () => {
    await renderReady();
    expect(button('Continue with Apple')).toBeTruthy();
    expect(button('Continue with Google')).toBeTruthy();
  });

  it('hides the Apple button when it is not available', async () => {
    mockApple.isAvailableAsync.mockResolvedValue(false);
    await renderReady();
    expect(screen.queryByRole('button', { name: 'Continue with Apple' })).toBeNull();
    expect(button('Continue with Google')).toBeTruthy();
  });

  it("Apple: creates the session and saves the name from Apple's first sign-in", async () => {
    await renderReady();
    await fireEvent.press(button('Continue with Apple'));
    expect(mockSupabase.auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'id-token',
      nonce: 'raw-nonce',
    });
    expect(mockSupabase.profileUpdate).toHaveBeenCalledWith({ full_name: 'Dimitris Malas' });
  });

  it('Google: exchanges the code and creates the session', async () => {
    await renderReady();
    await fireEvent.press(button('Continue with Google'));
    await act(async () => {});
    expect(mockGoogleFlow.exchangeCodeForSession).toHaveBeenCalledWith('the-code');
    expect(mockSupabase.auth.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' });
  });

  it('cancelling Apple shows no error', async () => {
    mockApple.signInAsync.mockRejectedValue(cancelled);
    await renderReady();
    await fireEvent.press(button('Continue with Apple'));
    expect(mockSupabase.auth.signInWithIdToken).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/canceled/)).toBeNull();
  });

  it('cancelling Google shows no error', async () => {
    mockWebBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'cancel' });
    await renderReady();
    await fireEvent.press(button('Continue with Google'));
    await act(async () => {});
    expect(mockSupabase.auth.setSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an Apple error shows inline', async () => {
    mockSupabase.auth.signInWithIdToken.mockResolvedValue({ data: {}, error: new Error('Invalid nonce') });
    await renderReady();
    await fireEvent.press(button('Continue with Apple'));
    expect(screen.getByText('Invalid nonce')).toBeTruthy();
  });

  it('a Google error shows inline', async () => {
    mockWebBrowser.openAuthSessionAsync.mockResolvedValue({
      type: 'success',
      url: 'futtyapp://auth/callback?error_description=Access+denied',
    });
    await renderReady();
    await fireEvent.press(button('Continue with Google'));
    await act(async () => {});
    expect(screen.getByText('Access denied')).toBeTruthy();
  });
});
