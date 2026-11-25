import { fireEvent, render, screen } from '@testing-library/react-native';
import { Modal, Text } from 'react-native';

import { ChatView, type ChatViewProps } from '@/components/messages/chat-view';
import { loadWithFile } from '@/components/ui/test-utils';
import type { ChatMessage } from '@/lib/messages';

loadWithFile(Modal);

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

function msg(id: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    sender_id: 'them',
    sender_name: 'Ben',
    mine: false,
    body: `body ${id}`,
    client_id: null,
    created_at: '2026-11-25T08:00:00Z',
    ...over,
  };
}

function view(props: Partial<ChatViewProps> = {}) {
  return render(
    <ChatView header={<Text>Header</Text>} messages={[]} onSend={jest.fn()} emptyLine="No messages yet. Say hello." {...props} />
  );
}

describe('ChatView', () => {
  it('loading: the skeleton, the header, no list', async () => {
    await view({ messages: null });
    expect(screen.getByTestId('chat-skeleton')).toBeTruthy();
    expect(screen.getByText('Header')).toBeTruthy();
    expect(screen.queryByTestId('chat-list')).toBeNull();
  });

  it('empty: one line', async () => {
    await view();
    expect(screen.getByText('No messages yet. Say hello.')).toBeTruthy();
  });

  it('error: one line with Try again', async () => {
    const onRetryLoad = jest.fn();
    await view({ messages: null, loadError: "You're no longer in this chat.", onRetryLoad });
    expect(screen.getByText("You're no longer in this chat.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetryLoad).toHaveBeenCalled();
  });

  it('data: bubbles, a date pill and my ticks', async () => {
    await view({
      messages: [msg('2', { mine: true, sender_id: 'me' }), msg('1')],
      tickFor: () => 'delivered',
    });
    expect(screen.getByText('body 1')).toBeTruthy();
    expect(screen.getByText('body 2')).toBeTruthy();
    expect(screen.getByTestId('tick-delivered')).toBeTruthy();
    expect(screen.getAllByRole('header').length).toBeGreaterThanOrEqual(1);
  });

  it('send goes to onSend', async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    await view({ onSend });
    await fireEvent.changeText(screen.getByLabelText('Message'), 'hello');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('hello');
  });

  it('a failed send: the line, and the bubble retries with its client id', async () => {
    const onRetrySend = jest.fn();
    await view({
      messages: [msg('k1', { mine: true, client_id: 'k1', pending: 'failed' })],
      tickFor: (m) => m.pending ?? 'sent',
      onRetrySend,
      sendError: 'Too many messages. Try again in a minute.',
    });
    expect(screen.getByText('Too many messages. Try again in a minute.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bubble-mine'));
    expect(onRetrySend).toHaveBeenCalledWith('k1');
  });

  it('refused: one line instead of the input, with its action', async () => {
    const onPress = jest.fn();
    await view({ refusal: 'You blocked this player. Unblock to message.', refusalAction: { label: 'Unblock', onPress } });
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.getByText('You blocked this player. Unblock to message.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Unblock' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('long press: Copy and Report, each with the message', async () => {
    const onCopy = jest.fn();
    const onReport = jest.fn();
    await view({ messages: [msg('1')], onCopy, onReport });
    await fireEvent(screen.getByTestId('bubble-theirs'), 'longPress');
    await fireEvent.press(screen.getByTestId('chat-action-copy'));
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    await fireEvent(screen.getByTestId('bubble-theirs'), 'longPress');
    await fireEvent.press(screen.getByTestId('chat-action-report'));
    expect(onReport).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });

  it('a message still sending has no long-press menu', async () => {
    await view({ messages: [msg('k', { mine: true, pending: 'sending', client_id: 'k' })], onCopy: jest.fn() });
    await fireEvent(screen.getByTestId('bubble-mine'), 'longPress');
    expect(screen.queryByTestId('chat-action-copy')).toBeNull();
  });

  it('scrolling up and back down reports where the player is; the pill shows unseen ones', async () => {
    const onAtBottomChange = jest.fn();
    await view({ messages: [msg('1')], unseen: 2, onAtBottomChange });
    const list = screen.getByTestId('chat-list');
    await fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 600 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 600 } } });
    expect(onAtBottomChange).toHaveBeenLastCalledWith(false);
    await fireEvent.press(screen.getByRole('button', { name: '2 new messages' }));
    expect(onAtBottomChange).toHaveBeenLastCalledWith(true);
  });

  it('pages upward at the top of the history, only when there is more', async () => {
    const onLoadOlder = jest.fn();
    await view({ messages: [msg('1')], hasOlder: true, onLoadOlder, loadingOlder: true });
    await fireEvent(screen.getByTestId('chat-list'), 'endReached');
    expect(onLoadOlder).toHaveBeenCalled();
    expect(screen.getByTestId('chat-loading-older')).toBeTruthy();
  });
});

// S13A: what Futty AI's chat adds to the same chat, all optional.
describe('ChatView options (S13A)', () => {
  it('empty: its own content instead of the line', async () => {
    await view({ emptyLine: undefined, empty: <Text>Quick replies</Text> });
    expect(screen.getByText('Quick replies')).toBeTruthy();
    expect(screen.queryByTestId('chat-empty')).toBeNull();
  });

  it('renderMessage draws each message; typing shows below the newest', async () => {
    await view({
      messages: [msg('2'), msg('1')],
      renderMessage: (item) => <Text>{`drawn ${item.message.id}`}</Text>,
      typing: <Text>typing</Text>,
    });
    expect(screen.getByText('drawn 1')).toBeTruthy();
    expect(screen.getByText('drawn 2')).toBeTruthy();
    expect(screen.queryByTestId('bubble-theirs')).toBeNull();
    expect(screen.getByText('typing')).toBeTruthy();
  });

  it('a send error with Try again', async () => {
    const onPress = jest.fn();
    await view({ sendError: "Couldn't reach Futty AI. Try again.", sendErrorAction: { label: 'Try again', onPress } });
    await fireEvent.press(screen.getByTestId('chat-send-retry'));
    expect(onPress).toHaveBeenCalled();
  });

  it('the input: something left of it, above it, and sending with no text', async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    await view({ onSend, inputLeading: <Text>attach</Text>, inputAbove: <Text>photos</Text>, canSendEmpty: true });
    expect(screen.getByText('attach')).toBeTruthy();
    expect(screen.getByText('photos')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('chat-send'));
    expect(onSend).toHaveBeenCalledWith('');
  });

  it('without canSendEmpty there is no send button until there is text', async () => {
    await view();
    expect(screen.queryByTestId('chat-send')).toBeNull();
  });
});
