import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Modal } from 'react-native';

import { ChatBubble } from '@/components/messages/chat-bubble';
import { ChatHeader } from '@/components/messages/chat-header';
import { ChatInput } from '@/components/messages/chat-input';
import { DatePill } from '@/components/messages/date-pill';
import { InboxRow } from '@/components/messages/inbox-row';
import { NewMessagesPill } from '@/components/messages/new-messages-pill';
import { ReportSheet } from '@/components/messages/report-sheet';
import { UnreadBadge, unreadLabel } from '@/components/messages/unread-badge';
import { flatStyle, loadWithFile } from '@/components/ui/test-utils';
import { colors, space } from '@/constants/futty-theme';
import type { InboxRow as Row } from '@/lib/messages';

loadWithFile(Modal);

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
const mockTap = jest.fn();
const mockSuccess = jest.fn();
jest.mock('@/lib/haptics', () => ({ haptic: { tap: () => mockTap(), success: () => mockSuccess(), error: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const AT = '2026-11-25T08:05:00Z'; // 10:05 in Cyprus

describe('ChatBubble', () => {
  it('mine: right, on green with greenInk text, the time and ticks inside', async () => {
    await render(<ChatBubble body="Hello" createdAt={AT} mine tick="read" firstInGroup lastInGroup />);
    const bubble = screen.getByTestId('bubble-mine');
    expect(flatStyle(bubble).backgroundColor).toBe(colors.green);
    expect(flatStyle(screen.getByText('Hello')).color).toBe(colors.greenInk);
    expect(screen.getByText('10:05')).toBeTruthy();
    expect(screen.getByTestId('tick-read')).toBeTruthy();
    expect(screen.getByLabelText('You, Hello, 10:05, Read')).toBeTruthy();
  });

  it('theirs: left, on surface, no ticks', async () => {
    await render(<ChatBubble body="Hi" createdAt={AT} mine={false} firstInGroup lastInGroup />);
    expect(flatStyle(screen.getByTestId('bubble-theirs')).backgroundColor).toBe(colors.surface);
    expect(screen.queryByTestId(/^tick-/)).toBeNull();
  });

  it('the tail only on the last of a run', async () => {
    await render(<ChatBubble body="a" createdAt={AT} mine firstInGroup={false} lastInGroup />);
    expect(flatStyle(screen.getByTestId('bubble-mine')).borderBottomRightRadius).toBe(space.xs);
    await render(<ChatBubble body="a" createdAt={AT} mine firstInGroup lastInGroup={false} />);
    expect(flatStyle(screen.getByTestId('bubble-mine')).borderBottomRightRadius).toBeUndefined();
    await render(<ChatBubble body="a" createdAt={AT} mine={false} firstInGroup lastInGroup />);
    expect(flatStyle(screen.getByTestId('bubble-theirs')).borderBottomLeftRadius).toBe(space.xs);
  });

  it.each(['sending', 'sent', 'delivered', 'read'] as const)('%s: its tick', async (tick) => {
    await render(<ChatBubble body="a" createdAt={AT} mine tick={tick} firstInGroup lastInGroup />);
    expect(screen.getByTestId(`tick-${tick}`)).toBeTruthy();
  });

  it('delivered and read differ in shape, not only colour', async () => {
    await render(<ChatBubble body="a" createdAt={AT} mine tick="delivered" firstInGroup lastInGroup />);
    expect(screen.getAllByTestId('icon-checkmark')).toHaveLength(2);
    await render(<ChatBubble body="a" createdAt={AT} mine tick="read" firstInGroup lastInGroup />);
    expect(screen.getByTestId('icon-checkmark.circle.fill')).toBeTruthy();
  });

  it('failed: one line, and a tap sends it again', async () => {
    const onRetry = jest.fn();
    await render(<ChatBubble body="a" createdAt={AT} mine tick="failed" firstInGroup lastInGroup onRetry={onRetry} />);
    expect(screen.getByText('Not sent. Tap to retry.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('bubble-mine'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('long press opens Copy and Report', async () => {
    const onLongPress = jest.fn();
    await render(<ChatBubble body="a" createdAt={AT} mine={false} firstInGroup lastInGroup onLongPress={onLongPress} />);
    await fireEvent(screen.getByTestId('bubble-theirs'), 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByTestId('bubble-theirs'), 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    expect(onLongPress).toHaveBeenCalledTimes(2);
  });
});

describe('ChatInput', () => {
  beforeEach(() => {
    mockTap.mockClear();
    mockSuccess.mockClear();
  });

  it('the round send button only once there is text', async () => {
    await render(<ChatInput onSend={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Message'), '   ');
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Message'), 'hi');
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('sends the trimmed text, clears at once, and taps', async () => {
    const onSend = jest.fn().mockResolvedValue(true);
    await render(<ChatInput onSend={onSend} />);
    await fireEvent.changeText(screen.getByLabelText('Message'), '  hi there ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('hi there');
    expect(screen.getByLabelText('Message').props.value).toBe('');
    expect(mockTap).toHaveBeenCalled();
    await waitFor(() => expect(mockSuccess).toHaveBeenCalled());
  });

  it('keepOnFailure puts the text back when the send fails', async () => {
    await render(<ChatInput onSend={() => Promise.resolve(false)} keepOnFailure />);
    await fireEvent.changeText(screen.getByLabelText('Message'), 'hi');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByLabelText('Message').props.value).toBe('hi'));
  });

  it('without it, the text stays cleared (the failed bubble has the retry)', async () => {
    await render(<ChatInput onSend={() => Promise.resolve(false)} />);
    await fireEvent.changeText(screen.getByLabelText('Message'), 'hi');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await act(() => Promise.resolve());
    expect(screen.getByLabelText('Message').props.value).toBe('');
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it('over 1000 characters: one line, no send button', async () => {
    await render(<ChatInput onSend={jest.fn()} />);
    await fireEvent.changeText(screen.getByLabelText('Message'), 'a'.repeat(1001));
    expect(screen.getByText('Keep it to 1000 characters or fewer.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('grows to five lines, then scrolls', async () => {
    await render(<ChatInput onSend={jest.fn()} />);
    const input = screen.getByLabelText('Message');
    expect(input.props.multiline).toBe(true);
    expect(flatStyle(input).maxHeight).toBeGreaterThan(flatStyle(input).minHeight as number);
  });

  it('disabled: no send', async () => {
    await render(<ChatInput onSend={jest.fn()} disabled />);
    await fireEvent.changeText(screen.getByLabelText('Message'), 'hi');
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });
});

describe('DatePill, NewMessagesPill, UnreadBadge', () => {
  it('the date pill shows its label', async () => {
    await render(<DatePill label="Yesterday" />);
    expect(screen.getByText('Yesterday')).toBeTruthy();
  });

  it('new messages: hidden at 0, singular and plural, tap scrolls down', async () => {
    const onPress = jest.fn();
    await render(<NewMessagesPill count={0} onPress={onPress} />);
    expect(screen.queryByTestId('chat-new-messages')).toBeNull();
    await render(<NewMessagesPill count={1} onPress={onPress} />);
    expect(screen.getByText('1 new message')).toBeTruthy();
    await render(<NewMessagesPill count={3} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: '3 new messages' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('the badge: nothing at 0, 99+ past 99', async () => {
    await render(<UnreadBadge count={0} testID="b" />);
    expect(screen.queryByTestId('b', { includeHiddenElements: true })).toBeNull();
    await render(<UnreadBadge count={150} testID="b" />);
    expect(screen.getByText('99+', { includeHiddenElements: true })).toBeTruthy();
    expect(unreadLabel(0)).toBeNull();
    expect(unreadLabel(2)).toBe('2 unread');
  });
});

describe('ChatHeader', () => {
  it('back, the name with the team under it, and more', async () => {
    const onBack = jest.fn();
    const onOpenTitle = jest.fn();
    const onOpenSubtitle = jest.fn();
    const onMore = jest.fn();
    await render(
      <ChatHeader title="Ben" subtitle="Lions" onBack={onBack} onOpenTitle={onOpenTitle} onOpenSubtitle={onOpenSubtitle} onMore={onMore} />
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ben, Lions' }));
    await fireEvent.press(screen.getByText('Lions'));
    await fireEvent.press(screen.getByRole('button', { name: 'More' }));
    expect([onBack, onOpenTitle, onOpenSubtitle, onMore].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);
  });

  it('no menu without onMore, no team line without a team', async () => {
    await render(<ChatHeader title="Tigers vs Lions" onBack={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByTestId('chat-header-team')).toBeNull();
  });
});

describe('InboxRow', () => {
  const row: Row = {
    id: 'c1',
    kind: 'captains',
    title: 'Ben',
    subtitle: 'Lions',
    other_profile_id: 'p2',
    other_team_id: 't2',
    avatar_style: 'initials',
    avatar_kit_colour: null,
    avatar_number: null,
    last_body: 'See you Friday',
    last_at: '2026-11-25T08:05:00Z',
    last_mine: false,
    unread: 2,
  };
  const now = new Date('2026-11-25T12:00:00Z');

  it('name, team, last message, time and unread; opens the chat and the profile', async () => {
    const onOpen = jest.fn();
    const onOpenProfile = jest.fn();
    await render(<InboxRow row={row} onOpen={onOpen} onOpenProfile={onOpenProfile} now={now} />);
    expect(screen.getByText('Ben')).toBeTruthy();
    expect(screen.getByText('Lions')).toBeTruthy();
    expect(screen.getByText('See you Friday')).toBeTruthy();
    expect(screen.getByText('10:05')).toBeTruthy();
    expect(screen.getByTestId('inbox-unread-c1', { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ben, Lions, See you Friday, 10:05, 2 unread' }));
    expect(onOpen).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Ben, profile' }));
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it('my last message starts with "You:", no badge when read', async () => {
    await render(<InboxRow row={{ ...row, last_mine: true, unread: 0 }} onOpen={jest.fn()} now={now} />);
    expect(screen.getByText('You: See you Friday')).toBeTruthy();
    expect(screen.queryByTestId('inbox-unread-c1', { includeHiddenElements: true })).toBeNull();
  });
});

describe('ReportSheet', () => {
  it('Send report needs a reason; sent closes; an error stays', async () => {
    const onClose = jest.fn();
    const onSend = jest.fn().mockResolvedValueOnce('Could not send. Try again.').mockResolvedValueOnce(null);
    await render(<ReportSheet visible onClose={onClose} onSend={onSend} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(onSend).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Reason'), ' rude ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Could not send. Try again.')).toBeTruthy();
    expect(onSend).toHaveBeenCalledWith('rude');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
