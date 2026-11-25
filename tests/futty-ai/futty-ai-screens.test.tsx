// S13A: Futty AI's two screens. My chats: loading, error, empty and data,
// pull to refresh, New chat. One chat: quick replies on an empty chat, my
// message at once, typing, the answer with its buttons, Contact support,
// errors with Try again, photos, and the input staying above the keyboard.
import 'react-native-gesture-handler/jestSetup';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking, Modal } from 'react-native';

import FuttyAiChatScreen from '@/app/futty-ai/[id]';
import FuttyAiChatsScreen from '@/app/futty-ai/index';
import { loadWithFile } from '@/components/ui/test-utils';
import type { AiMessage } from '@/lib/futty-ai';

loadWithFile(Modal);

let mockParams: { id?: string } = { id: 'new' };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), back: jest.fn() },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (fn: () => void) => useEffect(fn, [fn]),
  };
});
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() } }));
jest.mock('@/lib/use-premium-player', () => ({ usePremiumPlayer: () => false }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) };
});

const mockFetchChats = jest.fn();
const mockFetchChat = jest.fn();
const mockSend = jest.fn();
const mockUrls = jest.fn();
jest.mock('@/lib/futty-ai', () => ({
  ...jest.requireActual('@/lib/futty-ai'),
  fetchAiChats: () => mockFetchChats(),
  fetchAiChat: (id: string) => mockFetchChat(id),
  sendAiMessage: (input: unknown) => mockSend(input),
  photoUrls: (paths: string[]) => mockUrls(paths),
}));
const mockPick = jest.fn();
jest.mock('@/lib/futty-ai-photos', () => ({ pickAiPhotos: (...a: unknown[]) => mockPick(...a) }));

function msg(over: Partial<AiMessage>): AiMessage {
  return { id: 'm', role: 'user', body: '', actions: [], photo_paths: [], created_at: '2026-11-20T15:53:00Z', ...over };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: 'new' };
  mockUrls.mockResolvedValue({});
});

// ---- My chats -------------------------------------------------------------------

describe('My chats', () => {
  it('loading: skeletons', async () => {
    mockFetchChats.mockReturnValue(new Promise(() => {}));
    await render(<FuttyAiChatsScreen />);
    expect(screen.getByTestId('futty-ai-skeleton')).toBeTruthy();
  });

  it('error: one line with Try again, which loads again', async () => {
    mockFetchChats.mockRejectedValueOnce(new Error('x')).mockResolvedValue([]);
    await render(<FuttyAiChatsScreen />);
    expect(await screen.findByText("Couldn't load your chats. Try again.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No chats yet.')).toBeTruthy();
    expect(mockFetchChats).toHaveBeenCalledTimes(2);
  });

  it('empty: one line and New chat', async () => {
    mockFetchChats.mockResolvedValue([]);
    await render(<FuttyAiChatsScreen />);
    expect(await screen.findByText('No chats yet.')).toBeTruthy();
    expect(screen.queryByTestId('futty-ai-new-chat')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'New chat' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/futty-ai/[id]', params: { id: 'new' } });
  });

  it('data: title = the first question, the Cyprus date; newest first as the server sends', async () => {
    mockFetchChats.mockResolvedValue([
      { id: 'c2', title: 'Cancel a booking', created_at: '2026-11-20T23:30:00Z', last_message_at: '2026-11-20T23:30:00Z' },
      { id: 'c1', title: 'How do I book?', created_at: '2026-11-18T10:00:00Z', last_message_at: '2026-11-18T10:00:00Z' },
    ]);
    await render(<FuttyAiChatsScreen />);
    const rows = await screen.findAllByTestId('futty-ai-chat-row');
    expect(within(rows[0]).getByText('Cancel a booking')).toBeTruthy();
    expect(within(rows[0]).getByText('21 Nov')).toBeTruthy();
    await fireEvent.press(rows[1]);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/futty-ai/[id]', params: { id: 'c1' } });
    await fireEvent.press(screen.getByTestId('futty-ai-new-chat'));
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/futty-ai/[id]', params: { id: 'new' } });
  });

  it('pull to refresh loads again', async () => {
    mockFetchChats.mockResolvedValue([{ id: 'c1', title: 'Hi', created_at: 'x', last_message_at: '2026-11-18T10:00:00Z' }]);
    await render(<FuttyAiChatsScreen />);
    await screen.findAllByTestId('futty-ai-chat-row');
    await act(async () => {
      await screen.getByTestId('futty-ai-chats').props.refreshControl.props.onRefresh();
    });
    expect(mockFetchChats).toHaveBeenCalledTimes(2);
  });
});

// ---- One chat ----------------------------------------------------------------------

const ANSWER = msg({
  id: 'a1',
  role: 'assistant',
  body: 'Tap **Book a pitch** on Home.',
  actions: ['book', 'contact_support'],
  created_at: '2026-11-20T15:53:05Z',
});

describe('A new chat', () => {
  it('empty: the quick replies; tapping one sends it, shows mine at once, then typing, then the answer', async () => {
    const reply = deferred<unknown>();
    mockSend.mockReturnValue(reply.promise);
    await render(<FuttyAiChatScreen />);
    expect(screen.getByText('Futty AI')).toBeTruthy();
    expect(screen.queryByTestId('ai-chat-started')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel a booking' }));
    expect(mockSend).toHaveBeenCalledWith({ chatId: null, text: 'Cancel a booking', photos: [] });
    expect(screen.getByText('Cancel a booking')).toBeTruthy();
    expect(screen.getByTestId('ai-typing')).toBeTruthy();

    await act(async () =>
      reply.resolve({
        chat_id: 'c9',
        messages: [msg({ id: 'q1', body: 'Cancel a booking', created_at: new Date().toISOString() }), ANSWER],
      })
    );
    expect(screen.queryByTestId('ai-typing')).toBeNull();
    expect(screen.getByTestId('ai-action-book')).toBeTruthy();
    expect(screen.getByText('Sent · Just now')).toBeTruthy();
    expect(screen.getByTestId('ai-chat-started')).toBeTruthy();
  });

  it('the next message goes to the saved chat', async () => {
    mockSend.mockResolvedValueOnce({ chat_id: 'c9', messages: [msg({ id: 'q1', body: 'Hi' }), ANSWER] });
    mockSend.mockResolvedValueOnce({ chat_id: 'c9', messages: [msg({ id: 'q2', body: 'More' }), { ...ANSWER, id: 'a2' }] });
    await render(<FuttyAiChatScreen />);
    await fireEvent.changeText(screen.getByTestId('chat-input'), 'Hi');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(screen.getAllByTestId('ai-answer')).toHaveLength(1));
    await fireEvent.changeText(screen.getByTestId('chat-input'), 'More');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(mockSend).toHaveBeenLastCalledWith({ chatId: 'c9', text: 'More', photos: [] }));
  });

  it('a failed send: one line with Try again, which sends the same message', async () => {
    mockSend.mockRejectedValueOnce(new Error("Couldn't reach Futty AI. Try again."));
    mockSend.mockResolvedValueOnce({ chat_id: 'c9', messages: [msg({ id: 'q1', body: 'Hi' }), ANSWER] });
    await render(<FuttyAiChatScreen />);
    await fireEvent.changeText(screen.getByTestId('chat-input'), 'Hi');
    await fireEvent.press(screen.getByTestId('chat-send'));
    expect(await screen.findByText("Couldn't reach Futty AI. Try again.")).toBeTruthy();
    expect(screen.getByText('Not sent')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('chat-send-retry'));
    await waitFor(() => expect(screen.queryByText("Couldn't reach Futty AI. Try again.")).toBeNull());
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1][0]).toEqual({ chatId: null, text: 'Hi', photos: [] });
    expect(screen.getAllByText('Hi')).toHaveLength(1);
  });

  it('photos: camera or library, up to 3, sent with the message (even with no text)', async () => {
    mockPick.mockResolvedValue([
      { uri: 'file:///a.jpg', base64: 'AAA' },
      { uri: 'file:///b.jpg', base64: 'BBB' },
    ]);
    mockSend.mockResolvedValue({ chat_id: 'c9', messages: [msg({ id: 'q1', photo_paths: ['me/c9/a.jpg', 'me/c9/b.jpg'] }), ANSWER] });
    await render(<FuttyAiChatScreen />);
    await fireEvent.press(screen.getByTestId('ai-attach'));
    await fireEvent.press(screen.getByTestId('ai-attach-library'));
    await waitFor(() => expect(screen.getAllByTestId('ai-attachment-remove')).toHaveLength(2));
    expect(mockPick).toHaveBeenCalledWith('library', 3);
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith({ chatId: null, text: '', photos: ['AAA', 'BBB'] }));
    expect(screen.queryByTestId('ai-attachments')).toBeNull();

    // Tapping a photo in the chat opens it full screen.
    await fireEvent.press(screen.getAllByTestId('ai-photo')[0]);
    expect(screen.getByTestId('ai-photo-full')).toBeTruthy();
  });

  it('camera not allowed: one line saying what to do', async () => {
    mockPick.mockResolvedValue('denied');
    await render(<FuttyAiChatScreen />);
    await fireEvent.press(screen.getByTestId('ai-attach'));
    await fireEvent.press(screen.getByTestId('ai-attach-camera'));
    expect(await screen.findByText('Camera access is off. Allow it in Settings.')).toBeTruthy();
    expect(mockPick).toHaveBeenCalledWith('camera', 3);
  });

  it('the input stays above the keyboard: inside the keyboard view, the header outside it', async () => {
    await render(<FuttyAiChatScreen />);
    const keyboardView = screen.getByTestId('chat-keyboard');
    expect(within(keyboardView).getByTestId('chat-input')).toBeTruthy();
    expect(within(keyboardView).queryByTestId('ai-chat-header')).toBeNull();
    expect(screen.getByTestId('chat-input').props.multiline).toBe(true);
  });
});

describe('A saved chat', () => {
  beforeEach(() => {
    mockParams = { id: 'c1' };
  });

  it('loads its messages; the header says when it started (Cyprus time)', async () => {
    mockFetchChat.mockResolvedValue({
      chat: { id: 'c1', title: 'How do I book?', created_at: '2026-11-20T15:53:00Z', last_message_at: 'x' },
      messages: [msg({ id: 'q1', body: 'How do I book?', photo_paths: ['me/c1/a.jpg'] }), ANSWER],
    });
    mockUrls.mockResolvedValue({ 'me/c1/a.jpg': 'https://signed/a' });
    await render(<FuttyAiChatScreen />);
    expect(await screen.findByText('Started 20 Nov at 17:53')).toBeTruthy();
    expect(mockFetchChat).toHaveBeenCalledWith('c1');
    expect(mockUrls).toHaveBeenCalledWith(['me/c1/a.jpg']);
    expect(screen.queryByTestId('ai-quick-replies')).toBeNull();
  });

  it('an action button opens its screen; Contact support emails the chat', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockFetchChat.mockResolvedValue({
      chat: { id: 'c1', title: 'How do I book?', created_at: '2026-11-20T15:53:00Z', last_message_at: 'x' },
      messages: [msg({ id: 'q1', body: 'How do I book?' }), ANSWER],
    });
    await render(<FuttyAiChatScreen />);
    await fireEvent.press(await screen.findByTestId('ai-action-book'));
    expect(router.push).toHaveBeenCalledWith('/book');
    await fireEvent.press(screen.getByTestId('ai-action-contact-support'));
    const url = open.mock.calls[0][0];
    expect(url.startsWith('mailto:support@futty.app?subject=Futty%20AI%3A%20How%20do%20I%20book%3F')).toBe(true);
    expect(decodeURIComponent(url)).toContain('Me: How do I book?');
  });

  it('deleted (7 days after its last message): one line with Try again', async () => {
    mockFetchChat.mockRejectedValue(new Error('chat_not_found'));
    await render(<FuttyAiChatScreen />);
    expect(await screen.findByText('This chat was deleted. Start a new chat.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('back goes back', async () => {
    mockFetchChat.mockReturnValue(new Promise(() => {}));
    await render(<FuttyAiChatScreen />);
    expect(screen.getByTestId('chat-skeleton')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('ai-chat-back'));
    expect(router.back).toHaveBeenCalled();
  });
});
