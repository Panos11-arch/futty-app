// S20: another player's sheet: the S19 card without the QR or Share / Scan /
// Edit, this season's stats, then Add friend / Requested / Accept / Friends
// and Message <first name>. Loading, not found, error and data states; every
// button; the words rules.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { ProfileSheet } from '@/components/friends/profile-sheet';
import { loadWithFile, withTheme } from '@/components/ui/test-utils';
import type { FriendStatus, ProfileCard } from '@/lib/friends';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-premium-player', () => ({ usePremiumPlayer: () => false }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }), SafeAreaView: View };
});
const mockHaptic = { tap: jest.fn(), success: jest.fn(), error: jest.fn() };
jest.mock('@/lib/haptics', () => ({
  haptic: { tap: () => mockHaptic.tap(), success: () => mockHaptic.success(), error: () => mockHaptic.error() },
}));
const mockQr = jest.fn();
jest.mock('react-native-qrcode-svg', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return function QRCodeMock(props: { value: string }) {
    mockQr(props);
    return React.createElement(View, { testID: 'qr' });
  };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (to: unknown) => mockPush(to) } }));

const mockApi = {
  fetchProfileCard: jest.fn(),
  sendFriendRequest: jest.fn(),
  cancelFriendRequest: jest.fn(),
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
  unfriend: jest.fn(),
  openFriendConversation: jest.fn(),
};
jest.mock('@/lib/friends', () => {
  const actual = jest.requireActual<typeof import('@/lib/friends')>('@/lib/friends');
  return {
    ...actual,
    fetchProfileCard: (...a: unknown[]) => mockApi.fetchProfileCard(...a),
    sendFriendRequest: (...a: unknown[]) => mockApi.sendFriendRequest(...a),
    cancelFriendRequest: (...a: unknown[]) => mockApi.cancelFriendRequest(...a),
    acceptFriendRequest: (...a: unknown[]) => mockApi.acceptFriendRequest(...a),
    declineFriendRequest: (...a: unknown[]) => mockApi.declineFriendRequest(...a),
    unfriend: (...a: unknown[]) => mockApi.unfriend(...a),
  };
});
jest.mock('@/lib/messages', () => {
  const actual = jest.requireActual<typeof import('@/lib/messages')>('@/lib/messages');
  return { ...actual, openFriendConversation: (...a: unknown[]) => mockApi.openFriendConversation(...a) };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
const mockReport = jest.fn();
jest.mock('@/lib/moderation', () => ({ reportFavouritePlayer: (...a: unknown[]) => mockReport(...a) }));
const mockStats = jest.fn();
jest.mock('@/lib/match/use-stats', () => ({ usePlayerSeasonStats: (...a: unknown[]) => mockStats(...a) }));

loadWithFile(Modal);

const CARD: ProfileCard = {
  profile_id: 'p-ben',
  username: 'ben',
  full_name: 'Ben Adult',
  first_name: 'Ben',
  avatar_style: 'initials',
  avatar_kit_colour: null,
  avatar_number: null,
  avatar_illustration: null,
  level: 6.4,
  position: 'Forward',
  preferred_foot: 'Left',
  favourite_player: null,
  member_since: '2026-03-01',
  teams: [{ id: 't1', name: 'Kato United' }],
  team_count: 1,
  show_qr: false,
  friend_status: 'none',
  request_id: null,
};

function cardWith(status: FriendStatus, over: Partial<ProfileCard> = {}) {
  return { card: { ...CARD, friend_status: status, ...over }, error: null };
}

async function open(props: Partial<Parameters<typeof ProfileSheet>[0]> = {}) {
  const onClose = jest.fn();
  const onChanged = jest.fn();
  await render(
    withTheme(<ProfileSheet visible who={{ username: 'ben' }} onClose={onClose} onChanged={onChanged} {...props} />),
  );
  return { onClose, onChanged };
}

beforeEach(() => {
  Object.values(mockApi).forEach((f) => f.mockReset());
  Object.values(mockHaptic).forEach((f) => f.mockReset());
  mockPush.mockReset();
  mockQr.mockReset();
  mockReport.mockReset();
  mockStats.mockReset().mockReturnValue({ status: 'ready', stats: null, reload: jest.fn() });
  mockApi.fetchProfileCard.mockResolvedValue(cardWith('none'));
});

describe('states', () => {
  it('nothing while closed', async () => {
    await render(withTheme(<ProfileSheet visible={false} who={{ username: 'ben' }} onClose={jest.fn()} />));
    expect(screen.queryByTestId('profile-sheet-sheet')).toBeNull();
    expect(mockApi.fetchProfileCard).not.toHaveBeenCalled();
  });

  it('skeletons while loading', async () => {
    mockApi.fetchProfileCard.mockReturnValue(new Promise(() => {}));
    await open();
    expect(screen.getByTestId('profile-sheet-handle')).toBeTruthy();
    expect(screen.getByTestId('profile-sheet-skeleton')).toBeTruthy();
  });

  it('not found: one line and Done', async () => {
    mockApi.fetchProfileCard.mockResolvedValue({ card: null, error: { message: 'player_not_found' } });
    const { onClose } = await open();
    expect(await screen.findByText('Player not found.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('not found from Scan: Scan again', async () => {
    mockApi.fetchProfileCard.mockResolvedValue({ card: null, error: { message: 'player_not_found' } });
    const onScanAgain = jest.fn();
    await open({ onScanAgain });
    await fireEvent.press(await screen.findByRole('button', { name: 'Scan again' }));
    expect(onScanAgain).toHaveBeenCalled();
  });

  it('an error: one line and Try again', async () => {
    mockApi.fetchProfileCard.mockResolvedValueOnce({ card: null, error: { message: 'boom' } });
    await open();
    expect(await screen.findByText("This card couldn't load.")).toBeTruthy();
    mockApi.fetchProfileCard.mockResolvedValueOnce(cardWith('none'));
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('profile-card')).toBeTruthy();
  });

  it('the card, never a QR, without Share, Scan or Edit, then the season', async () => {
    mockStats.mockReturnValue({
      status: 'ready',
      stats: { games: 24, goals: 19, assists: 11, avg_rating: 7.3, wins: 14, motm: 4, totw: 3, showed_up_pct: 92 },
      reload: jest.fn(),
    });
    await open();
    expect(await screen.findByTestId('profile-card')).toBeTruthy();
    expect(screen.getByText('Ben Adult')).toBeTruthy();
    expect(screen.getByText('@ben')).toBeTruthy();
    expect(screen.queryByTestId('profile-card-qr')).toBeNull();
    expect(mockQr).not.toHaveBeenCalled();
    for (const id of ['my-card-share', 'my-card-scan', 'my-card-edit']) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByText('This season')).toBeTruthy();
    expect(mockStats).toHaveBeenCalledWith('p-ben', expect.objectContaining({ kind: 'year' }));
  });

  it('the name opens their profile', async () => {
    const { onClose } = await open();
    await fireEvent.press(await screen.findByTestId('profile-card-open-profile'));
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'p-ben' } });
  });

  it('looks up by id too', async () => {
    await open({ who: { profileId: 'p-ben' } });
    await screen.findByTestId('profile-card');
    expect(mockApi.fetchProfileCard).toHaveBeenCalledWith({ profileId: 'p-ben' });
  });
});

describe('the friendship', () => {
  it.each(['self', 'unavailable'] as const)('%s: no button (A5 for an adult and a minor)', async (status) => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith(status));
    await open();
    await screen.findByTestId('profile-card');
    expect(screen.queryByTestId('profile-sheet-friend')).toBeNull();
    expect(screen.queryByTestId('profile-sheet-message')).toBeNull();
  });

  it('Add friend → Requested, with a haptic', async () => {
    mockApi.sendFriendRequest.mockResolvedValue({ requestId: 'r1', error: null });
    const { onChanged } = await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add friend' }));
    expect(mockApi.sendFriendRequest).toHaveBeenCalledWith('p-ben');
    expect(await screen.findByRole('button', { name: 'Requested' })).toBeTruthy();
    expect(mockHaptic.success).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByTestId('profile-sheet-message')).toBeNull();
  });

  it('Add friend refused: one line, no change', async () => {
    mockApi.sendFriendRequest.mockResolvedValue({ requestId: null, error: { message: 'blocked' } });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Add friend' }));
    expect(await screen.findByText("You can't add this player.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add friend' })).toBeTruthy();
    expect(mockHaptic.error).toHaveBeenCalled();
  });

  it('Requested: a tap cancels it', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('requested', { request_id: 'r1' }));
    mockApi.cancelFriendRequest.mockResolvedValue({ error: null });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Requested' }));
    expect(mockApi.cancelFriendRequest).toHaveBeenCalledWith('r1');
    expect(await screen.findByRole('button', { name: 'Add friend' })).toBeTruthy();
  });

  it('They asked: Accept → Friends and Message', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('incoming', { request_id: 'r1' }));
    mockApi.acceptFriendRequest.mockResolvedValue({ conversationId: 'c1', error: null });
    await open();
    expect(await screen.findByRole('button', { name: 'Decline' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    expect(mockApi.acceptFriendRequest).toHaveBeenCalledWith('r1');
    expect(await screen.findByRole('button', { name: 'Friends' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Message Ben' })).toBeTruthy();
    expect(mockHaptic.success).toHaveBeenCalled();
  });

  it('They asked: Decline → Add friend', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('incoming', { request_id: 'r1' }));
    mockApi.declineFriendRequest.mockResolvedValue({ error: null });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Decline' }));
    expect(mockApi.declineFriendRequest).toHaveBeenCalledWith('r1');
    expect(await screen.findByRole('button', { name: 'Add friend' })).toBeTruthy();
  });

  it('a request already gone: one line', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('incoming', { request_id: null }));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('This request is gone. Pull to refresh.')).toBeTruthy();
    expect(mockApi.acceptFriendRequest).not.toHaveBeenCalled();
  });

  it('Friends: Unfriend asks first; Keep friend keeps it', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('friends'));
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Friends' }));
    expect(screen.getByRole('button', { name: 'Unfriend' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep friend' }));
    expect(screen.getByRole('button', { name: 'Friends' })).toBeTruthy();
    expect(mockApi.unfriend).not.toHaveBeenCalled();
  });

  it('Friends: Unfriend → Add friend', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('friends'));
    mockApi.unfriend.mockResolvedValue({ error: null });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Friends' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Unfriend' }));
    expect(mockApi.unfriend).toHaveBeenCalledWith('p-ben');
    expect(await screen.findByRole('button', { name: 'Add friend' })).toBeTruthy();
  });

  it('Message <first name> opens the friend chat', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('friends'));
    mockApi.openFriendConversation.mockResolvedValue({ conversationId: 'c1', error: null });
    const { onClose } = await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Message Ben' }));
    expect(mockApi.openFriendConversation).toHaveBeenCalledWith('p-ben');
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/messages/[id]', params: { id: 'c1' } }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Message refused: one line', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('friends'));
    mockApi.openFriendConversation.mockResolvedValue({ conversationId: null, error: { message: 'not_friends' } });
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Message Ben' }));
    expect(await screen.findByText('Add them as a friend to message them.')).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it.each(['none', 'requested', 'incoming', 'friends'] as const)('%s: buttons are 1-3 words', async (status) => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith(status, { request_id: 'r1' }));
    await open();
    await screen.findByTestId('profile-sheet-friend');
    const labels = ['profile-sheet-friend', 'profile-sheet-decline', 'profile-sheet-message']
      .map((id) => screen.queryByTestId(id)?.props.accessibilityLabel as string | undefined)
      .filter((l): l is string => !!l);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label.split(' ').length).toBeLessThanOrEqual(3);
  });
});

// S19 decided the favourite player's Report button comes with S20.
describe('reporting their favourite player', () => {
  it('Report sends a favourite_player report with the reason', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('none', { favourite_player: 'Someone rude' }));
    mockReport.mockResolvedValue({ error: null });
    await open();
    await fireEvent.press(await screen.findByTestId('profile-sheet-report'));
    await fireEvent.changeText(screen.getByTestId('report-reason'), 'Offensive');
    await fireEvent.press(screen.getByTestId('report-send'));
    await waitFor(() => expect(mockReport).toHaveBeenCalledWith('me', 'p-ben', 'Offensive'));
  });

  it('a failed report: one line', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('none', { favourite_player: 'Someone rude' }));
    mockReport.mockResolvedValue({ error: { message: 'denied' } });
    await open();
    await fireEvent.press(await screen.findByTestId('profile-sheet-report'));
    await fireEvent.changeText(screen.getByTestId('report-reason'), 'Offensive');
    await fireEvent.press(screen.getByTestId('report-send'));
    expect(await screen.findByText('Could not send. Try again.')).toBeTruthy();
  });

  it('no favourite player, or your own card: no Report', async () => {
    await open();
    await screen.findByTestId('profile-card');
    expect(screen.queryByTestId('profile-sheet-report')).toBeNull();
  });

  it('your own card: no Report', async () => {
    mockApi.fetchProfileCard.mockResolvedValue(cardWith('self', { favourite_player: 'Iniesta' }));
    await open();
    await screen.findByTestId('profile-card');
    expect(screen.queryByTestId('profile-sheet-report')).toBeNull();
  });
});
