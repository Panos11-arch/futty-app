// What the booking screens show (P5; spec 13 "Booking screens", 15-design
// section 5), from the server functions in
// supabase/migrations/20261112090000_pay_booking_screens.sql. Every amount is
// integer cents the server computed from the venue's data: this file picks
// which of the server's fields to show and never adds, divides or works out
// a price, fee or total.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { minToTime, PITCH_FORMATS, timeToMin } from '@/lib/booking';
import type { BookingNavigator } from '@/lib/booking-navigation';
import type { PaymentMode } from '@/lib/booking-actions';
import type { BookingV2Info } from '@/lib/booking-opposition';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { cyprusWallTime } from '@/lib/calendar/cyprus-time';
import { supabase } from '@/lib/supabase';
import { VENUE_PHOTOS_BUCKET, type AmenityKind, type CancellationTerms } from '@/lib/venue-page';

// ---- Server responses -------------------------------------------------

/** booking_search_options(): the caller's window, in Cyprus days, and the
 *  game lengths offered (spec 13: 60, 90 or 120 minutes, 60 by default). */
export type SearchOptions = {
  today: string;
  window_days: number;
  is_premium: boolean;
  six_on_five_available: boolean;
  game_lengths?: number[];
  default_game_length?: number;
};

/** One row of venues_free_at(). player_cents is what each player pays when
 *  each pays their own share (a standard account). */
export type FreeVenue = {
  venue_id: string;
  name: string;
  city: string | null;
  address: string | null;
  photo_path: string | null;
  pitch_cents: number;
  player_cents: number;
  next_starts: string[];
};

export type CreditSplit = { credit_cents: number; fee_cents: number; card_cents: number };

/** booking_quote(): checkout for one slot, both modes priced for the caller. */
export type BookingQuote = {
  venue_id: string;
  day: string;
  start_time: string;
  end_time: string;
  format: string;
  players_per_side: number;
  players: number;
  pitch_cents: number;
  is_premium: boolean;
  kickoff_at: string;
  refunds_stop_at: string;
  non_refundable: boolean;
  pay_all: { pitch_cents: number; fee_cents: number; card_cents: number; with_credit: CreditSplit | null };
  each_pays: {
    player_cents: number;
    player_pitch_cents: number;
    player_fee_cents: number;
    mine: { pitch_cents: number; fee_cents: number; card_cents: number; with_credit: CreditSplit | null };
    cash: { card_cents: number; cash_cents: number };
  };
  credit: { available_cents: number; expires_at: string | null };
  in_debt: boolean;
  cash_allowed: boolean;
  cancellation: CancellationTerms;
  /** Gipedo Pano (P8): the caller's hold, and whether they can book it for
   *  this slot. unavailable_reason is the server's error code. */
  gipedo_pano: {
    pitch_cents: number;
    fee_cents: number;
    hold_cents: number;
    available: boolean;
    unavailable_reason: 'not_captain' | 'gipedo_too_far_ahead' | 'gipedo_too_soon' | null;
  };
  /** The teams the caller captains (Gipedo Pano is booked for one). */
  captain_teams: { id: string; name: string }[];
};

/** A player's paid state on the roster (spec 13 "Booking screens"):
 *  in_app paid by card, cash to pay at the venue, cash_paid ticked by the
 *  venue, unpaid, covered by the booker paying for everyone. */
export type RosterState = 'in_app' | 'cash' | 'cash_paid' | 'unpaid' | 'covered' | 'held';

/** A Gipedo Pano booking as booking_detail returns it (P8). */
export type GipedoDetail = {
  team: { id: string; name: string } | null;
  opponent: { state: 'none' | 'offered' | 'held'; team: { id: string; name: string } | null };
  /** The caller's hold: the booking team (a), the opponent (b), or none. */
  my_side: 'a' | 'b' | null;
  /** What pulling out costs the caller now (free, fee or forfeit), or null
   *  when they can't. fee_per_player_cents is the server's fee per player
   *  for kind 'fee' (null otherwise). */
  pull_out: { kind: 'free' | 'fee' | 'forfeit'; cents: number; fee_per_player_cents: number | null } | null;
  /** No opponent 24 hours before kickoff: the booking captain chooses. */
  choice_due: boolean;
  choice: 'play_normal' | 'cancel' | 'auto_cancel' | null;
  /** What "play as normal" takes from the booking captain's hold. */
  play_normal_cents: number | null;
  /** What the caller's hold pays, once decided. */
  settlement: {
    reason: 'lost' | 'won' | 'split' | 'pull_out_fee' | 'play_normal';
    capture_cents: number;
    status: 'due' | 'done' | 'debt';
  } | null;
};

/** One player on booking_detail's roster. The amounts are null unless the
 *  caller is the booker or this is the caller's own spot. */
export type RosterEntry = {
  share_id: string;
  profile_id: string;
  name: string | null;
  username: string | null;
  is_booker: boolean;
  is_me: boolean;
  state: RosterState;
  amount_cents: number | null;
  cash_cents: number | null;
};

/** The caller's next cancellation cutoff: their free hour ending, else
 *  refunds stopping before kickoff; null once refunds have stopped. */
export type NextCutoff = { kind: 'free_hour_ends' | 'refunds_stop'; at: string } | null;

/** booking_detail's 'switch' (P12; spec 13 "Switching after booking"): set
 *  on a 5-a-side booking that can ever switch, null otherwise. The amounts
 *  are each player's pitch-part change, worked out by the server. */
export type SwitchInfo = {
  switched: boolean;
  switched_at: string | null;
  can_switch: boolean;
  /** Why the caller can't switch now: a switch_refusal code, or null. */
  refusal: string | null;
  /** 6 from 5 v 5, 5 from 6 v 6; null once switched. */
  to_players_per_side: 5 | 6 | null;
  closes_at?: string;
  /** credit: each paid player gets credit; extra: each pays more after the
   *  match; none: the booker paid for everyone. */
  money?: 'credit' | 'extra' | 'none';
  each_cents?: number;
  booker_cents?: number;
};

/** booking_detail(): a booking the caller is in. */
export type BookingDetail = {
  booking: {
    id: string;
    status: string;
    booking_day: string;
    start_time: string;
    end_time: string;
    format: string;
    capacity: number;
    players_per_side: number;
    payment_mode: PaymentMode | null;
    kickoff_at: string;
    ends_at: string;
    refunds_stop_at: string;
    payment_window_ends_at: string | null;
  };
  venue: {
    id: string;
    name: string;
    city: string | null;
    address: string | null;
    google_maps_link: string | null;
    photo_path: string | null;
  };
  is_booker: boolean;
  me: {
    share_id: string;
    status: string;
    payment_method: 'card' | 'cash' | null;
    amount_cents: number;
    pitch_cents: number;
    fee_cents: number;
    cash_cents: number;
    free_until: string | null;
    /** Paying this share in cash now, as the server would plan it: the
     *  pitch part in cash and the fee by card. Null unless cash_allowed. */
    cash: { cash_cents: number; card_cents: number } | null;
  } | null;
  /** Whether the caller may pay their own share in cash now (the server's
   *  cash rules: each-pays modes only, never in debt, before collection). */
  cash_allowed: boolean;
  roster: RosterEntry[];
  next_cutoff: NextCutoff;
  can_cancel: { my_spot: boolean; whole_team: boolean };
  /** Set on a Gipedo Pano booking (P8), null otherwise. */
  gipedo?: GipedoDetail | null;
  /** 5 v 5 / 6 v 6 switching (P12). */
  switch?: SwitchInfo | null;
  /** P6e: players the venue offered. The booker gets open and accepted ones
   *  with their ids and what they can do; another player gets accepted
   *  names only. */
  venue_players?: VenuePlayerEntry[];
  /** B3: a Booking v2 booking's kind, sides, opposition, posts and
   *  no-opponent choice; null for bookings made before Booking v2. */
  v2?: BookingV2Info | null;
};

export type VenuePlayerEntry = {
  id?: string;
  name: string;
  state: 'offered' | 'accepted';
  can_answer?: boolean;
  can_remove?: boolean;
};

// ---- The search choices ------------------------------------------------

/** Game lengths offered, in minutes (spec 13, "Booking screens"). */
export const GAME_LENGTHS = [60, 90, 120] as const;
export type GameLength = (typeof GAME_LENGTHS)[number];

/** Start times offered, Cyprus time (spec 13, "Booking screens"). */
const FIRST_START = '07:00';
const LAST_START = '23:30';
const STEP_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

/** The server's today (Cyprus) and the next `windowDays` days, as YYYY-MM-DD. */
export function dateStrip(today: string, windowDays: number): string[] {
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: windowDays + 1 }, (_, i) => {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    return date.toISOString().slice(0, 10);
  });
}

/** Every half hour from 07:00 to 23:30 on `day`, without the ones already
 *  past in Cyprus at `now` (whatever time zone the phone is in) and without
 *  the ones where a game of `minutes` would run past midnight. */
export function timeGrid(day: string, now: Date, minutes: number): string[] {
  const times: string[] = [];
  for (let min = timeToMin(FIRST_START); min <= timeToMin(LAST_START); min += STEP_MINUTES) {
    const time = minToTime(min);
    if (endTime(time, minutes) === null) continue;
    if (cyprusWallTime(day, time).getTime() > now.getTime()) times.push(time);
  }
  return times;
}

/** A game's end on the half-hour grid; null when it would run past midnight. */
export function endTime(start: string, minutes: number): string | null {
  const end = timeToMin(start) + minutes;
  return end > DAY_MINUTES ? null : minToTime(end);
}

function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** A strip day's label: "Today", or "Fri 13". The day is already a Cyprus
 *  date, so it is read as a calendar date (UTC), never in the phone's zone. */
export function dayChipLabel(day: string, today: string): string {
  if (day === today) return 'Today';
  const date = dayDate(day);
  return `${date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${date.getUTCDate()}`;
}

/** "Mon 16 Nov · 19:00–20:00" (Cyprus times, as the server returns them). */
export function slotLabel(day: string, start: string, end: string): string {
  const date = dayDate(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${date.replace(',', '')} · ${start.slice(0, 5)}–${end.slice(0, 5)}`;
}

/** "1 Nov 2027", in Cyprus. */
export function cyprusDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Nicosia' });
}

/** "Players per side" shows only after 5-a-side, where 6 v 6 is allowed. */
export function showPlayersPerSide(format: string | null, sixOnFiveAllowed: boolean): boolean {
  return format === '5-a-side' && sixOnFiveAllowed;
}

/** The "This booking is non-refundable" notice: the server says so, or the
 *  clock has passed the server's refunds-stop time (6 hours before kickoff)
 *  while the screen is open. Exactly 6 hours before is not "less than 6
 *  hours" (spec 13). Both are instants, so the phone's time zone can't matter. */
export function showNonRefundable(info: { non_refundable?: boolean; refunds_stop_at: string }, now: Date): boolean {
  return info.non_refundable === true || now.getTime() > Date.parse(info.refunds_stop_at);
}

// ---- Server calls -------------------------------------------------------

export type Slot = {
  venueId: string;
  day: string;
  start: string;
  end: string;
  format: string;
  playersPerSide: 5 | 6;
};

export type FreeAtQuery = { day: string; start: string; minutes: number; format: string; playersPerSide: 5 | 6 };

export type FreeVenueWithPhoto = FreeVenue & { photoUrl: string | null };

/** How long a photo's signed URL lasts; the list reloads long before. */
const PHOTO_URL_SECONDS = 60 * 60;

function fail(message: string): never {
  throw new Error(describeBookingErrorMessage(message));
}

export async function fetchSearchOptions(): Promise<SearchOptions> {
  const { data, error } = await supabase.rpc('booking_search_options');
  if (error) fail(error.message);
  return data as SearchOptions;
}

export async function fetchVenuesFreeAt(q: FreeAtQuery): Promise<FreeVenueWithPhoto[]> {
  const { data, error } = await supabase.rpc('venues_free_at', {
    p_day: q.day,
    p_start: q.start,
    p_minutes: q.minutes,
    p_format: q.format,
    p_players_per_side: q.playersPerSide,
  });
  if (error) fail(error.message);
  const rows = (data ?? []) as FreeVenue[];
  const paths = rows.flatMap((r) => (r.photo_path ? [r.photo_path] : []));
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    // A photo that can't be signed is left out; the card shows initials.
    const { data: signed } = await supabase.storage.from(VENUE_PHOTOS_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return rows.map((r) => ({ ...r, photoUrl: r.photo_path ? (urls[r.photo_path] ?? null) : null }));
}

export async function fetchBookingQuote(slot: Slot): Promise<BookingQuote> {
  const { data, error } = await supabase.rpc('booking_quote', {
    p_venue_id: slot.venueId,
    p_day: slot.day,
    p_start: slot.start,
    p_end: slot.end,
    p_format: slot.format,
    p_players_per_side: slot.playersPerSide,
  });
  if (error) fail(error.message);
  return data as BookingQuote;
}

/** A roster player's name: "You" for the caller. */
export function rosterName(entry: Pick<RosterEntry, 'is_me' | 'name' | 'username'>): string {
  return entry.is_me ? 'You' : (entry.name ?? entry.username ?? 'Player');
}

/** Who hasn't paid (state 'unpaid' on booking_detail's roster), for the
 *  next-game card. A cash player who'll pay at the venue isn't in it. */
export function whoHasntPaid(roster: RosterEntry[]): string[] {
  return roster.filter((e) => e.state === 'unpaid').map(rosterName);
}

/** booking_detail's roster only (names and paid state), for the next-game card. */
export async function fetchBookingRoster(bookingId: string): Promise<RosterEntry[]> {
  const { data, error } = await supabase.rpc('booking_detail', { p_booking_id: bookingId });
  if (error) fail(error.message);
  return (data as BookingDetail).roster ?? [];
}

export type PayShareData = { detail: BookingDetail; blocked: boolean; cancellation: CancellationTerms };

/** A booking the caller is in, whether they're blocked by debt, and the
 *  cancellation numbers, for the Pay my share view. */
export async function fetchPayShareData(bookingId: string): Promise<PayShareData> {
  const [detail, owed, terms] = await Promise.all([
    supabase.rpc('booking_detail', { p_booking_id: bookingId }),
    supabase.rpc('my_owed'),
    supabase.rpc('cancellation_terms'),
  ]);
  const error = detail.error ?? owed.error ?? terms.error;
  if (error) fail(error.message);
  return {
    detail: detail.data as BookingDetail,
    blocked: (owed.data as { blocked: boolean }).blocked,
    cancellation: terms.data as CancellationTerms,
  };
}

// ---- Hooks ------------------------------------------------------------

export type LoadState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };

/** Loads `load()` whenever `key` changes; null key = nothing to load yet. */
export function useLoad<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' });
  const requestRef = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    if (key === null) return;
    setState({ status: 'loading' });
    try {
      const data = await loadRef.current();
      if (requestRef.current === request) setState({ status: 'ready', data });
    } catch (e) {
      if (requestRef.current === request) {
        setState({ status: 'error', message: e instanceof Error ? e.message : 'Something went wrong.' });
      }
    }
  }, [key]);

  useEffect(() => {
    reload();
    return () => {
      requestRef.current += 1;
    };
  }, [reload]);

  return { state, reload };
}

/** The current time, refreshed every `everyMs`. */
export function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

// ---- Book a pitch (S4) ---------------------------------------------------
// The search on image 02: a place, up to 3 days, a time window, a length and
// a format, plus the Filter sheet. book_search (migration
// 20261124182133_pay_s4_book_search.sql) returns each venue's free times and
// the cheapest per-player price among them; the app only shows them.

export const MAX_SEARCH_DAYS = 3;

export type TimePresetId = 'all_day' | 'morning' | 'afternoon' | 'evening';
export type TimeWindow = { preset: TimePresetId | 'specific'; from: string; to: string };

/** "At what time?" (prompt S4). `to` is exclusive: a start before it. */
export const TIME_PRESETS: { id: TimePresetId; label: string; from: string; to: string; range: string }[] = [
  { id: 'all_day', label: 'All day', from: '00:00', to: '24:00', range: '00:00–23:59' },
  { id: 'morning', label: 'Morning', from: '06:00', to: '12:00', range: '06:00–12:00' },
  { id: 'afternoon', label: 'Afternoon', from: '12:00', to: '18:00', range: '12:00–18:00' },
  { id: 'evening', label: 'Evening', from: '18:00', to: '24:00', range: '18:00–24:00' },
];

/** Specific hours: every half hour of the day (the start-time grid). */
export function specificHours(): string[] {
  return Array.from({ length: DAY_MINUTES / STEP_MINUTES }, (_, i) => minToTime(i * STEP_MINUTES));
}

export function timeChipLabel(window: TimeWindow): string {
  const preset = TIME_PRESETS.find((p) => p.id === window.preset);
  return preset ? preset.label : `${window.from}–${window.to}`;
}

export type BookPlace =
  | { kind: 'all' }
  | { kind: 'town'; town: string }
  | { kind: 'venue'; venueId: string; name: string };

export function placeLabel(place: BookPlace): string {
  if (place.kind === 'town') return place.town;
  if (place.kind === 'venue') return place.name;
  return 'All venues';
}

export type PitchType = 'indoor' | 'outdoor';

export type BookSearchQuery = {
  days: string[];
  window: TimeWindow;
  minutes: number;
  format: string;
  playersPerSide: 5 | 6;
  place: BookPlace;
  types: PitchType[];
  favouritesOnly: boolean;
  includeUnavailable: boolean;
};

function isFormat(value: string | null): value is string {
  return value !== null && (PITCH_FORMATS as readonly string[]).includes(value);
}

/** The lengths the server offers (booking_search_options). */
export function offeredLengths(options: SearchOptions): number[] {
  return options.game_lengths ?? [];
}

/** How the screen opens: the last format used (else 5-a-side), today, all
 *  day, the server's default length, everywhere. */
export function defaultBookQuery(options: SearchOptions, lastFormat: string | null): BookSearchQuery {
  const all = TIME_PRESETS[0];
  return {
    days: [options.today],
    window: { preset: all.id, from: all.from, to: all.to },
    minutes: options.default_game_length ?? offeredLengths(options)[0] ?? 60,
    format: isFormat(lastFormat) ? lastFormat : '5-a-side',
    playersPerSide: 5,
    place: { kind: 'all' },
    types: [],
    favouritesOnly: false,
    includeUnavailable: false,
  };
}

/** 6 v 6 only on 5-a-side where it's allowed; 5 otherwise, as before S4. */
export function playersPerSideFor(format: string, chosen: 5 | 6, sixOnFiveAllowed: boolean): 5 | 6 {
  return showPlayersPerSide(format, sixOnFiveAllowed) ? chosen : 5;
}

// ---- Days ------------------------------------------------------------------

export type CalendarDay = { day: string; date: number; selectable: boolean };
export type CalendarMonth = { key: string; title: string; weeks: (CalendarDay | null)[][] };

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "Choose your days": whole months, Monday first, from today's month to the
 *  window's last day; only today through the window can be picked. Days are
 *  Cyprus calendar dates, read as UTC dates (never the phone's zone). */
export function calendarMonths(today: string, windowDays: number): CalendarMonth[] {
  const strip = dateStrip(today, windowDays);
  const window = new Set(strip);
  const first = dayDate(today);
  const last = dayDate(strip[strip.length - 1]);
  const months: CalendarMonth[] = [];
  for (
    let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
    m <= last;
    m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))
  ) {
    const daysInMonth = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0)).getUTCDate();
    const lead = (m.getUTCDay() + 6) % 7;
    const cells: (CalendarDay | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      const day = isoDay(new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), d)));
      cells.push({ day, date: d, selectable: window.has(day) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (CalendarDay | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    months.push({
      key: isoDay(m).slice(0, 7),
      title: m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      weeks,
    });
  }
  return months;
}

/** Picks or unpicks a day; at most MAX_SEARCH_DAYS, kept in order. */
export function toggleDay(days: string[], day: string): string[] {
  if (days.includes(day)) return days.filter((d) => d !== day);
  if (days.length >= MAX_SEARCH_DAYS) return days;
  return [...days, day].sort();
}

function shortDate(day: string): string {
  return dayDate(day)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '');
}

/** The Date chip: "Today", "Thu 26 Nov", or "Thu 26 Nov +2". */
export function daysChipLabel(days: string[], today: string): string {
  const first = days[0] === today ? 'Today' : shortDate(days[0]);
  return days.length > 1 ? `${first} +${days.length - 1}` : first;
}

export type BookSlot = { day: string; start: string; end: string; player_cents: number };

/** A time chip: "18:00", with the weekday when several days are searched. */
export function slotChipLabel(slot: BookSlot, severalDays: boolean): string {
  if (!severalDays) return slot.start;
  return `${dayDate(slot.day).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${slot.start}`;
}

// ---- Places ----------------------------------------------------------------

export type PlaceVenue = { id: string; name: string; city: string | null };

/** The picker's matches: towns and venues containing the text. */
export function filterPlaces(text: string, towns: string[], venues: PlaceVenue[]) {
  const q = text.trim().toLowerCase();
  if (!q) return { towns: [] as string[], venues: [] as PlaceVenue[] };
  return {
    towns: towns.filter((t) => t.toLowerCase().includes(q)),
    venues: venues.filter((v) => v.name.toLowerCase().includes(q)),
  };
}

// ---- Kept on the phone (best effort: storage failing never blocks Book) ----

const RECENT_PLACES_KEY = 'futty.book.recent_places';
const LAST_FORMAT_KEY = 'futty.book.last_format';
const MAX_RECENT_PLACES = 5;

function isPlace(value: unknown): value is BookPlace {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (p.kind === 'town') return typeof p.town === 'string';
  if (p.kind === 'venue') return typeof p.venueId === 'string' && typeof p.name === 'string';
  return false;
}

function placeKey(p: BookPlace): string {
  return p.kind === 'town' ? `town:${p.town}` : p.kind === 'venue' ? `venue:${p.venueId}` : 'all';
}

export async function loadRecentPlaces(): Promise<BookPlace[]> {
  try {
    const parsed: unknown = JSON.parse((await AsyncStorage.getItem(RECENT_PLACES_KEY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isPlace).slice(0, MAX_RECENT_PLACES) : [];
  } catch {
    return [];
  }
}

/** Puts a place first in Recent and returns the new list. */
export async function saveRecentPlace(place: BookPlace): Promise<BookPlace[]> {
  const current = await loadRecentPlaces();
  if (place.kind === 'all') return current;
  const next = [place, ...current.filter((p) => placeKey(p) !== placeKey(place))].slice(0, MAX_RECENT_PLACES);
  try {
    await AsyncStorage.setItem(RECENT_PLACES_KEY, JSON.stringify(next));
  } catch {
    // Not kept this time.
  }
  return next;
}

export async function loadLastFormat(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_FORMAT_KEY);
  } catch {
    return null;
  }
}

export async function saveLastFormat(format: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_FORMAT_KEY, format);
  } catch {
    // Not kept this time.
  }
}

// ---- Server calls ------------------------------------------------------------

/** One book_search row. from_player_cents is the cheapest per-player price
 *  among `slots` (null when there are none), worked out by the server. */
export type BookResult = {
  venue_id: string;
  name: string;
  town: string | null;
  area: string | null;
  photo_path: string | null;
  amenities: AmenityKind[];
  is_favourite: boolean;
  from_player_cents: number | null;
  slots: BookSlot[];
  photoUrl: string | null;
};

export async function fetchBookSearch(q: BookSearchQuery, sixOnFiveAllowed: boolean): Promise<BookResult[]> {
  const { data, error } = await supabase.rpc('book_search', {
    p_days: q.days,
    p_from: q.window.from,
    p_to: q.window.to,
    p_minutes: q.minutes,
    p_format: q.format,
    p_players_per_side: playersPerSideFor(q.format, q.playersPerSide, sixOnFiveAllowed),
    p_town: q.place.kind === 'town' ? q.place.town : null,
    p_venue_id: q.place.kind === 'venue' ? q.place.venueId : null,
    p_types: q.types.length > 0 ? q.types : null,
    p_favourites_only: q.favouritesOnly,
    p_include_unavailable: q.includeUnavailable,
  });
  if (error) fail(error.message);
  const rows = (data ?? []) as Omit<BookResult, 'photoUrl'>[];
  const paths = rows.flatMap((r) => (r.photo_path ? [r.photo_path] : []));
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    // A photo that can't be signed is left out; the card shows the dark panel.
    const { data: signed } = await supabase.storage.from(VENUE_PHOTOS_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return rows.map((r) => ({
    ...r,
    slots: r.slots.map((s) => ({ ...s, start: s.start.slice(0, 5), end: s.end.slice(0, 5) })),
    photoUrl: r.photo_path ? (urls[r.photo_path] ?? null) : null,
  }));
}

/** Saves or removes a favourite venue. The server makes the row the caller's. */
export async function setFavourite(venueId: string, on: boolean): Promise<void> {
  const failed = 'Couldn’t save this venue. Try again.';
  if (on) {
    const { error } = await supabase.from('favourite_venues').insert({ venue_id: venueId });
    // Already a favourite (another tap won the race): nothing to do.
    if (error && error.code !== '23505') throw new Error(failed);
    return;
  }
  const { error } = await supabase.from('favourite_venues').delete().eq('venue_id', venueId);
  if (error) throw new Error(failed);
}

/** "Missing a venue?": sent to the founders. At most 5 a day (server). */
export async function requestVenue(venueName: string, town: string): Promise<void> {
  const name = venueName.trim();
  const place = town.trim();
  if (!name || !place) throw new Error('Add the venue name and town.');
  const { error } = await supabase.from('venue_requests').insert({ venue_name: name, town: place });
  if (error) {
    throw new Error(
      error.message === 'venue_request_limit' ? 'You’ve sent 5 today. Try again tomorrow.' : 'Couldn’t send this. Try again.',
    );
  }
}

// ---- Where a tap goes ----------------------------------------------------

export type ChosenSlot = Slot & { venueName: string };

/** A free time on a card: the venue page's Book tab with that slot picked
 *  (S5). Its Continue opens the payment sheet there. */
export function openTimeSlot(slot: ChosenSlot, nav: BookingNavigator): void {
  nav.push({
    pathname: '/venue/[id]',
    params: {
      id: slot.venueId,
      tab: 'book',
      day: slot.day,
      start: slot.start,
      end: slot.end,
      format: slot.format,
      playersPerSide: String(slot.playersPerSide),
    },
  });
}

/** A card: the venue page, with no time picked. */
export function openVenue(venueId: string, nav: BookingNavigator): void {
  nav.push({ pathname: '/venue/[id]', params: { id: venueId } });
}
