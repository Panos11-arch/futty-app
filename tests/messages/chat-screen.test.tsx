import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Modal } from 'react-native';

import ChatScreen from '@/app/messages/[id]';
import { loadWithFile } from '@/components/ui/test-utils';
import type { ChatMessage, ConversationHeader } from '@/lib/messages';
import type { ChatState } from '@/lib/use-messages';

loadWithFile(Modal);

const params = globalThis as { mockSearchParams?: Record<string, string> };
const mockSend = jest.fn();
const mockRetry = jest.fn();
const mockReload = jest.fn();
const mockReloadHeader = jest.fn();
let mockState: ChatState;
let mockSendError: string | null = null;
jest.mock('@/lib/use-messages', () => ({
  useConversation: () => ({
    state: mockState,
    loadingOlder: false,
    sendError: mockSendError,
    unseen: 0,
    send: (...a: unknown[]) => mockSend(...a),
    retry: (...a: unknown[]) => mockRetry(...a),
    loadOlder: jest.fn(),
    setAtBottom: jest.fn(),
    reload: () => mockReload(),
    reloadHeader: () => mockReloadHeader(),
  }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
const mockBlock = jest.fn();
const mockUnblock = jest.fn();
const mockReport = jest.fn();
jest.mock('@/lib/moderation', () => ({
  blockUser: (...a: unknown[]) => mockBlock(...a),
  unblockUser: (...a: unknown[]) => mockUnblock(...a),
  submitReport: (...a: unknown[]) => mockReport(...a),
}));
const mockCopy = jest.fn();
jest.mock('@/lib/clipboard', () => ({ copyText: (...a: unknown[]) => mockCopy(...a) }));

const header: ConversationHeader = {
  id: 'c1',
  kind: 'captains',
  title: 'Ben',
  subtitle: 'Lions',
  other_profile_id: 'p2',
  other_team_id: 't2',
  my_team_id: 't1',
  avatar_style: 'initials',
  avatar_kit_colour: null,
  avatar_number: null,
  send_refusal: null,
  blocked_by_me: false,
  other_read_at: '2026-11-25T08:00:00Z',
  other_delivered_at: '2026-11-25T08:00:00Z',
  friend_team_id: null,
  my_captain_team_id: null,
};

function message(over: Partial<ChatMessage>): ChatMessage {
  return { id: 'm1', sender_id: 'p2', sender_name: 'Ben', mine: false, body: 'Hi', client_id: null, created_at: '2026-11-25T07:00:00Z', ...over };
}

function ready(h: Partial<ConversationHeader> = {}, messages: ChatMessage[] = [message({})]) {
  mockState = { status: 'ready', header: { ...header, ...h }, messages, hasOlder: false };
}

beforeEach(() => {
  jest.clearAllMocks();
  params.mockSearchParams = { id: 'c1' };
  mockSendError = null;
  mockBlock.mockResolvedValue({ error: null });
  mockUnblock.mockResolvedValue({ error: null });
  mockReport.mockResolvedValue({ error: null });
});

describe('Chat', () => {
  it('loading', async () => {
    mockState = { status: 'loading' };
    await render(<ChatScreen />);
    expect(screen.getByTestId('chat-skeleton')).toBeTruthy();
  });

  it('error: one line and Try again', async () => {
    mockState = { status: 'error', message: "You're no longer in this chat." };
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalled();
  });

  it('empty: one line', async () => {
    ready({}, []);
    await render(<ChatScreen />);
    expect(screen.getByText('No messages yet. Say hello.')).toBeTruthy();
  });

  it('header: the captain with the team under; each opens its page', async () => {
    ready();
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ben, Lions' }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/player-profile', params: { profileId: 'p2' } });
    await fireEvent.press(screen.getByText('Lions'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/team-profile', params: { teamId: 't2' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('my message shows read when the other side read past it', async () => {
    ready({}, [message({ id: 'm2', mine: true, sender_id: 'me', body: 'Mine', created_at: '2026-11-25T07:30:00Z' })]);
    await render(<ChatScreen />);
    expect(screen.getByTestId('tick-read')).toBeTruthy();
  });

  it('sends through the hook', async () => {
    ready();
    mockSend.mockResolvedValue(true);
    await render(<ChatScreen />);
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Friday 20:00?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(mockSend).toHaveBeenCalledWith('Friday 20:00?');
  });

  it('a failed message retries', async () => {
    ready({}, [message({ id: 'k1', mine: true, client_id: 'k1', pending: 'failed' })]);
    mockSendError = 'Too many messages. Try again in a minute.';
    await render(<ChatScreen />);
    expect(screen.getByText('Too many messages. Try again in a minute.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bubble-mine'));
    expect(mockRetry).toHaveBeenCalledWith('k1');
  });

  it('long press: Copy copies the text', async () => {
    ready();
    await render(<ChatScreen />);
    await fireEvent(screen.getByTestId('bubble-theirs'), 'longPress');
    await fireEvent.press(screen.getByTestId('chat-action-copy'));
    expect(mockCopy).toHaveBeenCalledWith('Hi');
  });

  it('long press: Report sends the message and its sender', async () => {
    ready();
    await render(<ChatScreen />);
    await fireEvent(screen.getByTestId('bubble-theirs'), 'longPress');
    await fireEvent.press(screen.getByTestId('chat-action-report'));
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'abuse');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        reporterId: 'me',
        reportedUserId: 'p2',
        context: 'message',
        contextId: 'm1',
        reason: 'abuse',
      })
    );
  });

  it('⋯ Report reports the whole chat and the other player', async () => {
    ready();
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    await fireEvent.press(screen.getByTestId('chat-report'));
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'spam');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() =>
      expect(mockReport).toHaveBeenCalledWith({
        reporterId: 'me',
        reportedUserId: 'p2',
        context: 'conversation',
        contextId: 'c1',
        reason: 'spam',
      })
    );
  });

  it('a report that fails: one line', async () => {
    ready();
    mockReport.mockResolvedValue({ error: { message: 'x' } });
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    await fireEvent.press(screen.getByTestId('chat-report'));
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'spam');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Could not send. Try again.')).toBeTruthy();
  });

  it('⋯ Block asks first, then blocks and reloads', async () => {
    ready();
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    await fireEvent.press(screen.getByTestId('chat-block'));
    expect(mockBlock).not.toHaveBeenCalled();
    expect(screen.getByText('Block Ben?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('chat-block-confirm'));
    await waitFor(() => expect(mockBlock).toHaveBeenCalledWith('me', 'p2'));
    expect(mockReloadHeader).toHaveBeenCalled();
  });

  it('a block that fails: one line', async () => {
    ready();
    mockBlock.mockResolvedValue({ error: { message: 'x' } });
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    await fireEvent.press(screen.getByTestId('chat-block'));
    await fireEvent.press(screen.getByTestId('chat-block-confirm'));
    expect(await screen.findByText('Could not update. Try again.')).toBeTruthy();
  });

  it('blocked by me: one line instead of the input, and Unblock', async () => {
    ready({ send_refusal: 'blocked', blocked_by_me: true });
    await render(<ChatScreen />);
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.getByText('You blocked this player. Unblock to message.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Unblock' }));
    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith('me', 'p2'));
  });

  it('blocked by them, or an adult and a minor: one line, no Unblock', async () => {
    ready({ send_refusal: 'age_pair_refused' });
    await render(<ChatScreen />);
    expect(screen.getByText("You can't message this player.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Unblock' })).toBeNull();
  });

  it('a Former player: no profile, no Block', async () => {
    ready({ kind: 'friends', title: 'Former player', subtitle: null, other_team_id: null });
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Former player' }));
    expect(router.push).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    expect(screen.queryByTestId('chat-block')).toBeNull();
  });

  it('captain chats have no friend actions', async () => {
    ready();
    await render(<ChatScreen />);
    expect(screen.queryByRole('button', { name: 'Book together' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Team vs team' })).toBeNull();
  });

  // Friend chats open once S20 adds friends (are_friends on the server).
  it('friend chats: Book together, and Team vs team when both captain a team', async () => {
    ready({ kind: 'friends', subtitle: null, other_team_id: null, friend_team_id: 'ft', my_captain_team_id: 'mt' });
    await render(<ChatScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Book together' }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/book', params: { inviteProfileId: 'p2' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Team vs team' }));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/book', params: { oppositionTeamId: 'ft' } });
  });

  it('friend chats: no Team vs team unless both are captains', async () => {
    ready({ kind: 'friends', friend_team_id: 'ft', my_captain_team_id: null });
    await render(<ChatScreen />);
    expect(screen.getByRole('button', { name: 'Book together' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Team vs team' })).toBeNull();
  });
});
