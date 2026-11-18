// delete-account step 2: everything linked to the account is deleted,
// saved searches included (decided 18 November). The profile is scrubbed,
// not deleted, so its cascades never fire and each table is listed.
import { deepStrictEqual } from 'node:assert/strict';

import { deleteAccountLinks, type LinksDb } from './links.ts';

/** Records each delete as "table: col=value, ..."; fails the tables named. */
function recordingDb(failing: string[] = []) {
  const deletes: string[] = [];
  const db: LinksDb = {
    from(table) {
      return {
        delete() {
          const filters: string[] = [];
          const query = {
            eq(column: string, value: string) {
              filters.push(`${column}=${value}`);
              return query;
            },
            then<T>(resolve: (r: { error: { message: string } | null }) => T) {
              deletes.push(`${table}: ${filters.join(', ')}`);
              return Promise.resolve(resolve({ error: failing.includes(table) ? { message: 'boom' } : null }));
            },
          };
          return query;
        },
      };
    },
  };
  return { db, deletes };
}

Deno.test('deletes the account’s links, saved searches included', async () => {
  const { db, deletes } = recordingDb();
  deepStrictEqual(await deleteAccountLinks(db, 'user-1'), []);
  deepStrictEqual(deletes, [
    'push_tokens: profile_id=user-1',
    'user_follows: follower_id=user-1',
    'user_follows: target_id=user-1, target_type=player',
    'blocked_users: blocker_id=user-1',
    'saved_searches: profile_id=user-1',
  ]);
});

Deno.test('a failed delete is reported and the rest still run', async () => {
  const { db, deletes } = recordingDb(['user_follows']);
  deepStrictEqual(await deleteAccountLinks(db, 'user-1'), [
    'user_follows.follower_id: boom',
    'user_follows.target_id: boom',
  ]);
  deepStrictEqual(deletes.at(-1), 'saved_searches: profile_id=user-1');
});
