// S13A: Futty AI chats in the app: the server calls, the action buttons
// (a fixed whitelist), Cyprus dates and times, and the support email.
import {
  actionButtons,
  aiErrorLine,
  chatDateLabel,
  fetchAiChat,
  fetchAiChats,
  photoUrls,
  QUICK_REPLIES,
  sendAiMessage,
  sentLabel,
  startedLabel,
  supportMailto,
  type AiMessage,
} from '@/lib/futty-ai';

const mockFrom = jest.fn();
const mockInvoke = jest.fn();
const mockSigned = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...a: unknown[]) => mockFrom(...a),
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    storage: { from: () => ({ createSignedUrls: (...a: unknown[]) => mockSigned(...a) }) },
  },
}));

/** A query builder that records its calls and resolves to `result`. */
function query(result: { data: unknown; error: unknown }) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'maybeSingle']) {
    builder[name] = (...a: unknown[]) => {
      calls.push([name, ...a]);
      return builder;
    };
  }
  builder.then = (resolve: (r: unknown) => void) => resolve(result);
  return { builder, calls };
}

function msg(over: Partial<AiMessage>): AiMessage {
  return { id: 'm', role: 'user', body: '', actions: [], photo_paths: [], created_at: '2026-11-20T15:53:00Z', ...over };
}

beforeEach(() => jest.clearAllMocks());

describe('the server calls', () => {
  it('chats: newest first', async () => {
    const q = query({ data: [{ id: 'c1', title: 'Hi' }], error: null });
    mockFrom.mockReturnValue(q.builder);
    expect(await fetchAiChats()).toEqual([{ id: 'c1', title: 'Hi' }]);
    expect(mockFrom).toHaveBeenCalledWith('ai_chats');
    expect(q.calls).toContainEqual(['order', 'last_message_at', { ascending: false }]);
  });

  it('chats: an error throws', async () => {
    mockFrom.mockReturnValue(query({ data: null, error: { message: 'boom' } }).builder);
    await expect(fetchAiChats()).rejects.toThrow('boom');
  });

  it('one chat: the chat and its messages, oldest first', async () => {
    const chat = query({ data: { id: 'c1', title: 'Hi', created_at: 'x', last_message_at: 'y' }, error: null });
    const messages = query({ data: [msg({ id: 'm1' })], error: null });
    mockFrom.mockImplementation((table: string) => (table === 'ai_chats' ? chat.builder : messages.builder));
    const result = await fetchAiChat('c1');
    expect(result.chat.title).toBe('Hi');
    expect(result.messages.map((m) => m.id)).toEqual(['m1']);
    expect(messages.calls).toContainEqual(['eq', 'chat_id', 'c1']);
    expect(messages.calls).toContainEqual(['order', 'created_at', { ascending: true }]);
  });

  it('one chat: gone (deleted after 7 days, or not mine) throws chat_not_found', async () => {
    mockFrom.mockImplementation((table: string) =>
      table === 'ai_chats' ? query({ data: null, error: null }).builder : query({ data: [], error: null }).builder
    );
    await expect(fetchAiChat('c1')).rejects.toThrow('chat_not_found');
  });

  it('send: one message with its photos, never the history', async () => {
    mockInvoke.mockResolvedValue({ data: { chat_id: 'c1', messages: [] }, error: null });
    expect(await sendAiMessage({ chatId: null, text: 'Hi', photos: ['abc'] })).toEqual({ chat_id: 'c1', messages: [] });
    expect(mockInvoke).toHaveBeenCalledWith('futty-ai-chat', { body: { chat_id: null, text: 'Hi', photos: ['abc'] } });
  });

  it("send: the server's refusal comes back as one line", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: { context: { status: 429, json: () => Promise.resolve({ error: 'slow down' }) } },
    });
    await expect(sendAiMessage({ chatId: 'c1', text: 'Hi', photos: [] })).rejects.toThrow(aiErrorLine(429, null));
  });

  it('photo links: signed, by path', async () => {
    mockSigned.mockResolvedValue({ data: [{ path: 'u/c/a.jpg', signedUrl: 'https://x/a' }, { path: 'u/c/b.jpg', signedUrl: null }], error: null });
    expect(await photoUrls(['u/c/a.jpg', 'u/c/b.jpg'])).toEqual({ 'u/c/a.jpg': 'https://x/a' });
    expect(await photoUrls([])).toEqual({});
  });
});

describe('error lines: what happened, what to do, one line', () => {
  it.each([
    [429, null, 'Too many messages. Try again later.'],
    [400, 'message_too_long', 'Too long. Send a shorter message.'],
    [400, 'too_many_photos', 'Up to 3 photos per message.'],
    [400, 'bad_photo', "That photo didn't work. Try another."],
    [404, 'chat_not_found', 'Chat not found. Start a new chat.'],
    [502, null, "Couldn't reach Futty AI. Try again."],
    [null, null, "Couldn't reach Futty AI. Try again."],
  ])('%s %s', (status, code, line) => {
    expect(aiErrorLine(status, code)).toBe(line);
    expect(line.split(' ').length).toBeLessThanOrEqual(10);
  });
});

describe('action buttons', () => {
  it('known tags only, at most two, labels start with a verb', () => {
    expect(actionButtons(['book', 'delete_everything', 'payments', 'premium']).map((a) => a.label)).toEqual([
      'Book a pitch',
      'View payments',
    ]);
  });

  it('each opens its screen; support is an email', () => {
    const all = actionButtons(['book', 'my_bookings']).concat(
      actionButtons(['payments', 'premium']),
      actionButtons(['find_game', 'leagues']),
      actionButtons(['settings', 'contact_support'])
    );
    expect(all.map((a) => [a.tag, a.href])).toEqual([
      ['book', '/book'],
      ['my_bookings', '/my-bookings'],
      ['payments', '/account/payments'],
      ['premium', '/account/premium'],
      ['find_game', '/squads'],
      ['leagues', '/leagues'],
      ['settings', '/account/settings'],
      ['contact_support', null],
    ]);
    for (const a of all) expect(a.label.split(' ').length).toBeLessThanOrEqual(3);
  });

  it('the quick replies', () => {
    expect(QUICK_REPLIES).toEqual(['Book a pitch', 'Cancel a booking', 'How do payments work?', 'Premium']);
  });
});

describe('Cyprus dates and times', () => {
  it('the header: "Started 20 Nov at 17:53", in Cyprus time', () => {
    expect(startedLabel('2026-11-20T15:53:00Z')).toBe('Started 20 Nov at 17:53');
    // 23:30 UTC is already the next day in Cyprus.
    expect(startedLabel('2026-11-20T23:30:00Z')).toBe('Started 21 Nov at 01:30');
  });

  it('the list: the Cyprus date, with the year only when it is not this year', () => {
    const now = new Date('2026-11-25T10:00:00Z');
    expect(chatDateLabel('2026-11-20T23:30:00Z', now)).toBe('21 Nov');
    expect(chatDateLabel('2025-12-31T23:30:00Z', now)).toBe('1 Jan');
    expect(chatDateLabel('2025-12-30T10:00:00Z', now)).toBe('30 Dec 2025');
  });

  it('under my latest message: "Sent · Just now", then minutes, then the time', () => {
    const now = new Date('2026-11-20T16:00:00Z');
    expect(sentLabel('2026-11-20T15:59:30Z', now)).toBe('Sent · Just now');
    expect(sentLabel('2026-11-20T15:55:00Z', now)).toBe('Sent · 5 min ago');
    expect(sentLabel('2026-11-20T14:00:00Z', now)).toBe('Sent · 16:00');
  });
});

describe('Contact support', () => {
  it("an email to support with the chat's text", () => {
    const url = supportMailto('How do I book?', [
      msg({ role: 'user', body: 'How do I book?', photo_paths: ['p'] }),
      msg({ role: 'assistant', body: 'Tap **Book a pitch**.' }),
    ]);
    expect(url.startsWith('mailto:support@futty.app?subject=')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('subject')).toBe('Futty AI: How do I book?');
    expect(params.get('body')).toBe('Me: How do I book?\n[1 photo]\n\nFutty AI: Tap **Book a pitch**.');
  });

  it('a long chat keeps its latest messages', () => {
    const many = Array.from({ length: 40 }, (_, i) => msg({ body: `Question ${i} ${'x'.repeat(100)}` }));
    const body = new URLSearchParams(supportMailto('Long', many).split('?')[1]).get('body') ?? '';
    expect(body.length).toBeLessThanOrEqual(1800);
    expect(body).toContain('Question 39');
    expect(body).not.toContain('Question 0 ');
  });
});
