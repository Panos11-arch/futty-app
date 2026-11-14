// The venue dashboard's Today screens (P6c; docs/specs/13-payments-bookings.md
// "Venue dashboard" and "Weather, condition warnings and blocking pitches",
// spec 05 section 12). Every read and write goes to the P6a server functions
// with ids and choices only, and every amount shown is one the server
// returned. The app never computes an amount. The one amount it sends is a
// walk-in or phone booking's price, and only when staff changed the venue's
// price (spec 13: that money never goes through Futty or Stripe).
import { describeFunctionError } from '@/lib/edge-functions';
import { cancelBooking, getCancellationQuote, type CancellationQuote } from '@/lib/booking-actions';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';

// ---- What the server returns -------------------------------------------

export type BoardPitch = { id: string; name: string; size: string | null; formats: string[]; is_open: boolean };

/** One booking on venue_day_board. 'app' is a player's booking, 'counter' a
 *  walk-in or phone booking, 'owner_block' the venue's own training slot. */
export type BoardBooking = {
  id: string;
  kind: string;
  status: string;
  start_time: string;
  end_time: string;
  format: string | null;
  capacity: number | null;
  note: string | null;
  pitch_ids: string[];
  // An app booking:
  booker_name?: string | null;
  payment_mode?: string | null;
  joined?: number;
  unpaid?: number;
  cash_to_tick?: number;
  // A walk-in or phone booking:
  source?: 'walk_in' | 'phone';
  contact_name?: string | null;
  venue_price_cents?: number | null;
  charged_cents?: number;
  paid_method?: 'cash' | 'card' | null;
};

/** A pitch (or every pitch, pitch_id null) closed to new bookings for the
 *  day (starts_at null) or a time range. */
export type BoardBlock = {
  id: string;
  pitch_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  reason: string | null;
};

/** "Conditions may be unsuitable", for a day or a time range. */
export type BoardFlag = {
  id: string;
  pitch_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
};

export type DayBoard = {
  venue_id: string;
  day: string;
  pitches: BoardPitch[];
  bookings: BoardBooking[];
  blocks: BoardBlock[];
  flags: BoardFlag[];
};

export type RosterState = 'in_app' | 'cash' | 'cash_paid' | 'unpaid' | 'covered';

export type RosterPlayer = {
  share_id: string;
  profile_id: string;
  name: string | null;
  is_booker: boolean;
  payment_method: string | null;
  state: RosterState;
  amount_cents: number;
  pitch_cents: number;
  fee_cents: number;
  cash_cents: number;
  checked_in: boolean;
};

type RosterBase = {
  booking_id: string;
  status: string;
  booking_day: string;
  start_time: string;
  end_time: string;
  format: string | null;
  capacity: number | null;
  note: string | null;
};

export type AppRoster = RosterBase & {
  kind: 'app';
  payment_mode: string | null;
  booker_name: string | null;
  match_id: string | null;
  collection_started: boolean;
  can_run_collection: boolean;
  players: RosterPlayer[];
};

export type CounterRoster = RosterBase & {
  kind: 'counter';
  source: 'walk_in' | 'phone';
  contact: { id: string; name: string; phone: string | null };
  venue_price_cents: number | null;
  charged_cents: number;
  paid_method: 'cash' | 'card' | null;
  paid_at: string | null;
  cancelled_at: string | null;
  players: [];
};

/** The venue's own training slot (or anything else with no players). */
export type OtherRoster = RosterBase & { kind: 'owner_block'; players: [] };

export type Roster = AppRoster | CounterRoster | OtherRoster;

// ---- Reads -------------------------------------------------------------

export function fetchDayBoard(venueId: string, day: string) {
  return supabase.rpc('venue_day_board', { p_venue_id: venueId, p_day: day });
}

export function fetchRoster(bookingId: string) {
  return supabase.rpc('venue_booking_roster', { p_booking_id: bookingId });
}

export type Slot = { venueId: string; day: string; start: string; end: string; format: string };

/** The venue's price for a slot, to prefill a walk-in (null: no price set). */
export function fetchSlotPrice(slot: Slot) {
  return supabase.rpc('slot_price_cents', {
    p_venue_id: slot.venueId,
    p_day: slot.day,
    p_start: slot.start,
    p_end: slot.end,
    p_format: slot.format,
  });
}

export function fetchCheckInCode(matchId: string) {
  return supabase.rpc('get_match_check_in_code', { p_match_id: matchId });
}

/** What happens to every player's money if the venue cancels. Nothing changes. */
export function fetchVenueQuote(bookingId: string) {
  return getCancellationQuote(bookingId, 'venue');
}

// ---- Writes ------------------------------------------------------------

/** Staff tick an app player's cash as paid (the server records the share's
 *  pitch part once). */
export function markCashReceived(shareId: string) {
  return supabase.rpc('mark_cash_received', { p_share_id: shareId });
}

/** Runs collection now instead of 2 hours after the game. */
export function requestCollection(bookingId: string) {
  return supabase.rpc('request_collection', { p_booking_id: bookingId });
}

export type CounterBookingInput = Slot & {
  source: 'walk_in' | 'phone';
  contactName: string;
  contactPhone: string;
  pitchId: string | null;
  /** Null unless staff changed the venue's price: the server fills it in. */
  chargedCents: number | null;
  /** Paid now at the counter, or null to mark it paid later. */
  paidMethod: 'cash' | 'card' | null;
};

export function addCounterBooking(input: CounterBookingInput) {
  return supabase.rpc('add_counter_booking', {
    p_venue_id: input.venueId,
    p_day: input.day,
    p_start: input.start,
    p_end: input.end,
    p_format: input.format,
    p_source: input.source,
    p_contact_name: input.contactName,
    p_contact_phone: blankToNull(input.contactPhone),
    p_pitch_id: input.pitchId,
    p_charged_cents: input.chargedCents,
    p_paid_method: input.paidMethod,
  });
}

export function markCounterPaid(bookingId: string, method: 'cash' | 'card') {
  return supabase.rpc('mark_counter_paid', { p_booking_id: bookingId, p_method: method });
}

export function cancelCounterBooking(bookingId: string) {
  return supabase.rpc('cancel_counter_booking', { p_booking_id: bookingId });
}

/** A day (start and end null) or a time range, on one pitch or all (null). */
export type MarkInput = {
  venueId: string;
  day: string;
  start: string | null;
  end: string | null;
  pitchId: string | null;
};

/** "Conditions may be unsuitable": the server tells every player still in
 *  each game it covers. */
export function flagConditions(input: MarkInput & { note: string | null }) {
  return supabase.rpc('flag_conditions', {
    p_venue_id: input.venueId,
    p_day: input.day,
    p_start: input.start,
    p_end: input.end,
    p_pitch_id: input.pitchId,
    p_note: blankToNull(input.note),
  });
}

export function clearConditions(flagId: string) {
  return supabase.rpc('clear_conditions', { p_flag_id: flagId });
}

export function setAllows6v6(venueId: string, allowed: boolean) {
  return supabase.rpc('set_venue_allows_6v6', { p_venue_id: venueId, p_allowed: allowed });
}

/** Closes pitches to new bookings (games already booked stay on). The
 *  venue owner's own row, through RLS ("Venue owners manage their blocks"). */
export function addBlock(input: MarkInput & { reason: string | null }, staffId: string) {
  return supabase.from('venue_blocks').insert({
    venue_id: input.venueId,
    pitch_id: input.pitchId,
    block_day: input.day,
    starts_at: input.start,
    ends_at: input.end,
    reason: blankToNull(input.reason),
    created_by: staffId,
  });
}

/** Reopens the slot to new bookings; existing bookings are never touched
 *  (spec 13, decided 14 November). */
export function removeBlock(blockId: string) {
  return supabase.from('venue_blocks').delete().eq('id', blockId);
}

export type VenueCancelResult =
  | { status: 'cancelled' }
  | { status: 'changed'; quote: CancellationQuote }
  | { status: 'error'; message: string };

/** The second tap: cancels exactly the quote shown. If what would happen has
 *  changed since, the new quote comes back to be shown and confirmed again. */
export async function confirmVenueCancel(
  bookingId: string,
  quote: string,
  deps: { quote: (bookingId: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> } = {
    quote: fetchVenueQuote,
  },
): Promise<VenueCancelResult> {
  const { error } = await cancelBooking(bookingId, { scope: 'venue', quote });
  if (!error) return { status: 'cancelled' };
  const code = await describeFunctionError(error);
  if (code !== 'quote_changed') return { status: 'error', message: describeVenueError(code) };
  const again = await deps.quote(bookingId);
  if (again.error || !again.data) {
    return { status: 'error', message: describeVenueError(again.error?.message ?? '') };
  }
  return { status: 'changed', quote: again.data as CancellationQuote };
}

function blankToNull(text: string | null): string | null {
  return text && text.trim() ? text.trim() : null;
}

// ---- Days, in Cyprus time ----------------------------------------------

const cyprusDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Nicosia',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Cyprus (YYYY-MM-DD), whatever the phone's time zone. */
export function cyprusToday(now: Date = new Date()): string {
  const parts: Record<string, string> = {};
  for (const part of cyprusDate.formatToParts(now)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayToUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(day: string, n: number): string {
  const date = dayToUtc(day);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayTitle(day: string, today: string): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  const date = dayToUtc(day);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

// ---- Labels ------------------------------------------------------------

/** '18:00:00' -> '18:00'. */
export function hhmm(time: string): string {
  return time.slice(0, 5);
}

export function kindLabel(booking: BoardBooking): string {
  if (booking.kind === 'counter') return booking.source === 'phone' ? 'Phone' : 'Walk-in';
  if (booking.kind === 'app') return 'App';
  return 'Training';
}

export function bookingTitle(booking: BoardBooking): string {
  if (booking.kind === 'counter') return booking.contact_name ?? kindLabel(booking);
  if (booking.kind === 'app') return booking.booker_name ?? 'App booking';
  return booking.note ?? 'Training';
}

/** One line under the title, with the server's amounts and counts. */
export function bookingSummary(booking: BoardBooking): string {
  if (booking.kind === 'counter') {
    const charged = booking.charged_cents ?? 0;
    if (charged === 0) return 'Free';
    return `${booking.paid_method ? `Paid ${booking.paid_method}` : 'Not paid'} · ${formatEuros(charged)}`;
  }
  if (booking.kind === 'app') {
    const parts = [`${booking.joined ?? 0} of ${booking.capacity ?? 0} in`];
    if (booking.unpaid) parts.push(`${booking.unpaid} unpaid`);
    if (booking.cash_to_tick) parts.push(`${booking.cash_to_tick} cash to tick`);
    return parts.join(' · ');
  }
  return '';
}

/** Each player's payment choice and state (spec 13 "Cash at the venue"). */
export function rosterStateLabel(state: RosterState): {
  label: string;
  tone: 'success' | 'warning' | 'inkMuted';
} {
  switch (state) {
    case 'in_app':
      return { label: 'Paid in app', tone: 'success' };
    case 'cash':
      return { label: 'Cash, not yet paid', tone: 'warning' };
    case 'cash_paid':
      return { label: 'Cash, paid', tone: 'success' };
    case 'unpaid':
      return { label: 'Unpaid', tone: 'warning' };
    case 'covered':
      return { label: 'Paid by the booker', tone: 'inkMuted' };
  }
}

type Mark = { pitch_id: string | null; starts_at: string | null; ends_at: string | null };

/** 'All pitches · All day', 'Pitch 1 · 19:00–20:30'. */
export function markLabel(board: DayBoard, mark: Mark): string {
  const pitch = mark.pitch_id
    ? board.pitches.find((p) => p.id === mark.pitch_id)?.name ?? 'A pitch'
    : 'All pitches';
  const time = mark.starts_at && mark.ends_at ? `${hhmm(mark.starts_at)}–${hhmm(mark.ends_at)}` : 'All day';
  return `${pitch} · ${time}`;
}

// ---- The calendar ------------------------------------------------------

const GRID_START = 7 * 60;
const GRID_END = 24 * 60;
const SLOT_MINUTES = 30;

/** Every half hour the calendar shows, 07:00 to 23:30, as the Book flow offers. */
export const SLOT_STARTS: string[] = Array.from({ length: (GRID_END - GRID_START) / SLOT_MINUTES }, (_, i) => {
  const minutes = GRID_START + i * SLOT_MINUTES;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

/** '18:30' -> '19:00': the end of the half-hour slot that starts then. */
export function halfHourAfter(start: string): string {
  const end = toMinutes(start) + SLOT_MINUTES;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function covers(mark: Mark, pitchId: string, start: number, end: number): boolean {
  if (mark.pitch_id !== null && mark.pitch_id !== pitchId) return false;
  if (!mark.starts_at || !mark.ends_at) return true;
  return toMinutes(mark.starts_at) < end && start < toMinutes(mark.ends_at);
}

export type CalendarCell = {
  start: string;
  free: boolean;
  blocked: BoardBlock | null;
  flagged: BoardFlag | null;
};

export type PlacedBooking = { booking: BoardBooking; row: number; span: number; flagged: boolean };

/** One pitch's day: its bookings placed by half-hour row, and each half hour
 *  with whether it's free, blocked or flagged. */
export function pitchColumn(board: DayBoard, pitchId: string): { bookings: PlacedBooking[]; cells: CalendarCell[] } {
  const onPitch = board.bookings.filter((b) => b.pitch_ids.includes(pitchId));
  const bookings = onPitch.map((booking) => {
    const start = Math.max(toMinutes(booking.start_time), GRID_START);
    const end = Math.min(toMinutes(booking.end_time), GRID_END);
    return {
      booking,
      row: (start - GRID_START) / SLOT_MINUTES,
      span: Math.max(1, Math.ceil((end - start) / SLOT_MINUTES)),
      flagged: board.flags.some((f) => covers(f, pitchId, start, end)),
    };
  });
  const cells = SLOT_STARTS.map((start) => {
    const from = toMinutes(start);
    const to = from + SLOT_MINUTES;
    return {
      start,
      free: !onPitch.some((b) => toMinutes(b.start_time) < to && from < toMinutes(b.end_time)),
      blocked: board.blocks.find((b) => covers(b, pitchId, from, to)) ?? null,
      flagged: board.flags.find((f) => covers(f, pitchId, from, to)) ?? null,
    };
  });
  return { bookings, cells };
}

/** Bookings that hold no named pitch (made before the pitch model). */
export function unassignedBookings(board: DayBoard): BoardBooking[] {
  return board.bookings.filter((b) => b.pitch_ids.length === 0);
}

// ---- The venue's cancel quote, in words ----------------------------------

type QuoteLine = CancellationQuote['lines'][number] & { cash_back_cents?: number };

/** What cancelling does to each player's money, with the server's amounts. */
export function venueQuoteWords(quote: CancellationQuote, roster: AppRoster): string[] {
  const names = new Map(roster.players.map((p) => [p.profile_id, p.name]));
  const words = ['The booking is cancelled and its pitches are released. Every player is told.'];
  for (const line of quote.lines as QuoteLine[]) {
    if (line.share_id === null) {
      if (line.guarantee_id !== null && line.action === 'release' && quote.guarantee_hold_placed) {
        words.push("The booker's guarantee hold is released.");
      }
      continue;
    }
    const parts: string[] = [];
    if (line.refund_cents > 0) {
      parts.push(`${formatEuros(line.refund_cents)} back, by card refund or as credit at your venue, their choice.`);
    } else if (line.action === 'release' && line.paid_cents > 0) {
      parts.push(`their ${formatEuros(line.paid_cents)} hold is released.`);
    }
    if (line.credit_used_cents > 0) {
      parts.push(`${formatEuros(line.credit_used_cents)} goes back to their credit at your venue.`);
    }
    if ((line.cash_back_cents ?? 0) > 0) parts.push(`Hand back ${formatEuros(line.cash_back_cents!)} cash.`);
    words.push(`${names.get(line.profile_id) ?? 'A player'}: ${parts.length ? parts.join(' ') : 'nothing was taken.'}`);
  }
  if (quote.lines.some((l) => l.refund_cents > 0)) {
    words.push("Your venue pays Stripe's fee on each card payment that goes back. It comes off your next payout.");
  }
  return words;
}

// ---- Errors --------------------------------------------------------------

/** The server's refusal, in words staff can act on. */
export function describeVenueError(code: string): string {
  switch (code) {
    case 'slot_blocked':
      return 'That pitch is blocked then. Remove the block first, or pick another time.';
    case 'slot_full':
      return 'That pitch is already taken then. Pick another time or pitch.';
    case 'outside_opening_hours':
      return "That's outside your opening hours.";
    case 'venue_closed':
      return "You're closed that day.";
    case 'slot_ended':
      return 'That game has already ended.';
    case 'price_required':
      return 'There is no price for that slot. Enter what you charged.';
    case 'name_required':
      return 'Enter the customer’s name.';
    case 'invalid_amount':
      return 'Enter a price of €0.00 or more.';
    case 'not_venue_staff':
      return "You're not staff at this venue.";
    case 'match_not_over':
      return 'Collection can run once the game has ended.';
    case 'already_collected':
    case 'collection_started':
      return 'Collection has already run for this game.';
    case 'already_cancelled':
    case 'booking_cancelled':
      return 'This booking is already cancelled.';
    case 'too_late_to_cancel':
    case 'game_started':
      return 'This game has already started, so it can no longer be cancelled.';
    case 'invalid_time_range':
      return 'Pick an end time after the start time.';
    case 'already_paid':
      return 'This booking is already marked paid.';
    case 'not_cash':
      return "This player isn't paying cash.";
    case 'share_not_active':
      return 'This player is no longer in the game.';
    case 'day_in_past':
      return 'That day has passed.';
    case 'flag_not_found':
      return 'That flag is already gone.';
    default:
      return 'Something went wrong. Try again.';
  }
}
