// S13A: Futty AI's parts: the Markdown renderer (never a raw asterisk), the
// night header, the answer with its avatar and action buttons, my message
// with its photos and "Sent ·", the full-screen photo, typing, quick replies,
// attachments and the "?" button.
import 'react-native-gesture-handler/jestSetup';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking, Modal, StyleSheet } from 'react-native';

import { AiAnswer, MyAiMessage } from '@/components/futty-ai/ai-bubbles';
import { AiChatHeader } from '@/components/futty-ai/ai-chat-header';
import { AiMarkdown } from '@/components/futty-ai/ai-markdown';
import { AskAiButton } from '@/components/futty-ai/ask-ai-button';
import { AttachButton, AttachmentStrip } from '@/components/futty-ai/attachments';
import { clampZoom, PhotoViewer } from '@/components/futty-ai/photo-viewer';
import { QuickReplies } from '@/components/futty-ai/quick-replies';
import { TypingIndicator } from '@/components/futty-ai/typing-indicator';
import { loadWithFile } from '@/components/ui/test-utils';
import { colors } from '@/constants/futty-theme';
import { actionButtons } from '@/lib/futty-ai';

loadWithFile(Modal);

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-premium-player', () => ({ usePremiumPlayer: () => false }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));

/** Every piece of text on screen, joined. */
function allText(): string {
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') parts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object' && 'children' in node) walk((node as { children: unknown }).children);
  };
  walk(screen.toJSON());
  return parts.join('');
}

beforeEach(() => jest.clearAllMocks());

describe('AiMarkdown', () => {
  it('bold, bullet and numbered lists, line breaks; never an asterisk', async () => {
    await render(<AiMarkdown text={'**Book** a pitch:\n1. Pick a time\n2. Pay\n\n- one *stray\n- two**'} />);
    expect(screen.getByText('Book')).toBeTruthy();
    expect(screen.getAllByTestId('ai-numbered')).toHaveLength(2);
    expect(screen.getAllByTestId('ai-bullet')).toHaveLength(2);
    expect(allText()).not.toContain('*');
  });

  it('a link opens, underlined, in the text colour', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<AiMarkdown text="See the [Terms](https://futty.app/terms/)." />);
    const link = screen.getByTestId('ai-link');
    expect(StyleSheet.flatten(link.props.style).textDecorationLine).toBe('underline');
    await fireEvent.press(link);
    expect(open).toHaveBeenCalledWith('https://futty.app/terms/');
  });
});

describe('AiChatHeader', () => {
  it('on night: back, the logo, "Futty AI" and when it started', async () => {
    const onBack = jest.fn();
    await render(<AiChatHeader started="Started 20 Nov at 17:53" onBack={onBack} />);
    expect(StyleSheet.flatten(screen.getByTestId('ai-chat-header').props.style).backgroundColor).toBe(colors.night);
    expect(screen.getByTestId('futty-logo-basic')).toBeTruthy();
    expect(screen.getByText('Futty AI')).toBeTruthy();
    expect(screen.getByText('Started 20 Nov at 17:53')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('a new chat has no start line yet', async () => {
    await render(<AiChatHeader started={null} onBack={jest.fn()} />);
    expect(screen.queryByTestId('ai-chat-started')).toBeNull();
  });
});

describe('AiAnswer', () => {
  it('on the left with the logo as avatar, then its action buttons', async () => {
    const onAction = jest.fn();
    await render(
      <AiAnswer body="Tap **Book a pitch**." actions={actionButtons(['book', 'contact_support'])} showAvatar firstInGroup onAction={onAction} />
    );
    expect(screen.getByTestId('ai-avatar')).toBeTruthy();
    expect(screen.getByTestId('futty-logo-basic')).toBeTruthy();
    expect(allText()).not.toContain('*');
    await fireEvent.press(screen.getByRole('button', { name: 'Book a pitch' }));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ tag: 'book', href: '/book' }));
    expect(screen.getByTestId('ai-action-contact-support')).toBeTruthy();
  });

  it('no avatar inside a run, no buttons without actions', async () => {
    await render(<AiAnswer body="Ok" actions={[]} showAvatar={false} firstInGroup={false} onAction={jest.fn()} />);
    expect(screen.queryByTestId('ai-avatar')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('MyAiMessage', () => {
  it('green with greenInk text, its photos open full screen, "Sent · Just now" under it', async () => {
    const onOpenPhoto = jest.fn();
    await render(
      <MyAiMessage
        body="What is this?"
        photos={[{ key: 'a', uri: 'file:///a.jpg' }, { key: 'b', uri: null }]}
        sent="Sent · Just now"
        firstInGroup
        onOpenPhoto={onOpenPhoto}
      />
    );
    const text = screen.getByText('What is this?');
    expect(StyleSheet.flatten(text.props.style).color).toBe(colors.greenInk);
    expect(screen.getByText('Sent · Just now')).toBeTruthy();
    const photos = screen.getAllByTestId('ai-photo');
    expect(photos).toHaveLength(2);
    await fireEvent.press(photos[0]);
    expect(onOpenPhoto).toHaveBeenCalledWith('file:///a.jpg');
  });

  it('not sent: says so instead of "Sent"', async () => {
    await render(<MyAiMessage body="Hi" photos={[]} sent={null} pending="failed" firstInGroup onOpenPhoto={jest.fn()} />);
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(screen.queryByTestId('ai-sent')).toBeNull();
  });
});

describe('PhotoViewer', () => {
  it('full screen with a close button; nothing when no photo', async () => {
    const onClose = jest.fn();
    const { rerender } = await render(<PhotoViewer uri="file:///a.jpg" onClose={onClose} />);
    expect(screen.getByTestId('ai-photo-full')).toBeTruthy();
    expect(screen.getByLabelText('Photo. Pinch to zoom.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close photo' }));
    expect(onClose).toHaveBeenCalled();
    await rerender(<PhotoViewer uri={null} onClose={onClose} />);
    expect(screen.queryByTestId('ai-photo-full')).toBeNull();
  });

  it('zoom stays between 1x and 4x', () => {
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
    expect(clampZoom(9)).toBe(4);
  });
});

describe('the rest', () => {
  it('typing: the logo and a label for VoiceOver', async () => {
    await render(<TypingIndicator />);
    expect(screen.getByLabelText('Futty AI is typing')).toBeTruthy();
  });

  it('quick replies: the four chips; tapping one sends it', async () => {
    const onPick = jest.fn();
    await render(<QuickReplies onPick={onPick} />);
    for (const q of ['Book a pitch', 'Cancel a booking', 'How do payments work?', 'Premium']) {
      expect(screen.getByRole('button', { name: q })).toBeTruthy();
    }
    await fireEvent.press(screen.getByTestId('ai-quick-how-do-payments-work'));
    expect(onPick).toHaveBeenCalledWith('How do payments work?');
  });

  it('attach: a labelled button, off once the message has 3 photos', async () => {
    const onPress = jest.fn();
    await render(<AttachButton onPress={onPress} disabled />);
    const button = screen.getByRole('button', { name: 'Attach photos' });
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('the photos about to be sent can be removed', async () => {
    const onRemove = jest.fn();
    await render(<AttachmentStrip uris={['file:///a.jpg', 'file:///b.jpg']} onRemove={onRemove} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Remove photo 2' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('no photos: no strip', async () => {
    await render(<AttachmentStrip uris={[]} onRemove={jest.fn()} />);
    expect(screen.queryByTestId('ai-attachments')).toBeNull();
  });

  it('the "?" opens a new chat', async () => {
    await render(<AskAiButton testID="book-ask-ai" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Ask Futty AI' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/futty-ai/[id]', params: { id: 'new' } });
  });
});
