// S13A: deleting Futty AI chats with their photos (the ai-chat-photos
// bucket). Photos go first, since their paths are only known from the chats'
// messages. Used by the daily futty-ai-cleanup job (chats quiet for 7 days,
// public.ai_chats_expired) and by delete-account.

/** Storage removes at most this many files per call. */
export const PHOTO_BATCH = 100;

export type AiChatToDelete = { chat_id: string; photo_paths: string[] };

export type AiChatsDeps = {
  removePhotos(paths: string[]): Promise<void>;
  deleteChats(chatIds: string[]): Promise<void>;
};

export type AiChatsDeleted = { deleted: number; photoError: string | null };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Removes the chats' photos, then the chats (their messages go with them).
 * When a photo can't be removed, the cleanup keeps the chats so it tries
 * again the next day; account deletion deletes them anyway.
 */
export async function deleteAiChats(
  deps: AiChatsDeps,
  chats: AiChatToDelete[],
  { keepChatsIfPhotosFail }: { keepChatsIfPhotosFail: boolean },
): Promise<AiChatsDeleted> {
  if (chats.length === 0) return { deleted: 0, photoError: null };
  const paths = chats.flatMap((c) => c.photo_paths);
  let photoError: string | null = null;
  try {
    for (let i = 0; i < paths.length; i += PHOTO_BATCH) await deps.removePhotos(paths.slice(i, i + PHOTO_BATCH));
  } catch (err) {
    photoError = message(err);
    if (keepChatsIfPhotosFail) return { deleted: 0, photoError };
  }
  await deps.deleteChats(chats.map((c) => c.chat_id));
  return { deleted: chats.length, photoError };
}

/** The daily cleanup: every chat quiet for longer than public.ai_chat_keep_days(), a page at a time. */
export async function deleteExpiredAiChats(
  deps: AiChatsDeps & { expired(limit: number): Promise<AiChatToDelete[]> },
  pageSize = 200,
): Promise<AiChatsDeleted> {
  let deleted = 0;
  for (;;) {
    const page = await deps.expired(pageSize);
    const result = await deleteAiChats(deps, page, { keepChatsIfPhotosFail: true });
    deleted += result.deleted;
    if (result.photoError) return { deleted, photoError: result.photoError };
    if (page.length < pageSize) return { deleted, photoError: null };
  }
}
