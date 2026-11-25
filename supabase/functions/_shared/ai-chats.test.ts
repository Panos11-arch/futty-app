// S13A: deleting Futty AI chats and their photos, for the daily cleanup
// (7 days after the last message) and for account deletion.
import { deepStrictEqual } from 'node:assert/strict';
import { type AiChatsDeps, deleteAiChats, deleteExpiredAiChats, PHOTO_BATCH } from './ai-chats.ts';

function fake(expired: { chat_id: string; photo_paths: string[] }[] = [], failPhotos = false) {
  const removed: string[][] = [];
  const deleted: string[][] = [];
  const deps: AiChatsDeps = {
    removePhotos: (paths) => {
      if (failPhotos) return Promise.reject(new Error('storage down'));
      removed.push(paths);
      return Promise.resolve();
    },
    deleteChats: (ids) => {
      deleted.push(ids);
      return Promise.resolve();
    },
  };
  const pages = [expired.slice(0, 2), expired.slice(2)];
  let page = 0;
  return { deps, removed, deleted, expired: () => Promise.resolve(pages[page++] ?? []) };
}

Deno.test('photos first, then the chats', async () => {
  const f = fake();
  const result = await deleteAiChats(f.deps, [
    { chat_id: 'c1', photo_paths: ['u/c1/a.jpg'] },
    { chat_id: 'c2', photo_paths: [] },
  ], { keepChatsIfPhotosFail: true });
  deepStrictEqual(result, { deleted: 2, photoError: null });
  deepStrictEqual(f.removed, [['u/c1/a.jpg']]);
  deepStrictEqual(f.deleted, [['c1', 'c2']]);
});

Deno.test('photos are removed in batches', async () => {
  const f = fake();
  const paths = Array.from({ length: PHOTO_BATCH + 1 }, (_, i) => `u/c/${i}.jpg`);
  await deleteAiChats(f.deps, [{ chat_id: 'c', photo_paths: paths }], { keepChatsIfPhotosFail: true });
  deepStrictEqual(f.removed.map((b) => b.length), [PHOTO_BATCH, 1]);
});

Deno.test('cleanup keeps the chats when their photos could not go (tried again tomorrow)', async () => {
  const f = fake([], true);
  const result = await deleteAiChats(f.deps, [{ chat_id: 'c1', photo_paths: ['u/c1/a.jpg'] }], { keepChatsIfPhotosFail: true });
  deepStrictEqual(result, { deleted: 0, photoError: 'storage down' });
  deepStrictEqual(f.deleted, []);
});

Deno.test('account deletion deletes the chats even when the photos fail', async () => {
  const f = fake([], true);
  const result = await deleteAiChats(f.deps, [{ chat_id: 'c1', photo_paths: ['u/c1/a.jpg'] }], { keepChatsIfPhotosFail: false });
  deepStrictEqual(result, { deleted: 1, photoError: 'storage down' });
  deepStrictEqual(f.deleted, [['c1']]);
});

Deno.test('nothing to delete does nothing', async () => {
  const f = fake();
  deepStrictEqual(await deleteAiChats(f.deps, [], { keepChatsIfPhotosFail: true }), { deleted: 0, photoError: null });
  deepStrictEqual(f.deleted, []);
});

Deno.test('the daily cleanup works through every expired page', async () => {
  const f = fake([
    { chat_id: 'c1', photo_paths: ['u/c1/a.jpg'] },
    { chat_id: 'c2', photo_paths: [] },
    { chat_id: 'c3', photo_paths: ['u/c3/b.jpg'] },
  ]);
  deepStrictEqual(await deleteExpiredAiChats({ ...f.deps, expired: f.expired }, 2), { deleted: 3, photoError: null });
  deepStrictEqual(f.deleted, [['c1', 'c2'], ['c3']]);
});

Deno.test('the daily cleanup stops at the first photo failure', async () => {
  const f = fake([{ chat_id: 'c1', photo_paths: ['u/c1/a.jpg'] }, { chat_id: 'c2', photo_paths: [] }, { chat_id: 'c3', photo_paths: [] }], true);
  deepStrictEqual(await deleteExpiredAiChats({ ...f.deps, expired: f.expired }, 2), { deleted: 0, photoError: 'storage down' });
});
