// Futty AI (F9): the input stays above the keyboard, replies render their
// Markdown without raw asterisks, and since S2 there is no floating button:
// Account → Help opens the chat.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Keyboard, Platform, Pressable } from 'react-native';

import { chatKeyboardProps, FuttyAiChat } from '@/components/futty-ai-chat';
import { POPUP_HEADER_HEIGHT } from '@/components/popup-modal';


const mockSend = jest.fn();
jest.mock('@/lib/futty-ai', () => ({ sendFuttyAiMessage: (...a: unknown[]) => mockSend(...a) }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const originalOS = Platform.OS;
beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
});
afterAll(() => {
  Platform.OS = originalOS;
});

/** What Help does: a row that opens the chat (app/account/help.tsx). */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Ask Futty AI" onPress={() => setOpen(true)} />
      <FuttyAiChat visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

async function openChat() {
  await render(<Harness />);
  await fireEvent.press(screen.getByRole('button', { name: 'Ask Futty AI' }));
}

describe('the input stays visible above the keyboard', () => {
  it.each([['ios', 'padding'], ['android', 'height']] as const)(
    'on %s the keyboard view offsets by the safe area and the popup header',
    (os, behavior) => {
      expect(chatKeyboardProps(os, 47)).toEqual({ behavior, keyboardVerticalOffset: 47 + POPUP_HEADER_HEIGHT });
    }
  );

  it('listens for the keyboard while the chat is open, to scroll to the last message', async () => {
    const remove = jest.fn();
    const addListener = jest.spyOn(Keyboard, 'addListener').mockReturnValue({ remove } as never);
    await render(<Harness />);
    expect(addListener).not.toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
    await fireEvent.press(screen.getByRole('button', { name: 'Ask Futty AI' }));
    expect(addListener).toHaveBeenCalledWith('keyboardDidShow', expect.any(Function));
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(remove).toHaveBeenCalled();
  });
});

describe('replies render bold, lists and line breaks', () => {
  it('shows a reply without raw asterisks', async () => {
    mockSend.mockResolvedValue({ data: { reply: 'Two ways:\n- **Pay for everyone**\n- Pay for myself *' }, error: null });
    await openChat();
    await fireEvent.changeText(screen.getByLabelText('Message to Futty AI'), 'How do I pay?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('Pay for everyone')).toBeTruthy());
    expect(screen.getByText('Two ways:')).toBeTruthy();
    expect(screen.getAllByTestId('ai-bullet')).toHaveLength(2);
    expect(screen.queryByText(/\*/)).toBeNull();
  });

  it('my own message shows exactly what I typed', async () => {
    mockSend.mockResolvedValue({ data: { reply: 'OK' }, error: null });
    await openChat();
    await fireEvent.changeText(screen.getByLabelText('Message to Futty AI'), 'is 2*3 six?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByText('is 2*3 six?')).toBeTruthy());
  });
});

describe('no floating button (S2)', () => {
  it('renders nothing while closed: Account → Help opens it', async () => {
    await render(<FuttyAiChat visible={false} onClose={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Open Futty AI' })).toBeNull();
    expect(screen.queryByLabelText('Message to Futty AI')).toBeNull();
  });
});
