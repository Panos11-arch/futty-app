import { mockApple, mockAuth, mockGoogleFlow, mockSupabase, mockWebBrowser, pending } from './mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Platform } from 'react-native';

import SignInScreen from '@/app/sign-in';
import { flatStyle } from '@/components/ui/test-utils';
import { clearHandedOffEmail, signInHref } from '@/lib/auth';
import { EmailTakenError } from '@/lib/auth-errors';

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

const mockDobAllowed = jest.fn();
jest.mock('@/lib/age', () => ({
  ...jest.requireActual<typeof import('@/lib/age')>('@/lib/age'),
  isDateOfBirthAllowed: (...a: unknown[]) => mockDobAllowed(...a),
}));

const button = (name: string) => screen.getByRole('button', { name });

async function pickDateOfBirth() {
  await fireEvent.press(screen.getByTestId('sign-in-dob'));
  await fireEvent.press(screen.getByTestId('sign-in-dob-picker'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDobAllowed.mockResolvedValue(true);
  mockAuth.signIn.mockResolvedValue(undefined);
  mockAuth.isUsernameAvailable.mockResolvedValue(true);
  mockAuth.signUp.mockResolvedValue({ needsEmailConfirmation: true });
  mockAuth.linkError = null;
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
});

describe('Sign in', () => {
  it('names the fields, the button and the error for the Maestro tests (.maestro)', async () => {
    mockAuth.signIn.mockRejectedValue(new Error('Invalid login credentials'));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'e2e-ios-1@e2e.futty.app');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'secret-password');
    await fireEvent.press(screen.getByTestId('sign-in-submit'));
    expect(mockAuth.signIn).toHaveBeenCalledWith('e2e-ios-1@e2e.futty.app', 'secret-password');
    expect(await screen.findByTestId('sign-in-error')).toBeTruthy();
  });

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

  it('Email: focusing keeps the same editable field, shows no error, and typing goes in', async () => {
    await render(<SignInScreen />);
    const field = screen.getByTestId('sign-in-email');
    await fireEvent(field, 'focus');
    expect(screen.getByTestId('sign-in-email')).toBe(field);
    expect(field.props.editable).toBe(true);
    expect(screen.queryByText('Enter your email.')).toBeNull();
    await fireEvent.changeText(field, 'player@futty.cy');
    expect(screen.getByTestId('sign-in-email')).toBe(field);
    expect(field.props.value).toBe('player@futty.cy');
    expect(flatStyle(field).lineHeight).toBeUndefined();
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
    await pickDateOfBirth();
    await fireEvent.press(button('Sign up'));
    await fireEvent.press(button('Sign up'));
    await act(async () => request.resolve({ needsEmailConfirmation: true }));
    expect(mockAuth.signUp).toHaveBeenCalledTimes(1);
    expect(mockAuth.signUp).toHaveBeenCalledWith({
      email: 'new@futty.cy',
      password: 'long enough',
      username: 'new_player',
      fullName: '',
      dateOfBirth: '2000-05-05',
    });
    expect(router.push).toHaveBeenCalledWith({ pathname: '/confirm-email', params: { email: 'new@futty.cy' } });
  });

  // S12, A1 and A2.
  it('asks for the date of birth: Sign up stays off without it', async () => {
    await openSignUp();
    expect(screen.getByText('Date of birth')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'new@futty.cy');
    await fireEvent.changeText(screen.getByLabelText('Username'), 'new_player');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'long enough');
    expect(button('Sign up').props.accessibilityState).toMatchObject({ disabled: true });
    await pickDateOfBirth();
    expect(button('Sign up').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('under 14: the one-line refusal and no account', async () => {
    mockDobAllowed.mockResolvedValue(false);
    await openSignUp();
    await fireEvent.changeText(screen.getByLabelText('Email'), 'young@futty.cy');
    await fireEvent.changeText(screen.getByLabelText('Username'), 'young_player');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'long enough');
    await pickDateOfBirth();
    await fireEvent.press(button('Sign up'));
    expect(mockDobAllowed).toHaveBeenCalledWith('2000-05-05');
    expect(await screen.findByText('You must be 14 or older to use Futty.')).toBeTruthy();
    expect(screen.getByTestId('sign-in-error')).toBeTruthy();
    expect(mockAuth.signUp).not.toHaveBeenCalled();
  });

  it('sign in asks for no date of birth', async () => {
    await render(<SignInScreen />);
    expect(screen.queryByTestId('sign-in-dob')).toBeNull();
  });
});

describe('Sign up with an email that already has an account', () => {
  it('shows the message, switches to Sign in with the email kept, and stays here', async () => {
    mockAuth.signUp.mockRejectedValue(new EmailTakenError());
    await render(<SignInScreen />);
    await fireEvent.press(button('No account yet? Sign up'));
    await fireEvent.changeText(screen.getByLabelText('Email'), 'taken@futty.cy');
    await fireEvent.changeText(screen.getByLabelText('Username'), 'new_player');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'long enough');
    await pickDateOfBirth();
    await fireEvent.press(button('Sign up'));

    expect(await screen.findByText('An account with this email already exists. Sign in instead.')).toBeTruthy();
    expect(screen.getByTestId('sign-in-error')).toBeTruthy();
    expect(button('Sign in')).toBeTruthy();
    expect(screen.queryByLabelText('Username')).toBeNull();
    expect(screen.getByLabelText('Email').props.value).toBe('taken@futty.cy');
    expect(screen.getByLabelText('Password').props.value).toBe('');
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('An expired or used email link', () => {
  it('shows the link error with a way to resend', async () => {
    mockAuth.linkError = 'This link has expired. Request a new one.';
    mockAuth.resendConfirmation.mockResolvedValue(undefined);
    await render(<SignInScreen />);
    expect(screen.getByText('This link has expired. Request a new one.')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Email'), 'new@futty.cy');
    await fireEvent.press(button('Resend confirmation email'));
    await act(async () => {});
    expect(mockAuth.resendConfirmation).toHaveBeenCalledWith('new@futty.cy');
    expect(mockAuth.clearLinkError).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/confirm-email', params: { email: 'new@futty.cy' } });
  });

  it('resend without a valid email asks for one', async () => {
    mockAuth.linkError = 'This link has expired. Request a new one.';
    await render(<SignInScreen />);
    await fireEvent.press(button('Resend confirmation email'));
    expect(screen.getByText('Enter your email, then tap resend.')).toBeTruthy();
    expect(mockAuth.resendConfirmation).not.toHaveBeenCalled();
  });
});

describe('Opened from confirm email', () => {
  it('native: the route params pick the mode and fill the email', async () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ mode: 'sign-up', email: 'new@futty.cy' });
    await render(<SignInScreen />);
    expect(button('Sign up')).toBeTruthy();
    expect(screen.getByLabelText('Email').props.value).toBe('new@futty.cy');
  });

  it('native: signInHref puts the email in the params', () => {
    expect(signInHref('sign-in', 'new@futty.cy')).toEqual({
      pathname: '/sign-in',
      params: { mode: 'sign-in', email: 'new@futty.cy' },
    });
  });

  describe('web', () => {
    const original = Platform.OS;
    beforeEach(() => {
      Platform.OS = 'web';
    });
    afterEach(() => {
      Platform.OS = original;
      clearHandedOffEmail();
    });

    it('keeps the email out of the URL and hands it over in memory', async () => {
      const href = signInHref('sign-in', 'new@futty.cy');
      expect(href).toEqual({ pathname: '/sign-in', params: { mode: 'sign-in' } });
      (useLocalSearchParams as jest.Mock).mockReturnValue(href.params);
      await render(<SignInScreen />);
      expect(screen.getByLabelText('Email').props.value).toBe('new@futty.cy');
    });
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
