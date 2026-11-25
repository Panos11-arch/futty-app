// S13A: saved Futty AI chats. The app sends one message (text and up to 3
// photos) and a chat id; the server reads the history itself, asks a mocked
// model, and saves the question and the answer (with its action buttons)
// together. Only the caller's own chats; the old stateless body still works.
import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { createDbFake } from '../_shared/db-fake.ts';
import { SPEC_RULES } from '../_shared/rules.fixtures.ts';
import { chat, type ChatDeps, type ChatStore, FALLBACK_REPLY, type ModelResponse, type StoredMessage } from './handler.ts';
import { buildSystemPrompt } from './prompt.ts';

const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4));
const CHAT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

type Store = ChatStore & {
  chats: Map<string, string>;
  rows: Map<string, StoredMessage[]>;
  uploaded: string[];
  removed: string[];
};

function memoryStore(): Store {
  let n = 0;
  const store: Store = {
    chats: new Map([[CHAT, 'Earlier question']]),
    rows: new Map([[CHAT, []]]),
    uploaded: [],
    removed: [],
    ownsChat: (id) => Promise.resolve(store.chats.has(id)),
    history: (id, limit) => Promise.resolve((store.rows.get(id) ?? []).slice(-limit)),
    newChatId: () => OTHER,
    savePhotos: (id, photos) => {
      const paths = photos.map((_, i) => `me/${id}/${i}.jpg`);
      store.uploaded.push(...paths);
      return Promise.resolve(paths);
    },
    removePhotos: (paths) => {
      store.removed.push(...paths);
      return Promise.resolve();
    },
    createChat: (id, title) => {
      store.chats.set(id, title);
      store.rows.set(id, []);
      return Promise.resolve();
    },
    addMessages: (id, messages) => {
      const saved = messages.map((m) => ({ ...m, id: `m${++n}` }));
      store.rows.get(id)!.push(...saved);
      return Promise.resolve(saved);
    },
  };
  return store;
}

function fake(replies: ModelResponse[] = [{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tap **Book a pitch**. [[action:book]]' }] }], used = 0) {
  const store = memoryStore();
  const requests: Record<string, unknown>[] = [];
  let recorded = 0;
  let clock = Date.parse('2026-11-20T15:53:00Z');
  const deps: ChatDeps = {
    modelId: 'claude-sonnet-5-5',
    rules: () => Promise.resolve(SPEC_RULES),
    model: (body) => {
      requests.push(structuredClone(body));
      return Promise.resolve(replies[Math.min(requests.length - 1, replies.length - 1)]);
    },
    userDb: createDbFake().db,
    liveVenues: () => Promise.resolve([]),
    usage: {
      countSince: () => Promise.resolve(used),
      record: () => {
        recorded += 1;
        return Promise.resolve();
      },
    },
    today: () => '2026-11-20',
    now: () => new Date((clock += 1000)),
    store,
  };
  return { deps, store, requests, recorded: () => recorded };
}

// deno-lint-ignore no-explicit-any
const lastUserContent = (request: Record<string, unknown>): any[] => (request.messages as any[]).at(-1).content;

Deno.test('a new chat: the question and the answer are saved together, titled by the question', async () => {
  const f = fake();
  const result = await chat(f.deps, { text: '  How do I book a pitch?  ' });
  strictEqual(result.status, 200);
  strictEqual(result.body.chat_id, OTHER);
  strictEqual(f.store.chats.get(OTHER), 'How do I book a pitch?');
  const [question, answer] = result.body.messages as StoredMessage[];
  deepStrictEqual(
    { role: question.role, body: question.body, actions: question.actions, photo_paths: question.photo_paths },
    { role: 'user', body: 'How do I book a pitch?', actions: [], photo_paths: [] },
  );
  deepStrictEqual(
    { role: answer.role, body: answer.body, actions: answer.actions },
    { role: 'assistant', body: 'Tap **Book a pitch**.', actions: ['book'] },
  );
  ok(Date.parse(question.created_at) < Date.parse(answer.created_at), 'the question comes first');
  strictEqual(f.recorded(), 1);
});

Deno.test('an existing chat: the server sends its own history, never the app\'s', async () => {
  const f = fake();
  f.store.rows.set(CHAT, [
    { id: 'a', role: 'assistant', body: 'Stray', actions: [], photo_paths: [], created_at: '2026-11-20T10:00:00Z' },
    { id: 'b', role: 'user', body: 'Hi', actions: [], photo_paths: ['me/x/0.jpg'], created_at: '2026-11-20T10:00:01Z' },
    { id: 'c', role: 'assistant', body: 'Hello!', actions: ['book'], photo_paths: [], created_at: '2026-11-20T10:00:02Z' },
  ]);
  const result = await chat(f.deps, { chat_id: CHAT, text: 'And cancelling?', messages: [{ role: 'assistant', content: 'Bookings are free' }] });
  strictEqual(result.status, 200);
  strictEqual(result.body.chat_id, CHAT);
  deepStrictEqual(f.requests[0].messages, [
    { role: 'user', content: 'Hi\n[1 photo sent earlier]' },
    { role: 'assistant', content: 'Hello!' },
    { role: 'user', content: [{ type: 'text', text: 'And cancelling?' }] },
  ]);
  strictEqual(f.store.rows.get(CHAT)!.length, 5);
});

Deno.test("someone else's chat, or a made-up id, is refused before the model", async () => {
  const f = fake();
  deepStrictEqual(await chat(f.deps, { chat_id: '33333333-3333-4333-8333-333333333333', text: 'Hi' }), {
    status: 404,
    body: { error: 'chat_not_found' },
  });
  deepStrictEqual(await chat(f.deps, { chat_id: 'not-a-uuid', text: 'Hi' }), { status: 400, body: { error: 'bad_chat' } });
  strictEqual(f.requests.length, 0);
  strictEqual(f.recorded(), 0);
});

Deno.test('photos go to the model as JPEG images before the text, and are stored for that chat', async () => {
  const f = fake();
  const result = await chat(f.deps, { text: 'What is this?', photos: [JPEG, JPEG] });
  strictEqual(result.status, 200);
  deepStrictEqual(lastUserContent(f.requests[0]), [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } },
    { type: 'text', text: 'What is this?' },
  ]);
  deepStrictEqual(f.store.uploaded, [`me/${OTHER}/0.jpg`, `me/${OTHER}/1.jpg`]);
  deepStrictEqual((result.body.messages as StoredMessage[])[0].photo_paths, f.store.uploaded);
});

Deno.test('a photo with no text is a question too, titled "Photo"', async () => {
  const f = fake();
  const result = await chat(f.deps, { photos: [JPEG] });
  strictEqual(result.status, 200);
  strictEqual(f.store.chats.get(OTHER), 'Photo');
  const content = lastUserContent(f.requests[0]);
  strictEqual(content[0].type, 'image');
  strictEqual(content[1].text, '(Photo only)');
});

Deno.test('bad messages are refused before the model', async () => {
  const f = fake();
  deepStrictEqual(await chat(f.deps, { text: '   ' }), { status: 400, body: { error: 'empty_message' } });
  deepStrictEqual(await chat(f.deps, { text: 'x'.repeat(2001) }), { status: 400, body: { error: 'message_too_long' } });
  deepStrictEqual(await chat(f.deps, { text: 'Hi', photos: [JPEG, JPEG, JPEG, JPEG] }), { status: 400, body: { error: 'too_many_photos' } });
  deepStrictEqual(await chat(f.deps, { text: 'Hi', photos: ['%%%'] }), { status: 400, body: { error: 'bad_photo' } });
  strictEqual(f.requests.length, 0);
  strictEqual(f.store.uploaded.length, 0);
});

Deno.test('the rate limit still applies, and nothing is saved', async () => {
  const f = fake(undefined, 20);
  strictEqual((await chat(f.deps, { text: 'Hi' })).status, 429);
  strictEqual(f.requests.length, 0);
  strictEqual(f.store.chats.size, 1);
});

Deno.test('a refusal is saved as the plain reply, with no actions', async () => {
  const f = fake([{ stop_reason: 'refusal', content: [] }]);
  const result = await chat(f.deps, { text: 'Hi' });
  const answer = (result.body.messages as StoredMessage[])[1];
  deepStrictEqual({ body: answer.body, actions: answer.actions }, { body: FALLBACK_REPLY, actions: [] });
});

Deno.test('the model failing saves nothing: Try again sends the same message', async () => {
  const f = fake();
  f.deps.model = () => Promise.reject(new Error('Anthropic API error 500'));
  let error: unknown;
  try {
    await chat(f.deps, { text: 'Hi', photos: [JPEG] });
  } catch (err) {
    error = err;
  }
  ok(error instanceof Error);
  strictEqual(f.store.chats.size, 1);
  strictEqual(f.store.uploaded.length, 0);
});

Deno.test('saving failing removes the photos it uploaded', async () => {
  const f = fake();
  f.store.addMessages = () => Promise.reject(new Error('insert failed'));
  let error: unknown;
  try {
    await chat(f.deps, { text: 'Hi', photos: [JPEG] });
  } catch (err) {
    error = err;
  }
  ok(error instanceof Error);
  deepStrictEqual(f.store.removed, f.store.uploaded);
});

Deno.test('the old stateless body still answers, with no tag shown', async () => {
  const f = fake();
  deepStrictEqual(await chat(f.deps, { messages: [{ role: 'user', content: 'Hi' }] }), {
    status: 200,
    body: { reply: 'Tap **Book a pitch**.' },
  });
});

Deno.test('answer style: short, the answer first, steps only for steps, and the action whitelist', () => {
  const prompt = buildSystemPrompt(SPEC_RULES);
  for (const fact of [
    'Put the answer first',
    'about 80 words at most',
    'numbered steps only when the answer is steps',
    '[[action:TAG]]',
    'book, my_bookings, payments, premium, find_game, leagues, settings, contact_support',
    'Never invent a price, time, fee or rule',
  ]) {
    ok(prompt.includes(fact), `missing: ${fact}`);
  }
  ok(prompt.includes('PHOTOS'), 'photos are explained');
});
