// S20: the friends lib (lib/friends.ts): server calls, words, the QR.
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  describeFriendError,
  fetchFriendRequestCount,
  fetchFriends,
  fetchProfileCard,
  FRIENDS_HREF,
  friendAction,
  friendSubtitle,
  messageLabel,
  parseFuttyQr,
  playerCardHref,
  SCAN_HREF,
  sendFriendRequest,
  unfriend,
  type FriendStatus,
  type ProfileCard,
} from '@/lib/friends';
import { cardLink } from '@/lib/player-card';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

const card: ProfileCard = {
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

function single(result: { data: unknown; error: unknown }) {
  return { maybeSingle: jest.fn(() => Promise.resolve(result)) };
}

beforeEach(() => mockRpc.mockReset());

describe('fetchProfileCard', () => {
  it('looks a player up by username', async () => {
    mockRpc.mockReturnValue(single({ data: card, error: null }));
    await expect(fetchProfileCard({ username: 'ben' })).resolves.toEqual({ card, error: null });
    expect(mockRpc).toHaveBeenCalledWith('player_profile_card', { p_username: 'ben' });
  });

  it('or by id', async () => {
    mockRpc.mockReturnValue(single({ data: card, error: null }));
    await fetchProfileCard({ profileId: 'p-ben' });
    expect(mockRpc).toHaveBeenCalledWith('player_profile_card', { p_profile_id: 'p-ben' });
  });

  it('never shows a QR, whatever comes back, and reads the level as a number', async () => {
    mockRpc.mockReturnValue(single({ data: { ...card, show_qr: true, level: '6.40', teams: null, team_count: null }, error: null }));
    const { card: got } = await fetchProfileCard({ username: 'ben' });
    expect(got).toMatchObject({ show_qr: false, level: 6.4, teams: [], team_count: 0, request_id: null });
  });

  it('keeps a null level null', async () => {
    mockRpc.mockReturnValue(single({ data: { ...card, level: null }, error: null }));
    expect((await fetchProfileCard({ username: 'ben' })).card?.level).toBeNull();
  });

  it('passes the server refusal on', async () => {
    mockRpc.mockReturnValue(single({ data: null, error: { message: 'player_not_found' } }));
    await expect(fetchProfileCard({ username: 'x' })).resolves.toEqual({ card: null, error: { message: 'player_not_found' } });
  });

  it('no row is not found', async () => {
    mockRpc.mockReturnValue(single({ data: null, error: null }));
    await expect(fetchProfileCard({ username: 'x' })).resolves.toEqual({ card: null, error: { message: 'player_not_found' } });
  });
});

describe('fetchFriends', () => {
  it('returns the rows in the server order, without its sort column', async () => {
    mockRpc.mockResolvedValue({
      data: [
        { ord: 1, kind: 'request', request_id: 'r1', profile_id: 'p1', name: 'Cara', first_name: 'Cara', level: '5.10' },
        { ord: 2, kind: 'friend', request_id: null, profile_id: 'p2', name: 'Ana', first_name: 'Ana', level: null },
      ],
      error: null,
    });
    const rows = await fetchFriends();
    expect(mockRpc).toHaveBeenCalledWith('my_friends');
    expect(rows).toEqual([
      { kind: 'request', request_id: 'r1', profile_id: 'p1', name: 'Cara', first_name: 'Cara', level: 5.1 },
      { kind: 'friend', request_id: null, profile_id: 'p2', name: 'Ana', first_name: 'Ana', level: null },
    ]);
  });

  it('no rows is an empty list', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchFriends()).resolves.toEqual([]);
  });

  it('throws on a server error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchFriends()).rejects.toThrow('boom');
  });
});

describe('fetchFriendRequestCount', () => {
  it('reads the count', async () => {
    mockRpc.mockResolvedValue({ data: 3, error: null });
    await expect(fetchFriendRequestCount()).resolves.toBe(3);
    expect(mockRpc).toHaveBeenCalledWith('my_friend_request_count');
  });

  it('is 0 on an error or an odd answer', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(fetchFriendRequestCount()).resolves.toBe(0);
    mockRpc.mockResolvedValueOnce({ data: 'two', error: null });
    await expect(fetchFriendRequestCount()).resolves.toBe(0);
  });
});

describe('requests', () => {
  it('send', async () => {
    mockRpc.mockResolvedValue({ data: 'r1', error: null });
    await expect(sendFriendRequest('p1')).resolves.toEqual({ requestId: 'r1', error: null });
    expect(mockRpc).toHaveBeenCalledWith('send_friend_request', { p_profile_id: 'p1' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'blocked' } });
    await expect(sendFriendRequest('p1')).resolves.toEqual({ requestId: null, error: { message: 'blocked' } });
  });

  it('accept returns the chat', async () => {
    mockRpc.mockResolvedValue({ data: 'c1', error: null });
    await expect(acceptFriendRequest('r1')).resolves.toEqual({ conversationId: 'c1', error: null });
    expect(mockRpc).toHaveBeenCalledWith('accept_friend_request', { p_request_id: 'r1' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'request_not_found' } });
    await expect(acceptFriendRequest('r1')).resolves.toEqual({ conversationId: null, error: { message: 'request_not_found' } });
  });

  it('decline, cancel, unfriend', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(declineFriendRequest('r1')).resolves.toEqual({ error: null });
    expect(mockRpc).toHaveBeenLastCalledWith('decline_friend_request', { p_request_id: 'r1' });
    await expect(cancelFriendRequest('r2')).resolves.toEqual({ error: null });
    expect(mockRpc).toHaveBeenLastCalledWith('cancel_friend_request', { p_request_id: 'r2' });
    await expect(unfriend('p1')).resolves.toEqual({ error: null });
    expect(mockRpc).toHaveBeenLastCalledWith('unfriend', { p_profile_id: 'p1' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not_friends' } });
    await expect(unfriend('p1')).resolves.toEqual({ error: { message: 'not_friends' } });
  });
});

describe('words', () => {
  it.each([
    'player_not_found',
    'blocked',
    'age_pair_refused',
    'already_friends',
    'already_requested',
    'request_incoming',
    'request_not_found',
    'not_friends',
    'too_young',
    'something_else',
  ])('%s: one line, at most 10 words', (code) => {
    const line = describeFriendError({ message: code });
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(10);
    expect(line).not.toMatch(/\n/);
  });

  it('a block and the age rule read the same (no reason given)', () => {
    expect(describeFriendError({ message: 'blocked' })).toBe(describeFriendError({ message: 'age_pair_refused' }));
  });

  it('no error reads as a general one', () => {
    expect(describeFriendError(null)).toBe('Something went wrong. Try again.');
  });

  it.each<[FriendStatus, string | null]>([
    ['none', 'Add friend'],
    ['requested', 'Requested'],
    ['incoming', 'Accept'],
    ['friends', 'Friends'],
    ['self', null],
    ['unavailable', null],
  ])('the button for %s', (status, label) => {
    expect(friendAction(status)?.label ?? null).toBe(label);
  });

  it('Message <first name>', () => {
    expect(messageLabel('Ben')).toBe('Message Ben');
    expect(messageLabel('  ')).toBe('Message');
    expect(messageLabel(null)).toBe('Message');
  });

  it('a friend row shows the level, or nothing', () => {
    expect(friendSubtitle({ level: 6.4 })).toBe('Level 6.4');
    expect(friendSubtitle({ level: null })).toBeNull();
  });
});

describe('parseFuttyQr', () => {
  it('reads the card QR (S19 cardLink)', () => {
    expect(parseFuttyQr(cardLink('dimi_7'))).toBe('dimi_7');
  });

  it.each([
    ['http://futty.app/p/ben', 'ben'],
    ['https://www.futty.app/p/ben/', 'ben'],
    ['HTTPS://FUTTY.APP/p/Ben', 'Ben'],
    ['  https://futty.app/p/ben?utm=x  ', 'ben'],
    ['https://futty.app/p/ben#top', 'ben'],
  ])('%s → %s', (text, username) => {
    expect(parseFuttyQr(text)).toBe(username);
  });

  it.each([
    null,
    undefined,
    '',
    'ben',
    'https://example.com/p/ben',
    'https://futty.app.evil.com/p/ben',
    'https://futty.app/u/ben',
    'https://futty.app/p/',
    'https://futty.app/p/ben/extra',
    'https://futty.app/p/a.b',
    'https://futty.app/p/ab',
    'https://futty.app/p/%E0%A4%A',
    'futtyapp://check-in?match=1&code=2',
  ])('refuses %p', (text) => {
    expect(parseFuttyQr(text)).toBeNull();
  });
});

describe('routes', () => {
  it('the card, Scan and Friends', () => {
    expect(playerCardHref('ben')).toEqual({ pathname: '/p/[username]', params: { username: 'ben' } });
    expect(SCAN_HREF).toBe('/scan');
    expect(FRIENDS_HREF).toBe('/friends');
  });
});
