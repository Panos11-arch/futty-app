// Does the caller still have an upcoming game, so their account can't be
// deleted yet? Money on an upcoming game (a card hold or charge on their
// share), or an upcoming app booking they made. A walk-in or phone booking a
// venue's staff member added (booking_type 'counter') and an owner's own
// training block ('owner_block') have created_by = that person too, but
// aren't games they play: they never block deleting the account.

type Rows = { data: unknown[] | null };

/** The slice of a supabase-js query builder this check uses. */
export interface Query extends PromiseLike<Rows> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  neq(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  limit(count: number): Query;
}

export interface Db {
  from(table: string): Query;
}

/** today is the Cyprus date (cyprusToday()), as booking days are. */
export async function hasUpcomingGames(db: Db, userId: string, today: string): Promise<boolean> {
  const [{ data: activeShares }, { data: upcomingBookings }] = await Promise.all([
    db
      .from('booking_payment_shares')
      .select('id, venue_bookings!inner(booking_day, status)')
      .eq('profile_id', userId)
      .in('status', ['authorized', 'paid'])
      .gte('venue_bookings.booking_day', today)
      .neq('venue_bookings.status', 'cancelled')
      .limit(1),
    db
      .from('venue_bookings')
      .select('id')
      .eq('created_by', userId)
      .eq('booking_type', 'user_booking')
      .gte('booking_day', today)
      .neq('status', 'cancelled')
      .limit(1),
  ]);
  return (activeShares?.length ?? 0) > 0 || (upcomingBookings?.length ?? 0) > 0;
}
