import {
  bookTogetherHref,
  buildChatItems,
  chatHref,
  clockTime,
  datePillLabel,
  describeMessageError,
  draftState,
  fetchConversationHeader,
  fetchInbox,
  fetchLeagueCaptainContacts,
  fetchMessages,
  fetchUnreadCount,
  filterContacts,
  inboxTime,
  kitOf,
  markConversationRead,
  markMessagesDelivered,
  mergeMessages,
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  newClientId,
  openCaptainConversation,
  openFriendConversation,
  profileHref,
  refusalLine,
  sendMessage,
  teamHref,
  teamVsTeamHref,
  tickFor,
  type CaptainContact,
  type ChatMessage,
} from '@/lib/messages';

import { onPhoneIn, restorePhoneZone } from '../tests/phone-time-zone';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'c0ffee00-0000-4000-8000-000000000001' }));

function msg(id: string, at: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return { id, sender_id: 'them', sender_name: 'Ben', mine: false, body: id, client_id: null, created_at: at, ...over };
}

beforeEach(() => mockRpc.mockReset());

describe('server calls', () => {
  it('fetchInbox: rows, or throws the error', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: 'c1' }], error: null });
    await expect(fetchInbox()).resolves.toEqual([{ id: 'c1' }]);
    expect(mockRpc).toHaveBeenCalledWith('list_my_conversations');
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchInbox()).rejects.toEqual({ message: 'boom' });
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchInbox()).resolves.toEqual([]);
  });

  it('fetchUnreadCount: the number, 0 for anything else', async () => {
    mockRpc.mockResolvedValueOnce({ data: 4, error: null });
    await expect(fetchUnreadCount()).resolves.toBe(4);
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(fetchUnreadCount()).resolves.toBe(0);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(fetchUnreadCount()).rejects.toEqual({ message: 'x' });
  });

  it('fetchConversationHeader: the one row; none is not found', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: 'c1', title: 'Ben' }], error: null });
    await expect(fetchConversationHeader('c1')).resolves.toEqual({ id: 'c1', title: 'Ben' });
    expect(mockRpc).toHaveBeenCalledWith('conversation_header', { p_conversation_id: 'c1' });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(fetchConversationHeader('c1')).rejects.toThrow('conversation_not_found');
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'not_in_conversation' } });
    await expect(fetchConversationHeader('c1')).rejects.toEqual({ message: 'not_in_conversation' });
  });

  it('fetchMessages: a page, older than the given message', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchMessages('c1');
    expect(mockRpc).toHaveBeenLastCalledWith('list_messages', {
      p_conversation_id: 'c1',
      p_before: null,
      p_before_id: null,
      p_limit: MESSAGE_PAGE_SIZE,
    });
    await fetchMessages('c1', { id: 'm9', created_at: '2026-11-24T10:00:00Z' });
    expect(mockRpc).toHaveBeenLastCalledWith('list_messages', {
      p_conversation_id: 'c1',
      p_before: '2026-11-24T10:00:00Z',
      p_before_id: 'm9',
      p_limit: MESSAGE_PAGE_SIZE,
    });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(fetchMessages('c1')).rejects.toEqual({ message: 'x' });
  });

  it('sendMessage: the body and the client id; the row back, or the error', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: 'm1', created_at: 't' }], error: null });
    await expect(sendMessage('c1', 'hi', 'k1')).resolves.toEqual({ data: { id: 'm1', created_at: 't' }, error: null });
    expect(mockRpc).toHaveBeenCalledWith('send_message', { p_conversation_id: 'c1', p_body: 'hi', p_client_id: 'k1' });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'blocked' } });
    await expect(sendMessage('c1', 'hi', 'k1')).resolves.toEqual({ data: null, error: { message: 'blocked' } });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(sendMessage('c1', 'hi', 'k1')).resolves.toEqual({ data: null, error: null });
  });

  it('marks read and delivered', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await markConversationRead('c1');
    expect(mockRpc).toHaveBeenCalledWith('mark_conversation_read', { p_conversation_id: 'c1' });
    await markMessagesDelivered();
    expect(mockRpc).toHaveBeenCalledWith('mark_messages_delivered');
  });

  it('opens captain and friend chats', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'c1', error: null });
    await expect(openCaptainConversation('t1', 't2')).resolves.toEqual({ conversationId: 'c1', error: null });
    expect(mockRpc).toHaveBeenCalledWith('open_captain_conversation', { p_my_team_id: 't1', p_other_team_id: 't2' });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'blocked' } });
    await expect(openCaptainConversation('t1', 't2')).resolves.toEqual({ conversationId: null, error: { message: 'blocked' } });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'not_friends' } });
    await expect(openFriendConversation('p2')).resolves.toEqual({ conversationId: null, error: { message: 'not_friends' } });
    expect(mockRpc).toHaveBeenLastCalledWith('open_friend_conversation', { p_profile_id: 'p2' });
  });

  it('league captain contacts', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ team_id: 't2' }], error: null });
    await expect(fetchLeagueCaptainContacts('l1')).resolves.toEqual([{ team_id: 't2' }]);
    expect(mockRpc).toHaveBeenCalledWith('league_captain_contacts', { p_league_id: 'l1' });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(fetchLeagueCaptainContacts('l1')).rejects.toEqual({ message: 'x' });
  });

  it('a new client id each send', () => {
    expect(newClientId()).toBe('c0ffee00-0000-4000-8000-000000000001');
  });
});

describe('words', () => {
  it.each([
    'blocked',
    'age_pair_refused',
    'not_friends',
    'not_in_conversation',
    'conversation_not_found',
    'not_captain',
    'teams_not_in_league',
    'no_captain',
    'message_required',
    'message_too_long',
    'rate_limited',
    'too_young',
    'something_else',
  ])('%s: one line, at most 10 words', (code) => {
    const line = describeMessageError({ message: code });
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(10);
    expect(line).toMatch(/[.]$/);
  });

  it('says what happened', () => {
    expect(describeMessageError({ message: 'rate_limited' })).toBe('Too many messages. Try again in a minute.');
    expect(describeMessageError({ message: 'message_too_long' })).toBe('Keep it to 1000 characters or fewer.');
    expect(describeMessageError(null)).toBe('Something went wrong. Try again.');
  });

  it('the refusal line: an Unblock hint for the blocker', () => {
    expect(refusalLine(null, false)).toBeNull();
    expect(refusalLine('blocked', true)).toBe('You blocked this player. Unblock to message.');
    expect(refusalLine('blocked', false)).toBe("You can't message this player.");
    expect(refusalLine('age_pair_refused', false)).toBe("You can't message this player.");
    expect(refusalLine('no_captain', false)).toBe('This team has no captain right now.');
  });
});

describe('the draft', () => {
  it('trimmed; empty or blank cannot be sent', () => {
    expect(draftState('  hi  ')).toEqual({ canSend: true, tooLong: false, body: 'hi' });
    expect(draftState('   ')).toEqual({ canSend: false, tooLong: false, body: '' });
    expect(draftState('')).toEqual({ canSend: false, tooLong: false, body: '' });
  });

  it('1000 characters go, 1001 don\'t (characters, not bytes)', () => {
    expect(draftState('é'.repeat(MESSAGE_MAX_LENGTH)).canSend).toBe(true);
    expect(draftState('a'.repeat(MESSAGE_MAX_LENGTH + 1))).toMatchObject({ canSend: false, tooLong: true });
  });
});

describe('Cyprus times', () => {
  afterEach(restorePhoneZone);

  it('clock and pills in Cyprus time, whatever the phone zone', () => {
    onPhoneIn('America/New_York');
    // 22:30 UTC on 24 Nov is 00:30 on 25 Nov in Cyprus (winter, UTC+2).
    const now = new Date('2026-11-25T10:00:00Z');
    expect(clockTime('2026-11-24T22:30:00Z')).toBe('00:30');
    expect(datePillLabel('2026-11-24T22:30:00Z', now)).toBe('Today');
    expect(datePillLabel('2026-11-24T21:59:00Z', now)).toBe('Yesterday');
    expect(datePillLabel('2026-11-20T10:00:00Z', now)).toBe('Friday');
    expect(datePillLabel('2026-11-17T10:00:00Z', now)).toBe('17 Nov 2026');
  });

  it('inbox times', () => {
    const now = new Date('2026-11-25T10:00:00Z');
    expect(inboxTime('2026-11-25T07:05:00Z', now)).toBe('09:05');
    expect(inboxTime('2026-11-24T07:05:00Z', now)).toBe('Yesterday');
    expect(inboxTime('2026-11-21T07:05:00Z', now)).toBe('Saturday');
    expect(inboxTime('2026-11-10T07:05:00Z', now)).toBe('10/11/26');
  });
});

describe('ticks', () => {
  const at = '2026-11-25T10:00:00Z';
  it('sending and failed while pending', () => {
    expect(tickFor(msg('a', at, { mine: true, pending: 'sending' }), null)).toBe('sending');
    expect(tickFor(msg('a', at, { mine: true, pending: 'failed' }), null)).toBe('failed');
  });

  it('sent, delivered, read from the other side\'s times', () => {
    const m = msg('a', at, { mine: true });
    expect(tickFor(m, null)).toBe('sent');
    expect(tickFor(m, { other_delivered_at: '2026-11-25T09:59:00Z', other_read_at: null })).toBe('sent');
    expect(tickFor(m, { other_delivered_at: at, other_read_at: null })).toBe('delivered');
    expect(tickFor(m, { other_delivered_at: at, other_read_at: '2026-11-25T09:00:00Z' })).toBe('delivered');
    expect(tickFor(m, { other_delivered_at: at, other_read_at: '2026-11-25T10:00:01Z' })).toBe('read');
  });
});

describe('the list', () => {
  const now = new Date('2026-11-25T12:00:00Z');

  it('groups runs from one sender, tails the newest of each, pills each day', () => {
    // Newest first.
    const items = buildChatItems(
      [
        msg('c', '2026-11-25T10:02:00Z', { mine: true, sender_id: 'me' }),
        msg('b', '2026-11-25T10:01:00Z'),
        msg('a', '2026-11-25T10:00:00Z'),
        msg('z', '2026-11-24T10:00:00Z'),
      ],
      now
    );
    expect(items.map((i) => (i.type === 'date' ? `[${i.label}]` : `${i.message.id}${i.firstInGroup ? '^' : ''}${i.lastInGroup ? '>' : ''}`))).toEqual([
      'c^>',
      'b>',
      'a^',
      '[Today]',
      'z^>',
      '[Yesterday]',
    ]);
  });

  it('a new day breaks a run from the same sender', () => {
    const items = buildChatItems([msg('b', '2026-11-25T10:00:00Z'), msg('a', '2026-11-24T10:00:00Z')], now);
    const messages = items.filter((i) => i.type === 'message');
    expect(messages.every((i) => i.type === 'message' && i.firstInGroup && i.lastInGroup)).toBe(true);
  });

  it('empty', () => {
    expect(buildChatItems([], now)).toEqual([]);
  });

  it('merges: the sent copy replaces the pending one, newest first, pending at the bottom', () => {
    const pending = msg('k1', '2026-11-25T10:05:00Z', { mine: true, client_id: 'k1', pending: 'sending' });
    const older = msg('m1', '2026-11-25T10:00:00Z');
    let list = mergeMessages([older], [pending]);
    expect(list.map((m) => m.id)).toEqual(['k1', 'm1']);
    // A message from them arrives while mine is still sending: mine stays last.
    list = mergeMessages(list, [msg('m2', '2026-11-25T10:06:00Z')]);
    expect(list.map((m) => m.id)).toEqual(['k1', 'm2', 'm1']);
    // Sent.
    list = mergeMessages(list, [msg('m3', '2026-11-25T10:07:00Z', { mine: true, client_id: 'k1' })]);
    expect(list.map((m) => m.id)).toEqual(['m3', 'm2', 'm1']);
    expect(list[0].pending).toBeUndefined();
    // The same message again (realtime and the send both deliver it): one copy.
    list = mergeMessages(list, [msg('m3', '2026-11-25T10:07:00Z', { mine: true, client_id: 'k1' })]);
    expect(list).toHaveLength(3);
    // An older page.
    list = mergeMessages(list, [msg('m0', '2026-11-25T09:00:00Z')]);
    expect(list.map((m) => m.id)).toEqual(['m3', 'm2', 'm1', 'm0']);
  });

  it('same time: by id, stable', () => {
    const list = mergeMessages([], [msg('a', '2026-11-25T10:00:00Z'), msg('b', '2026-11-25T10:00:00Z')]);
    expect(list.map((m) => m.id)).toEqual(['b', 'a']);
  });
});

describe('contacts', () => {
  const contacts = [
    { team_id: 't1', team_name: 'Lions', captain_name: 'Ben Adult' },
    { team_id: 't2', team_name: 'Wolves', captain_name: 'Cara' },
  ] as CaptainContact[];

  it('search by team or captain, any case; blank shows all', () => {
    expect(filterContacts(contacts, '')).toHaveLength(2);
    expect(filterContacts(contacts, ' lio ').map((c) => c.team_id)).toEqual(['t1']);
    expect(filterContacts(contacts, 'CARA').map((c) => c.team_id)).toEqual(['t2']);
    expect(filterContacts(contacts, 'nobody')).toEqual([]);
  });
});

describe('routes', () => {
  it('chat, profile and team', () => {
    expect(chatHref('c1')).toEqual({ pathname: '/messages/[id]', params: { id: 'c1' } });
    expect(profileHref('p1')).toEqual({ pathname: '/player-profile', params: { profileId: 'p1' } });
    expect(teamHref('t1')).toEqual({ pathname: '/team-profile', params: { teamId: 't1' } });
  });

  it('friend chats: Book together and Team vs team open Book a pitch with the friend', () => {
    expect(bookTogetherHref('p2')).toEqual({ pathname: '/book', params: { inviteProfileId: 'p2' } });
    expect(teamVsTeamHref('t2')).toEqual({ pathname: '/book', params: { oppositionTeamId: 't2' } });
  });
});

describe('kitOf (S18)', () => {
  it('reads a kit, an illustration, or initials from a row', () => {
    expect(kitOf({ avatar_style: 'kit', avatar_kit_colour: 'kitBlue', avatar_number: 4, avatar_illustration: null })).toEqual({
      colour: 'kitBlue',
      number: 4,
    });
    expect(kitOf({ avatar_style: 'illustration', avatar_kit_colour: null, avatar_number: null, avatar_illustration: 'avatar-21' })).toEqual({
      illustration: 'avatar-21',
    });
    expect(kitOf({ avatar_style: 'initials', avatar_kit_colour: null, avatar_number: null, avatar_illustration: null })).toBeNull();
    // A deleted account's columns come back null.
    expect(kitOf({ avatar_style: null, avatar_kit_colour: null, avatar_number: null, avatar_illustration: null })).toBeNull();
    expect(kitOf(null)).toBeNull();
  });
});
