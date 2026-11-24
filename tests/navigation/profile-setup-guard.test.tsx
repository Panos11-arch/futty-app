// The root layout's guard for profile setup (P13): a signed-in user with no
// username sees only choose-username, and never reaches (tabs), not even
// while their profile is still loading or the read keeps failing.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Slot } from 'expo-router';
import { Text } from 'react-native';

const mockProfileRead = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => mockProfileRead() }) }),
    }),
  },
}));

const mockSignOut = jest.fn();
const mockAuthState: { session: { user: { id: string } } | null; isRecovering: boolean } = {
  session: null,
  isRecovering: false,
};
jest.mock('@/lib/auth', () => ({
  ...jest.requireActual<typeof import('@/lib/auth')>('@/lib/auth'),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ ...mockAuthState, initializing: false, signOut: mockSignOut }),
}));
jest.mock('@/lib/app-lock', () => ({
  AppLockProvider: ({ children }: { children: React.ReactNode }) => children,
  useAppLock: () => ({ locked: false }),
}));
jest.mock('@/lib/sentry', () => ({ Sentry: { wrap: (component: unknown) => component } }));
jest.mock('@/lib/wallet-pay', () => ({ APPLE_PAY_MERCHANT_ID: 'merchant.test' }));
jest.mock('@stripe/stripe-react-native', () => ({
  StripeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('expo-font', () => ({ useFonts: () => [true] }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn() }));
jest.mock('@expo-google-fonts/inter', () => ({}));
jest.mock('@expo-google-fonts/ibm-plex-mono', () => ({}));
jest.mock('@/components/futty-ai-chat', () => ({ FuttyAiChat: () => null }));
jest.mock('@/lib/push-tap', () => ({ PushTapHandler: () => null }));
jest.mock('@/components/lock-screen', () => ({ LockScreen: () => null }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);

// eslint-disable-next-line import/first
import { RootNavigator } from '@/app/_layout';
// eslint-disable-next-line import/first
import { markAgeStatus } from '@/lib/age';

const homeRenders = jest.fn();
function Home() {
  homeRenders();
  return <Text>Home screen</Text>;
}

function routes() {
  return {
    _layout: { default: RootNavigator, unstable_settings: { anchor: '(tabs)' } },
    // A layout, as in the app, so (tabs) is one guarded group.
    '(tabs)/_layout': () => <Slot />,
    '(tabs)/index': Home,
    'choose-username': () => <Text>Choose username screen</Text>,
    'date-of-birth': () => <Text>Date of birth screen</Text>,
    'age-locked': () => <Text>Age locked screen</Text>,
    'sign-in': () => <Text>Sign in screen</Text>,
    'auth/callback': require('@/app/auth/callback'),
  };
}

async function settle() {
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
}

async function open(initialUrl = '/') {
  const result = renderRouter(routes(), { initialUrl });
  await result;
  await settle();
  return { getPathname: result.getPathname };
}

const signedInAs = (id: string) => {
  mockAuthState.session = { user: { id } };
};

beforeEach(async () => {
  jest.clearAllMocks();
  mockAuthState.session = null;
  mockAuthState.isRecovering = false;
  await AsyncStorage.clear();
  mockRpc.mockResolvedValue({ data: 'ok', error: null });
});

describe('profile setup guard', () => {
  it('a signed-in user with no username sees choose-username, never Home', async () => {
    signedInAs('u1');
    mockProfileRead.mockResolvedValue({ data: { username: null }, error: null });
    await open('/');
    expect(screen.getByText('Choose username screen')).toBeTruthy();
    expect(homeRenders).not.toHaveBeenCalled();
  });

  it('a signed-in user with a username goes to Home', async () => {
    signedInAs('u1');
    mockProfileRead.mockResolvedValue({ data: { username: 'dimitris' }, error: null });
    await open('/');
    expect(screen.getByText('Home screen')).toBeTruthy();
  });

  it('holds a loading screen while the profile loads: no Home, no choose-username', async () => {
    signedInAs('u1');
    mockProfileRead.mockReturnValue(new Promise(() => {}));
    await open('/');
    expect(screen.getByLabelText('Loading your profile')).toBeTruthy();
    expect(screen.queryByText('Choose username screen')).toBeNull();
    expect(homeRenders).not.toHaveBeenCalled();
  });

  it('the loading screen offers a way out: sign out', async () => {
    signedInAs('u1');
    mockProfileRead.mockReturnValue(new Promise(() => {}));
    mockSignOut.mockResolvedValue(undefined);
    await open('/');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('a failed read keeps the loading screen and retries; no username still never reaches Home', async () => {
    signedInAs('u1');
    mockProfileRead
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } })
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ data: { username: null }, error: null });
    // open() runs pending timers once, so the first retry has already failed.
    await open('/');
    expect(mockProfileRead).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Loading your profile')).toBeTruthy();
    expect(homeRenders).not.toHaveBeenCalled();

    await settle();
    await settle();
    expect(mockProfileRead).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Choose username screen')).toBeTruthy();
    expect(homeRenders).not.toHaveBeenCalled();
  });

  it('a user stored on this device as having a username renders Home at once, with the profile read failing', async () => {
    await AsyncStorage.setItem('futty.has_username.u1', 'true');
    signedInAs('u1');
    mockProfileRead.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await open('/');
    expect(screen.getByText('Home screen')).toBeTruthy();
    expect(screen.queryByLabelText('Loading your profile')).toBeNull();
  });

  it('a user with no stored flag still waits while the profile read fails', async () => {
    signedInAs('u1');
    mockProfileRead.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await open('/');
    expect(screen.getByLabelText('Loading your profile')).toBeTruthy();
    expect(homeRenders).not.toHaveBeenCalled();
  });

  it('signed out: sign-in, and no profile read', async () => {
    await open('/');
    expect(screen.getByText('Sign in screen')).toBeTruthy();
    expect(mockProfileRead).not.toHaveBeenCalled();
  });
});

// S12: after the username, the date of birth (A1) and the under-14 lock (A2).
describe('age guard', () => {
  beforeEach(() => {
    signedInAs('u1');
    mockProfileRead.mockResolvedValue({ data: { username: 'dimitris' }, error: null });
  });

  it('no date of birth: only the date of birth screen, never Home', async () => {
    mockRpc.mockResolvedValue({ data: 'needs_dob', error: null });
    const r = await open('/');
    expect(screen.getByText('Date of birth screen')).toBeTruthy();
    expect(r.getPathname()).toBe('/date-of-birth');
    expect(homeRenders).not.toHaveBeenCalled();
    expect(mockRpc).toHaveBeenCalledWith('my_age_status');
  });

  it('under 14: only the locked screen', async () => {
    mockRpc.mockResolvedValue({ data: 'too_young', error: null });
    const r = await open('/');
    expect(screen.getByText('Age locked screen')).toBeTruthy();
    expect(r.getPathname()).toBe('/age-locked');
    expect(homeRenders).not.toHaveBeenCalled();
  });

  it('ok: Home', async () => {
    mockRpc.mockResolvedValue({ data: 'ok', error: null });
    await open('/');
    expect(screen.getByText('Home screen')).toBeTruthy();
  });

  it('holds the loading screen while the age status loads or fails', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await open('/');
    expect(screen.getByLabelText('Loading your profile')).toBeTruthy();
    expect(screen.queryByText('Date of birth screen')).toBeNull();
    expect(homeRenders).not.toHaveBeenCalled();
  });

  it('a new Apple or Google user picks a username first, with no age read yet', async () => {
    mockProfileRead.mockResolvedValue({ data: { username: null }, error: null });
    mockRpc.mockResolvedValue({ data: 'needs_dob', error: null });
    await open('/');
    expect(screen.getByText('Choose username screen')).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('saving the date of birth lets the player in', async () => {
    mockRpc.mockResolvedValue({ data: 'needs_dob', error: null });
    await open('/');
    expect(screen.getByText('Date of birth screen')).toBeTruthy();
    await act(async () => {
      markAgeStatus('ok');
    });
    expect(screen.getByText('Home screen')).toBeTruthy();
  });
});

describe('the Google sign-in callback route', () => {
  it('signed in: redirects home instead of showing "Unmatched route"', async () => {
    signedInAs('u1');
    mockProfileRead.mockResolvedValue({ data: { username: 'dimitris' }, error: null });
    const r = await open('/auth/callback?code=abc');
    expect(r.getPathname()).toBe('/');
    expect(screen.getByText('Home screen')).toBeTruthy();
  });

  it('signed out (the code is still being exchanged): lands on sign-in', async () => {
    const r = await open('/auth/callback?code=abc');
    expect(r.getPathname()).toBe('/sign-in');
    expect(screen.getByText('Sign in screen')).toBeTruthy();
  });
});
