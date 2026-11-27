// S7b: removing post photos from the post-photos bucket through the Storage
// API (storage rows can't be deleted in SQL).
//   * Daily (futty-ai-cleanup): uploads never posted, older than 24 hours
//     (public.post_photos_pending_expired).
//   * delete-account: the player's posts, comments and likes go
//     (public.delete_account_posts), then their photos and uploads.

import { PHOTO_BATCH } from './ai-chats.ts';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export type PendingPhotosDeps = {
  expired(limit: number): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
};

/** Removes every expired pending upload, a page at a time. Returns how many. */
export async function deleteExpiredPendingPhotos(deps: PendingPhotosDeps, pageSize = PHOTO_BATCH): Promise<number> {
  let removed = 0;
  for (;;) {
    const page = await deps.expired(pageSize);
    if (page.length > 0) await deps.remove(page);
    removed += page.length;
    if (page.length < pageSize) return removed;
  }
}

export type AccountPostsDeps = {
  /** public.delete_account_posts: deletes the rows, returns the storage paths. */
  deleteRows(userId: string): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
};

/**
 * The rows first (so nothing is visible any more), then the files. A file
 * that can't be removed is reported, never thrown: account deletion goes on.
 */
export async function deleteAccountPostsAndPhotos(
  deps: AccountPostsDeps,
  userId: string,
): Promise<{ photos: number; photoError: string | null }> {
  const paths = await deps.deleteRows(userId);
  try {
    for (let i = 0; i < paths.length; i += PHOTO_BATCH) await deps.remove(paths.slice(i, i + PHOTO_BATCH));
  } catch (err) {
    return { photos: paths.length, photoError: message(err) };
  }
  return { photos: paths.length, photoError: null };
}
