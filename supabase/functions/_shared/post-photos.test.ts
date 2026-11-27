// S7b: unposted photos are removed after 24 hours (the daily job), and a
// deleted account's post photos and uploads are removed.
import { deepStrictEqual, rejects } from 'node:assert/strict';

import { deleteAccountPostsAndPhotos, deleteExpiredPendingPhotos } from './post-photos.ts';

Deno.test('the daily job removes every expired upload, page by page', async () => {
  const pending = Array.from({ length: 5 }, (_, i) => `pending/u/${i}.jpg`);
  const removed: string[][] = [];
  const count = await deleteExpiredPendingPhotos({
    expired: (limit) => Promise.resolve(pending.splice(0, limit)),
    remove: (paths) => {
      removed.push(paths);
      return Promise.resolve();
    },
  }, 2);
  deepStrictEqual(count, 5);
  deepStrictEqual(removed, [['pending/u/0.jpg', 'pending/u/1.jpg'], ['pending/u/2.jpg', 'pending/u/3.jpg'], ['pending/u/4.jpg']]);
});

Deno.test('the daily job: nothing expired, nothing removed', async () => {
  const removed: string[][] = [];
  deepStrictEqual(await deleteExpiredPendingPhotos({
    expired: () => Promise.resolve([]),
    remove: (paths) => {
      removed.push(paths);
      return Promise.resolve();
    },
  }), 0);
  deepStrictEqual(removed, []);
});

Deno.test('the daily job: a failed remove fails the run (tried again tomorrow)', async () => {
  await rejects(() => deleteExpiredPendingPhotos({
    expired: () => Promise.resolve(['pending/u/a.jpg']),
    remove: () => Promise.reject(new Error('storage down')),
  }), /storage down/);
});

Deno.test('account deletion: rows first, then the photos', async () => {
  const order: string[] = [];
  const result = await deleteAccountPostsAndPhotos({
    deleteRows: (id) => {
      order.push(`rows ${id}`);
      return Promise.resolve(['posts/p/0.jpg', 'pending/u/a.jpg']);
    },
    remove: (paths) => {
      order.push(`remove ${paths.join(',')}`);
      return Promise.resolve();
    },
  }, 'u');
  deepStrictEqual(result, { photos: 2, photoError: null });
  deepStrictEqual(order, ['rows u', 'remove posts/p/0.jpg,pending/u/a.jpg']);
});

Deno.test('account deletion: a photo that can’t be removed is reported, not thrown', async () => {
  deepStrictEqual(await deleteAccountPostsAndPhotos({
    deleteRows: () => Promise.resolve(['posts/p/0.jpg']),
    remove: () => Promise.reject(new Error('storage down')),
  }, 'u'), { photos: 1, photoError: 'storage down' });
});
