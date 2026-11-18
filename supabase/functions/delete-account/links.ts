// Step 2 of delete-account: the rows that link other people or the app to
// the account, deleted outright. The profile itself is scrubbed, not
// deleted (stats stay under "Deleted player"), so its on-delete cascades
// never fire: everything that must go is listed here.

/** Each row to delete: the table and the column that holds the account's id. */
export const ACCOUNT_LINKS: { table: string; column: string; also?: Record<string, string> }[] = [
  { table: 'push_tokens', column: 'profile_id' },
  { table: 'user_follows', column: 'follower_id' },
  { table: 'user_follows', column: 'target_id', also: { target_type: 'player' } },
  { table: 'blocked_users', column: 'blocker_id' },
  // Saved searches (decided 18 November): a deleted player gets no alerts.
  { table: 'saved_searches', column: 'profile_id' },
];

type Filter = { eq(column: string, value: string): Filter } & PromiseLike<{ error: { message: string } | null }>;
export type LinksDb = { from(table: string): { delete(): Filter } };

/** Deletes every link, in order, carrying on past a failure (as before):
 *  returns what failed, for the log. */
export async function deleteAccountLinks(db: LinksDb, userId: string): Promise<string[]> {
  const failed: string[] = [];
  for (const link of ACCOUNT_LINKS) {
    let query = db.from(link.table).delete().eq(link.column, userId);
    for (const [column, value] of Object.entries(link.also ?? {})) query = query.eq(column, value);
    const { error } = await query;
    if (error) failed.push(`${link.table}.${link.column}: ${error.message}`);
  }
  return failed;
}
