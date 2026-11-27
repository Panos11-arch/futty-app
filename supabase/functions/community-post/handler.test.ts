// S7b: community-post. Nothing goes live unless the cheap checks, the text
// check and the photo check all pass; flagged content is never written; any
// check failing means nothing is posted ("Try again later"); photos are only
// moved after every check passed. Fakes stand in for the database, storage,
// Anthropic and Google Cloud Vision.
import { deepStrictEqual, strictEqual } from 'node:assert/strict';

import { createDbFake } from '../_shared/db-fake.ts';
import { createTextModelFake, createVisionFake, SAFE } from '../_shared/moderation-fakes.ts';
import { type Deps, handle } from './handler.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const POST = '33333333-3333-4333-8333-333333333333';
const NEW_ID = '44444444-4444-4444-8444-444444444444';

function setup() {
  const db = createDbFake();
  db.respond('assert_posts_enabled', null);
  db.respond('assert_can_interact', null);
  db.respond('assert_daily_limit', null);
  db.respond('record_check_flag', 'flag-1');
  db.respond('create_post_internal', (args: Record<string, unknown>) => args.p_post_id);
  db.respond('add_comment_internal', 'comment-1');
  const text = createTextModelFake();
  const vision = createVisionFake();
  const files = new Map<string, Uint8Array>();
  const moves: [string, string][] = [];
  const removed: string[] = [];
  let moveFails = false;
  const deps: Deps = {
    db: db.db,
    textModel: text.model,
    vision: vision.vision,
    storage: {
      download: (path) => Promise.resolve(files.get(path) ?? null),
      move(from, to) {
        if (moveFails) return Promise.reject(new Error('storage down'));
        moves.push([from, to]);
        return Promise.resolve();
      },
      remove(paths) {
        removed.push(...paths);
        return Promise.resolve();
      },
    },
    newId: () => NEW_ID,
  };
  const photo = (name: string) => {
    const path = `pending/${USER}/${name}.jpg`;
    files.set(path, new TextEncoder().encode(name));
    return path;
  };
  return { db, text, vision, deps, moves, removed, photo, failMoves: () => (moveFails = true) };
}

const fns = (db: ReturnType<typeof createDbFake>) => db.calls.map((c) => c.fn);

Deno.test('a text post: checks in order, then written', async () => {
  const s = setup();
  const result = await handle(s.deps, USER, { kind: 'post', body: '  Great game  ', audience: 'everyone' });
  deepStrictEqual(result, { status: 200, body: { post_id: NEW_ID } });
  deepStrictEqual(fns(s.db), ['assert_posts_enabled', 'assert_can_interact', 'assert_daily_limit', 'create_post_internal']);
  deepStrictEqual(s.db.callsTo('assert_daily_limit')[0].args, { p_profile_id: USER, p_kind: 'post' });
  deepStrictEqual(s.db.callsTo('create_post_internal')[0].args, {
    p_author: USER, p_post_id: NEW_ID, p_body: 'Great game', p_audience: 'everyone', p_match_id: null, p_photo_count: 0,
  });
  deepStrictEqual(s.text.calls, ['Great game']);
});

Deno.test('a photo post: each photo checked, then moved, then written', async () => {
  const s = setup();
  const a = s.photo('a');
  const b = s.photo('b');
  const result = await handle(s.deps, USER, { kind: 'post', body: null, audience: 'followers', photo_paths: [a, b] });
  deepStrictEqual(result, { status: 200, body: { post_id: NEW_ID } });
  deepStrictEqual(s.vision.calls, [btoa('a'), btoa('b')]);
  deepStrictEqual(s.moves, [[a, `posts/${NEW_ID}/0.jpg`], [b, `posts/${NEW_ID}/1.jpg`]]);
  strictEqual(s.db.callsTo('create_post_internal')[0].args.p_photo_count, 2);
  deepStrictEqual(s.text.calls, [], 'no text, no text check');
});

Deno.test('a shared result', async () => {
  const s = setup();
  const match = '55555555-5555-4555-8555-555555555555';
  const result = await handle(s.deps, USER, { kind: 'post', audience: 'everyone', match_id: match });
  strictEqual(result.status, 200);
  strictEqual(s.db.callsTo('create_post_internal')[0].args.p_match_id, match);
});

Deno.test('posts off, suspended, over the limit: refused before any check runs', async () => {
  for (const [fn, code, status] of [
    ['assert_posts_enabled', 'posts_disabled', 403],
    ['assert_can_interact', 'account_suspended', 403],
    ['assert_can_interact', 'guidelines_required', 403],
    ['assert_daily_limit', 'daily_limit', 429],
  ] as const) {
    const s = setup();
    s.db.fail(fn, code);
    const a = s.photo('a');
    deepStrictEqual(await handle(s.deps, USER, { kind: 'post', body: 'Hi', audience: 'everyone', photo_paths: [a] }),
      { status, body: { error: code } });
    deepStrictEqual(s.text.calls, [], `${code}: the model is not called`);
    deepStrictEqual(s.vision.calls, [], `${code}: Vision is not called`);
    strictEqual(s.db.callsTo('create_post_internal').length, 0);
  }
});

Deno.test('flagged text: nothing posted, a flag for the founders', async () => {
  const s = setup();
  s.text.flag('harassment');
  const a = s.photo('a');
  deepStrictEqual(await handle(s.deps, USER, { kind: 'post', body: 'nasty', audience: 'everyone', photo_paths: [a] }),
    { status: 422, body: { error: 'text_flagged' } });
  deepStrictEqual(s.db.callsTo('record_check_flag')[0].args, {
    p_profile_id: USER, p_kind: 'auto_text',
    p_details: { text: 'nasty', kind: 'post', source: 'model', category: 'harassment' },
  });
  strictEqual(s.db.callsTo('create_post_internal').length, 0);
  deepStrictEqual(s.vision.calls, [], 'photos aren’t checked after the text is refused');
  deepStrictEqual(s.moves, []);
});

Deno.test('a word-list hit: refused without calling the model', async () => {
  const s = setup();
  deepStrictEqual(await handle(s.deps, USER, { kind: 'comment', post_id: POST, body: 'poutana' }),
    { status: 422, body: { error: 'text_flagged' } });
  deepStrictEqual(s.text.calls, []);
  strictEqual((s.db.callsTo('record_check_flag')[0].args.p_details as { source: string }).source, 'word_list');
  strictEqual(s.db.callsTo('add_comment_internal').length, 0);
});

Deno.test('a flagged photo: nothing posted, every pending photo removed', async () => {
  const s = setup();
  const a = s.photo('a');
  const b = s.photo('b');
  s.vision.results = [SAFE, { ...SAFE, adult: 'LIKELY' }];
  deepStrictEqual(await handle(s.deps, USER, { kind: 'post', body: 'Look', audience: 'everyone', photo_paths: [a, b] }),
    { status: 422, body: { error: 'photo_flagged' } });
  deepStrictEqual(s.db.callsTo('record_check_flag')[0].args, {
    p_profile_id: USER, p_kind: 'auto_image', p_details: { path: b, kind: 'post' },
  });
  deepStrictEqual(s.removed, [a, b]);
  deepStrictEqual(s.moves, []);
  strictEqual(s.db.callsTo('create_post_internal').length, 0);
});

Deno.test('a check that is down: nothing posted, "Try again later"', async () => {
  const s = setup();
  s.text.fail = new Error('anthropic down');
  deepStrictEqual(await handle(s.deps, USER, { kind: 'post', body: 'Hi', audience: 'everyone' }),
    { status: 503, body: { error: 'check_unavailable' } });
  strictEqual(s.db.callsTo('create_post_internal').length, 0);

  const v = setup();
  v.vision.fail = new Error('vision down');
  const a = v.photo('a');
  deepStrictEqual(await handle(v.deps, USER, { kind: 'post', body: 'Hi', audience: 'everyone', photo_paths: [a] }),
    { status: 503, body: { error: 'check_unavailable' } });
  deepStrictEqual(v.moves, []);
  strictEqual(v.db.callsTo('create_post_internal').length, 0);

  const c = setup();
  c.text.fail = new Error('timeout');
  deepStrictEqual(await handle(c.deps, USER, { kind: 'comment', post_id: POST, body: 'Hi' }),
    { status: 503, body: { error: 'check_unavailable' } });
  strictEqual(c.db.callsTo('add_comment_internal').length, 0);
});

Deno.test('photos: only the caller’s own pending uploads, at most 4', async () => {
  for (const photos of [
    [`pending/${OTHER}/a.jpg`],
    [`posts/${POST}/0.jpg`],
    [`pending/${USER}/../x.jpg`],
    [`pending/${USER}/a.png`],
    ['a', 'b', 'c', 'd', 'e'].map((n) => `pending/${USER}/${n}.jpg`),
    [`pending/${USER}/a.jpg`, `pending/${USER}/a.jpg`],
    'pending',
  ]) {
    const s = setup();
    deepStrictEqual(await handle(s.deps, USER, { kind: 'post', body: 'Hi', audience: 'everyone', photo_paths: photos }),
      { status: 400, body: { error: 'invalid_photos' } }, JSON.stringify(photos));
    deepStrictEqual(s.text.calls, []);
  }
  const s = setup();
  deepStrictEqual(await handle(s.deps, USER, { kind: 'post', audience: 'everyone', photo_paths: [`pending/${USER}/gone.jpg`] }),
    { status: 400, body: { error: 'photo_missing' } });
});

Deno.test('bad requests', async () => {
  const s = setup();
  for (const [req, error] of [
    [null, 'invalid_request'],
    [{ kind: 'story' }, 'invalid_request'],
    [{ kind: 'post', body: 'Hi' }, 'invalid_audience'],
    [{ kind: 'post', audience: 'everyone' }, 'post_empty'],
    [{ kind: 'post', body: 'x'.repeat(1001), audience: 'everyone' }, 'body_too_long'],
    [{ kind: 'post', body: 'Hi', audience: 'everyone', match_id: 'not-a-uuid' }, 'invalid_request'],
    [{ kind: 'comment', post_id: 'x', body: 'Hi' }, 'invalid_request'],
    [{ kind: 'comment', post_id: POST, body: '  ' }, 'comment_length'],
    [{ kind: 'comment', post_id: POST, body: 'x'.repeat(501) }, 'comment_length'],
  ] as const) {
    deepStrictEqual(await handle(s.deps, USER, req), { status: 400, body: { error } }, JSON.stringify(req));
  }
  deepStrictEqual(s.text.calls, [], 'nothing reached the model');
});

Deno.test('the database refuses after the checks: photos moved back out', async () => {
  const s = setup();
  s.db.fail('create_post_internal', 'minor_photos_refused');
  const a = s.photo('a');
  deepStrictEqual(await handle(s.deps, USER, { kind: 'post', body: 'Hi', audience: 'everyone', photo_paths: [a] }),
    { status: 400, body: { error: 'minor_photos_refused' } });
  deepStrictEqual(s.removed, [`posts/${NEW_ID}/0.jpg`]);
});

Deno.test('a photo can’t be moved: removed again, nothing posted', async () => {
  const s = setup();
  s.failMoves();
  const a = s.photo('a');
  deepStrictEqual(await handle(s.deps, USER, { kind: 'post', body: 'Hi', audience: 'everyone', photo_paths: [a] }),
    { status: 503, body: { error: 'check_unavailable' } });
  strictEqual(s.db.callsTo('create_post_internal').length, 0);
});

Deno.test('a comment: checked, then written', async () => {
  const s = setup();
  deepStrictEqual(await handle(s.deps, USER, { kind: 'comment', post_id: POST, body: ' Nice goal ' }),
    { status: 200, body: { comment_id: 'comment-1' } });
  deepStrictEqual(s.db.callsTo('assert_daily_limit')[0].args, { p_profile_id: USER, p_kind: 'comment' });
  deepStrictEqual(s.db.callsTo('add_comment_internal')[0].args, { p_author: USER, p_post_id: POST, p_body: 'Nice goal' });
  for (const code of ['followers_only', 'post_not_found', 'community_mismatch']) {
    const r = setup();
    r.db.fail('add_comment_internal', code);
    strictEqual((await handle(r.deps, USER, { kind: 'comment', post_id: POST, body: 'Hi' })).body.error, code);
  }
});

Deno.test('an unexpected database error is not hidden', async () => {
  const s = setup();
  s.db.fail('create_post_internal', 'boom');
  let thrown = false;
  try {
    await handle(s.deps, USER, { kind: 'post', body: 'Hi', audience: 'everyone' });
  } catch {
    thrown = true;
  }
  strictEqual(thrown, true);
});
