// How the venue dashboard's day list names each booking (app/venue-dashboard.tsx,
// until P6c replaces the screen). A walk-in or phone booking's created_by is
// the staff member who added it, so it's named by its source and customer
// (venue_counter_bookings, venue_contacts), never as that person's booking.

export type BookingRowKind = 'owner_block' | 'counter' | 'app';

export type CounterDetails = { source: 'walk_in' | 'phone'; contactName: string | null };

export function bookingRowKind(bookingType: string): BookingRowKind {
  if (bookingType === 'owner_block') return 'owner_block';
  if (bookingType === 'counter') return 'counter';
  return 'app';
}

export function bookingRowWho(row: {
  booking_type: string;
  counter: CounterDetails | null;
  teamLabel: string | null;
  playerLabel: string | null;
}): string {
  switch (bookingRowKind(row.booking_type)) {
    case 'owner_block':
      return 'Your training block';
    case 'counter': {
      if (!row.counter) return 'Walk-in or phone booking';
      const source = row.counter.source === 'walk_in' ? 'Walk-in' : 'Phone booking';
      return row.counter.contactName ? `${source} · ${row.counter.contactName}` : source;
    }
    default:
      return row.teamLabel ?? row.playerLabel ?? 'A player';
  }
}

type ContactEmbed = { name: string | null } | { name: string | null }[] | null;

/** venue_counter_bookings rows (with their venue_contacts embed) by booking id. */
export function counterDetailsByBookingId(
  rows: { booking_id: string; source: string; venue_contacts: ContactEmbed }[],
): Map<string, CounterDetails> {
  const map = new Map<string, CounterDetails>();
  for (const row of rows) {
    if (row.source !== 'walk_in' && row.source !== 'phone') continue;
    const contact = Array.isArray(row.venue_contacts) ? row.venue_contacts[0] : row.venue_contacts;
    map.set(row.booking_id, { source: row.source, contactName: contact?.name ?? null });
  }
  return map;
}
