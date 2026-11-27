// S7b: the only way a post or comment goes live. In order:
//   1. posts are on, the player may post (age known, not suspended or
//      banned, guidelines agreed) and is under today's limit: checked first,
//      so a refused post costs nothing;
//   2. the text check (word list, then the model);
//   3. the photo check (Google Cloud Vision SafeSearch) on each photo the
//      app uploaded to post-photos/pending/<their id>/;
//   4. the photos are moved to posts/<post id>/<n>.jpg and the post is
//      written (create_post_internal), or the comment (add_comment_internal).
// Flagged text or a flagged photo: nothing is posted, the founders get a
// flag, and the app shows one line. A check that fails or times out: nothing
// is posted ("Try again later"). Every rule is checked again in SQL.

import { type Db, DbError, rpc } from '../_shared/db.ts';
import { CheckUnavailable, checkText, type TextModel } from '../_shared/text-check.ts';
import { safeSearchAllows, type Vision } from '../_shared/vision.ts';

export type PostPhotoStorage = {
  /** The file's bytes, or null if there's no such file. */
  download(path: string): Promise<Uint8Array | null>;
  move(from: string, to: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
};

export type Deps = {
  /** The database, as the service role. */
  db: Db;
  textModel: TextModel;
  vision: Vision;
  storage: PostPhotoStorage;
  newId(): string;
};

export type Result = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown>): Result => ({ status: 200, body });
const fail = (status: number, error: string): Result => ({ status, body: { error } });

// What a database refusal means for the app.
const STATUS: Record<string, number> = {
  posts_disabled: 403,
  account_banned: 403,
  account_suspended: 403,
  too_young: 403,
  date_of_birth_required: 403,
  guidelines_required: 403,
  daily_limit: 429,
  post_not_found: 404,
  followers_only: 403,
  community_mismatch: 403,
  audience_not_allowed: 400,
  minor_photos_refused: 400,
  city_required: 400,
  invalid_audience: 400,
  match_not_shareable: 400,
  post_empty: 400,
  body_too_long: 400,
  comment_length: 400,
  too_many_photos: 400,
};

function refused(err: unknown): Result {
  if (err instanceof DbError && err.message in STATUS) return fail(STATUS[err.message], err.message);
  throw err;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A photo the caller uploaded: pending/<their id>/<name>.jpg, nothing else. */
function isOwnPending(userId: string, path: unknown): path is string {
  return typeof path === 'string' && new RegExp(`^pending/${userId}/[A-Za-z0-9_-]{1,64}\\.jpg$`).test(path);
}

async function textPasses(deps: Deps, userId: string, kind: 'post' | 'comment', text: string | null): Promise<Result | null> {
  if (!text) return null;
  let verdict;
  try {
    verdict = await checkText(deps.textModel, text);
  } catch (err) {
    if (err instanceof CheckUnavailable) {
      console.error('community-post: text check unavailable:', err.message);
      return fail(503, 'check_unavailable');
    }
    throw err;
  }
  if (verdict.allowed) return null;
  await rpc(deps.db, 'record_check_flag', {
    p_profile_id: userId,
    p_kind: 'auto_text',
    p_details: { text, kind, source: verdict.source, category: verdict.category },
  });
  return fail(422, 'text_flagged');
}

export async function handle(deps: Deps, userId: string, request: unknown): Promise<Result> {
  if (!request || typeof request !== 'object') return fail(400, 'invalid_request');
  const req = request as Record<string, unknown>;
  const kind = req.kind;
  if (kind !== 'post' && kind !== 'comment') return fail(400, 'invalid_request');
  const body = typeof req.body === 'string' ? req.body.trim() || null : null;

  // 1. The cheap checks first.
  try {
    await rpc(deps.db, 'assert_posts_enabled');
    await rpc(deps.db, 'assert_can_interact', { p_profile_id: userId, p_needs_guidelines: true });
    await rpc(deps.db, 'assert_daily_limit', { p_profile_id: userId, p_kind: kind });
  } catch (err) {
    return refused(err);
  }

  if (kind === 'comment') {
    const postId = req.post_id;
    if (typeof postId !== 'string' || !UUID.test(postId)) return fail(400, 'invalid_request');
    if (!body || body.length > 500) return fail(400, 'comment_length');
    const flagged = await textPasses(deps, userId, 'comment', body);
    if (flagged) return flagged;
    try {
      const id = await rpc<string>(deps.db, 'add_comment_internal', { p_author: userId, p_post_id: postId, p_body: body });
      return ok({ comment_id: id });
    } catch (err) {
      return refused(err);
    }
  }

  // A post.
  const photos = req.photo_paths ?? [];
  if (!Array.isArray(photos) || photos.length > 4 || !photos.every((p) => isOwnPending(userId, p))) {
    return fail(400, 'invalid_photos');
  }
  if (new Set(photos).size !== photos.length) return fail(400, 'invalid_photos');
  const matchId = req.match_id ?? null;
  if (matchId !== null && (typeof matchId !== 'string' || !UUID.test(matchId))) return fail(400, 'invalid_request');
  if (typeof req.audience !== 'string') return fail(400, 'invalid_audience');
  if (body && body.length > 1000) return fail(400, 'body_too_long');
  if (!body && photos.length === 0 && !matchId) return fail(400, 'post_empty');

  // 2. The text.
  const flagged = await textPasses(deps, userId, 'post', body);
  if (flagged) return flagged;

  // 3. The photos.
  for (const path of photos as string[]) {
    const bytes = await deps.storage.download(path);
    if (!bytes) return fail(400, 'photo_missing');
    let allowed: boolean;
    try {
      allowed = safeSearchAllows(await deps.vision(base64(bytes)));
    } catch (err) {
      console.error('community-post: photo check unavailable:', err instanceof Error ? err.message : err);
      return fail(503, 'check_unavailable');
    }
    if (!allowed) {
      await rpc(deps.db, 'record_check_flag', { p_profile_id: userId, p_kind: 'auto_image', p_details: { path, kind: 'post' } });
      // The refused photo and the others: nothing of this post is kept.
      await deps.storage.remove(photos as string[]).catch(() => {});
      return fail(422, 'photo_flagged');
    }
  }

  // 4. Move the photos, then write the post.
  const postId = deps.newId();
  const moved: string[] = [];
  try {
    for (const [n, path] of (photos as string[]).entries()) {
      const to = `posts/${postId}/${n}.jpg`;
      await deps.storage.move(path, to);
      moved.push(to);
    }
  } catch (err) {
    console.error('community-post: photo move failed:', err instanceof Error ? err.message : err);
    await deps.storage.remove(moved).catch(() => {});
    return fail(503, 'check_unavailable');
  }
  try {
    const id = await rpc<string>(deps.db, 'create_post_internal', {
      p_author: userId,
      p_post_id: postId,
      p_body: body,
      p_audience: req.audience,
      p_match_id: matchId,
      p_photo_count: photos.length,
    });
    return ok({ post_id: id });
  } catch (err) {
    await deps.storage.remove(moved).catch(() => {});
    return refused(err);
  }
}
