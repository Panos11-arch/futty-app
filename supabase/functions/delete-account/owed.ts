// How much the caller owes, so their account can't be deleted yet (spec 13
// "Deleting an account", decided by Panos on 19 November). It reads the same
// source as the Payments "You owe" screen and the Home owed banner
// (public.my_owed().debt_cents): every unsettled debt in venue_debts, to a
// venue or to Futty. A failed payment that is still owed is a debt there too
// (unpaid shares, failed top-ups, guarantees not held, unpaid cash after
// collection). The amount is the server's own integer cents.

type Rows = { data: { amount_cents: number }[] | null; error: unknown };

/** The slice of a supabase-js query builder this check uses. */
export interface Query extends PromiseLike<Rows> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
}

export interface Db {
  from(table: string): Query;
}

/** The player's unsettled debts in cents, or null if they can't be read. */
export async function owedCents(db: Db, userId: string): Promise<number | null> {
  const { data, error } = await db
    .from('venue_debts')
    .select('amount_cents')
    .eq('profile_id', userId)
    .is('settled_at', null);
  if (error || !data) return null;
  return data.reduce((total, row) => total + row.amount_cents, 0);
}
