// What the booking screens show (P5; spec 13 "Booking screens", 15-design
// section 5), from the server functions in
// supabase/migrations/20261112090000_pay_booking_screens.sql. Every amount is
// integer cents the server computed from the venue's data: this file picks
// which of the server's fields to show and never adds, divides or works out
// a price, fee or total.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PriceLine } from '@/components/ui/price-breakdown';
import { minToTime, timeToMin } from '@/lib/booking';
import type { PaymentMode } from '@/lib/booking-actions';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { cyprusWallTime } from '@/lib/calendar/cyprus-time';
import { supabase } from '@/lib/supabase';
import { VENUE_PHOTOS_BUCKET, type CancellationTerms } from '@/lib/venue-page';

// ---- Server responses -------------------------------------------------

/** booking_search_options(): the caller's window, in Cyprus days. */
export type SearchOptions = {
  today: string;
  window_days: number;
  is_premium: boolean;
  six_on_five_available: boolean;
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
};

/** A player's paid state on the roster (spec 13 "Booking screens"):
 *  in_app paid by card, cash to pay at the venue, cash_paid ticked by the
 *  venue, unpaid, covered by the booker paying for everyone. */
export type RosterState = 'in_app' | 'cash' | 'cash_paid' | 'unpaid' | 'covered';

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
  } | null;
  roster: RosterEntry[];
  next_cutoff: NextCutoff;
  can_cancel: { my_spot: boolean; whole_team: boolean };
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

export type CheckoutChoice = { mode: PaymentMode | null; cash: boolean; credit: boolean };

export type CheckoutAmounts = {
  lines: PriceLine[];
  /** What's paid in the app now. */
  totalCents: number;
  /** Paid in cash at the venue, when the player picked cash. */
  cashCents: number | null;
};

/** The server's amounts for the choice, as they are. Credit shows as a
 *  minus line; nothing is summed here. */
export function checkoutAmounts(quote: BookingQuote, choice: CheckoutChoice): CheckoutAmounts | null {
  if (!choice.mode) return null;
  if (choice.mode === 'pay_all') {
    const all = quote.pay_all;
    if (choice.credit && all.with_credit) {
      return {
        lines: [
          { label: 'Pitch', cents: all.pitch_cents },
          { label: 'Your credit', cents: -all.with_credit.credit_cents },
          { label: 'Service fee', cents: all.with_credit.fee_cents },
        ],
        totalCents: all.with_credit.card_cents,
        cashCents: null,
      };
    }
    return {
      lines: [
        { label: 'Pitch', cents: all.pitch_cents },
        { label: 'Service fee', cents: all.fee_cents },
      ],
      totalCents: all.card_cents,
      cashCents: null,
    };
  }
  const mine = quote.each_pays.mine;
  if (choice.credit && mine.with_credit) {
    return {
      lines: [
        { label: 'Your part of the pitch', cents: mine.pitch_cents },
        { label: 'Your credit', cents: -mine.with_credit.credit_cents },
        { label: 'Service fee', cents: mine.with_credit.fee_cents },
      ],
      totalCents: mine.with_credit.card_cents,
      cashCents: null,
    };
  }
  if (choice.cash) {
    const cash = quote.each_pays.cash;
    return { lines: [{ label: 'Service fee', cents: cash.card_cents }], totalCents: cash.card_cents, cashCents: cash.cash_cents };
  }
  return {
    lines: [
      { label: 'Your part of the pitch', cents: mine.pitch_cents },
      { label: 'Service fee', cents: mine.fee_cents },
    ],
    totalCents: mine.card_cents,
    cashCents: null,
  };
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
