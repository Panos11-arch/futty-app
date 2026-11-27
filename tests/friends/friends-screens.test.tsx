// S20: Community → Friends (app/friends.tsx), Scan (app/scan.tsx) and the
// futty.app/p/<username> link (app/p/[username].tsx): loading, empty, error
// and data states, every button and where it goes.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking } from 'react-native';

import FriendsScreen, { friendSections } from '@/app/friends';
import PlayerLinkScreen from '@/app/p/[username]';
import ScanScreen, { CAMERA_DENIED, NOT_A_CARD } from '@/app/scan';
import { withTheme } from '@/components/ui/test-utils';
import type { FriendRow } from '@/lib/friends';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => {
  const { View: RNView } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: RNView, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
const mockHaptic = { tap: jest.fn(), success: jest.fn(), error: jest.fn() };
jest.mock('@/lib/haptics', () => ({
  haptic: { tap: () => mockHaptic.tap(), success: () => mockHaptic.success(), error: () => mockHaptic.error() },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams ?? {},
}));
let mockUser: { id: string } | null = { id: 'me' };
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser }) }));

// The player sheet is tested on its own; here, what it was asked to show.
const mockSheet = jest.fn();
jest.mock('@/components/friends/profile-sheet', () => ({
  ProfileSheet: (props: { visible: boolean; who: unknown; onClose: () => void; onScanAgain?: () => void }) => {
    mockSheet(props);
    const { View: RNView, Text: RNText, Pressable } = jest.requireActual<typeof import('react-native')>('react-native');
    if (!props.visible) return null;
    return (
      <RNView testID="mock-sheet">
        <RNText>{JSON.stringify(props.who)}</RNText>
        <Pressable accessibilityRole="button" accessibilityLabel="Close sheet" onPress={props.onClose} />
        {props.onScanAgain ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Sheet scan again" onPress={props.onScanAgain} />
        ) : null}
      </RNView>
    );
  },
}));

type FriendsHook = ReturnType<typeof import('@/lib/use-friends').useFriends>;
let mockFriends: FriendsHook;
jest.mock('@/lib/use-friends', () => ({ useFriends: () => mockFriends }));
const mockOpenChat = jest.fn();
jest.mock('@/lib/messages', () => {
  const actual = jest.requireActual<typeof import('@/lib/messages')>('@/lib/messages');
  return { ...actual, openFriendConversation: (...a: unknown[]) => mockOpenChat(...a) };
});

// The camera: permission and a way to deliver a scan.
let mockPermission: { granted: boolean; status: string; canAskAgain: boolean } | null = null;
const mockRequest = jest.fn();
let mockScan: ((e: { data: string }) => void) | undefined;
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [mockPermission, mockRequest],
  CameraView: (props: { onBarcodeScanned?: (e: { data: string }) => void; children?: ReactNode }) => {
    mockScan = props.onBarcodeScanned;
    return null;
  },
}));

function row(over: Partial<FriendRow>): FriendRow {
  return {
    kind: 'friend',
    request_id: null,
    profile_id: 'p-ana',
    name: 'Ana Adult',
    first_name: 'Ana',
    avatar_style: null,
    avatar_kit_colour: null,
    avatar_number: null,
    avatar_illustration: null,
    level: 6.4,
    ...over,
  };
}
const cara = row({ kind: 'request', request_id: 'r1', profile_id: 'p-cara', name: 'Cara Third', first_name: 'Cara', level: null });
const ana = row({});

function hook(over: Partial<FriendsHook> = {}): FriendsHook {
  return {
    state: { status: 'ready', rows: [cara, ana] },
    refreshing: false,
    reload: jest.fn(async () => {}),
    refresh: jest.fn(async () => {}),
    accept: jest.fn(async () => ({ error: null, conversationId: 'c1' })),
    decline: jest.fn(async () => null),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'me' };
  mockFriends = hook();
  mockPermission = { granted: true, status: 'granted', canAskAgain: true };
  mockScan = undefined;
  (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams = {};
});

describe('friendSections', () => {
  it('requests first, then friends; empty sections hidden', () => {
    expect(friendSections([ana, cara]).map((s) => [s.title, s.data.length])).toEqual([
      ['Requests', 1],
      ['Friends', 1],
    ]);
    expect(friendSections([ana]).map((s) => s.title)).toEqual(['Friends']);
    expect(friendSections([])).toEqual([]);
  });
});

describe('Friends screen', () => {
  it('skeletons while loading', async () => {
    mockFriends = hook({ state: { status: 'loading' } });
    await render(withTheme(<FriendsScreen />));
    expect(screen.getByTestId('friends-skeleton')).toBeTruthy();
  });

  it('an error: one line and Try again', async () => {
    mockFriends = hook({ state: { status: 'error', message: "Friends couldn't load." } });
    await render(withTheme(<FriendsScreen />));
    expect(screen.getByText("Friends couldn't load.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockFriends.reload).toHaveBeenCalled();
  });

  it('empty: one line and Scan a card', async () => {
    mockFriends = hook({ state: { status: 'ready', rows: [] } });
    await render(withTheme(<FriendsScreen />));
    expect(screen.getByText('No friends yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Scan a card' }));
    expect(router.push).toHaveBeenCalledWith('/scan');
  });

  it('requests first (Accept / Decline), then friends (Message)', async () => {
    await render(withTheme(<FriendsScreen />));
    expect(screen.getByTestId('friends-section-requests')).toBeTruthy();
    expect(screen.getByTestId('friends-section-friends')).toBeTruthy();
    expect(screen.getByTestId('friends-accept-p-cara')).toBeTruthy();
    expect(screen.getByTestId('friends-decline-p-cara')).toBeTruthy();
    expect(screen.getByTestId('friends-message-p-ana')).toBeTruthy();
    expect(screen.queryByTestId('friends-message-p-cara')).toBeNull();
    expect(screen.getByText('Level 6.4')).toBeTruthy();
  });

  it('Accept, with a haptic', async () => {
    await render(withTheme(<FriendsScreen />));
    await fireEvent.press(screen.getByTestId('friends-accept-p-cara'));
    expect(mockFriends.accept).toHaveBeenCalledWith(cara);
    await waitFor(() => expect(mockHaptic.success).toHaveBeenCalled());
  });

  it('Accept refused: one line on the row', async () => {
    mockFriends = hook({ accept: jest.fn(async () => ({ error: "You can't add this player.", conversationId: null })) });
    await render(withTheme(<FriendsScreen />));
    await fireEvent.press(screen.getByTestId('friends-accept-p-cara'));
    expect(await screen.findByTestId('friends-problem-p-cara')).toBeTruthy();
    expect(screen.getByText("You can't add this player.")).toBeTruthy();
  });

  it('Decline', async () => {
    await render(withTheme(<FriendsScreen />));
    await fireEvent.press(screen.getByTestId('friends-decline-p-cara'));
    expect(mockFriends.decline).toHaveBeenCalledWith(cara);
  });

  it('Decline refused: one line on the row', async () => {
    mockFriends = hook({ decline: jest.fn(async () => 'This request is gone. Pull to refresh.') });
    await render(withTheme(<FriendsScreen />));
    await fireEvent.press(screen.getByTestId('friends-decline-p-cara'));
    expect(await screen.findByText('This request is gone. Pull to refresh.')).toBeTruthy();
  });

  it('Message opens the friend chat', async () => {
    mockOpenChat.mockResolvedValue({ conversationId: 'c1', error: null });
    await render(withTheme(<FriendsScreen />));
    await fireEvent.press(screen.getByTestId('friends-message-p-ana'));
    expect(mockOpenChat).toHaveBeenCalledWith('p-ana');
    await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'c1' } }));
  });

  it('Message refused: one line on the row', async () => {
    mockOpenChat.mockResolvedValue({ conversationId: null, error: { message: 'not_friends' } });
    await render(withTheme(<FriendsScreen />));
    await fireEvent.press(screen.getByTestId('friends-message-p-ana'));
    expect(await screen.findByText('Add them as a friend to message them.')).toBeTruthy();
  });

  it('a row opens the player sheet; closing it hides it', async () => {
    await render(withTheme(<FriendsScreen />));
    expect(screen.queryByTestId('mock-sheet')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Ana Adult, Level 6.4' }));
    expect(screen.getByTestId('mock-sheet')).toBeTruthy();
    expect(screen.getByText(JSON.stringify({ profileId: 'p-ana' }))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close sheet' }));
    expect(screen.queryByTestId('mock-sheet')).toBeNull();
  });

  it('pull to refresh', async () => {
    await render(withTheme(<FriendsScreen />));
    const list = screen.getByTestId('friends-list');
    await act(async () => list.props.refreshControl.props.onRefresh());
    expect(mockFriends.refresh).toHaveBeenCalled();
  });
});

describe('Scan', () => {
  it('asks for the camera first', async () => {
    mockPermission = null;
    await render(withTheme(<ScanScreen />));
    await fireEvent.press(screen.getByRole('button', { name: 'Allow camera' }));
    expect(mockRequest).toHaveBeenCalled();
  });

  it('camera refused for good: one line and Open settings', async () => {
    mockPermission = { granted: false, status: 'denied', canAskAgain: false };
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(withTheme(<ScanScreen />));
    expect(screen.getByText(CAMERA_DENIED)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open settings' }));
    expect(open).toHaveBeenCalled();
  });

  it("a Futty card opens the player's sheet", async () => {
    await render(withTheme(<ScanScreen />));
    expect(screen.getByTestId('scan-camera')).toBeTruthy();
    await act(async () => mockScan?.({ data: 'https://futty.app/p/ben_7' }));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/p/[username]', params: { username: 'ben_7' } });
    expect(mockHaptic.tap).toHaveBeenCalled();
  });

  it('anything else: one line, then Scan again', async () => {
    await render(withTheme(<ScanScreen />));
    await act(async () => mockScan?.({ data: 'https://example.com' }));
    expect(screen.getByText(NOT_A_CARD)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockScan).toBeUndefined(); // one scan at a time
    await fireEvent.press(screen.getByRole('button', { name: 'Scan again' }));
    expect(screen.queryByText(NOT_A_CARD)).toBeNull();
    expect(mockScan).toBeDefined();
  });

  it('Cancel goes back', async () => {
    await render(withTheme(<ScanScreen />));
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('the refusal is one line of at most 10 words', () => {
    for (const line of [NOT_A_CARD, CAMERA_DENIED]) expect(line.split(' ').length).toBeLessThanOrEqual(10);
  });
});

describe('futty.app/p/<username>', () => {
  it('shows the player sheet for the username', async () => {
    (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams = { username: 'ben_7' };
    await render(withTheme(<PlayerLinkScreen />));
    expect(screen.getByText(JSON.stringify({ username: 'ben_7' }))).toBeTruthy();
  });

  it('an odd username asks the server for nobody (not found)', async () => {
    (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams = { username: 'a.b' };
    await render(withTheme(<PlayerLinkScreen />));
    expect(screen.getByText(JSON.stringify({ username: '' }))).toBeTruthy();
  });

  it('closing goes back, or Home when the link opened the app', async () => {
    (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams = { username: 'ben_7' };
    await render(withTheme(<PlayerLinkScreen />));
    await fireEvent.press(screen.getByRole('button', { name: 'Close sheet' }));
    expect(router.back).toHaveBeenCalled();
    (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Close sheet' }));
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('Scan again from a not-found sheet', async () => {
    (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams = { username: 'ben_7' };
    await render(withTheme(<PlayerLinkScreen />));
    await fireEvent.press(screen.getByRole('button', { name: 'Sheet scan again' }));
    expect(router.replace).toHaveBeenCalledWith('/scan');
  });

  it('signed out: Sign in', async () => {
    mockUser = null;
    (globalThis as { mockSearchParams?: Record<string, string> }).mockSearchParams = { username: 'ben_7' };
    await render(withTheme(<PlayerLinkScreen />));
    expect(screen.queryByTestId('mock-sheet')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.replace).toHaveBeenCalledWith('/sign-in');
  });
});

