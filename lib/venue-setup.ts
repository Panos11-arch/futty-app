// The venue dashboard's setup screens (P6e; docs/specs/13-payments-bookings.md
// "Venue setup"; spec 05 section 12, items 2 and 3): opening hours,
// closures, prices and pitches. Everything goes through the staff-checked
// server functions of supabase/migrations/20261117120506_pay_venue_setup.sql;
// the tables are read-only to the app. This file only sends ids, choices,
// Cyprus dates, "HH:MM" times and prices staff typed (already whole cents,
// from parseEurosInput), and puts what comes back into words. It never works
// out an amount, and the server decides what is allowed.

import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';
import { formatDay } from '@/lib/venue-money';
import { describeVenueError } from '@/lib/venue-today';

// ---- Types: as venue_setup returns them ----------------------------------

/** 1 = Monday ... 7 = Sunday. A weekday that isn't listed is closed. */
export type DayHours = { weekday: number; opens: string; closes: string };

export type Closure = { id: string; starts_on: string; ends_on: string; reason: string | null };

export type PriceRule = {
  format: string;
  /** The one price an hour, the same on every day and at every hour. */
  price_cents: number;
};

export type SetupPitch = {
  id: string;
  name: string;
  size: string;
  formats: string[];
  surface: string | null;
  indoor: boolean;
  description: string | null;
  is_open: boolean;
  sort_order: number;
  /** Has held a game, past or future: it can't be deleted, only closed. */
  has_bookings: boolean;
  /** Holds a game that hasn't ended: its size and formats can't change. */
  has_future_bookings: boolean;
};

export type Combination = { id: string; format: string; pitch_ids: string[] };

export type VenueSetup = {
  venue: { id: string; name: string; allows_6v6_on_5s: boolean };
  hours: DayHours[];
  closures: Closure[];
  prices: PriceRule[];
  pitches: SetupPitch[];
  combinations: Combination[];
};

// ---- Fixed lists ---------------------------------------------------------

export const FORMATS = ['5-a-side', '6-a-side', '7-a-side', '9-a-side', '11-a-side'] as const;

export const WEEKDAYS = [
  { weekday: 1, short: 'Mon', long: 'Monday' },
  { weekday: 2, short: 'Tue', long: 'Tuesday' },
  { weekday: 3, short: 'Wed', long: 'Wednesday' },
  { weekday: 4, short: 'Thu', long: 'Thursday' },
  { weekday: 5, short: 'Fri', long: 'Friday' },
  { weekday: 6, short: 'Sat', long: 'Saturday' },
  { weekday: 7, short: 'Sun', long: 'Sunday' },
] as const;

/** Every half hour a day can open at or a band can start at: 00:00 to 23:30. */
export const OPEN_TIMES: string[] = Array.from({ length: 48 }, (_, i) => {
  const minutes = i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`;
});

/** Every half hour a day can close at or a band can end at: 00:30 to 24:00 (midnight). */
export const CLOSE_TIMES: string[] = [...OPEN_TIMES.slice(1), '24:00'];

// ---- Server calls --------------------------------------------------------

export function fetchVenueSetup(venueId: string) {
  return supabase.rpc('venue_setup', { p_venue_id: venueId });
}

/** Replaces the week: only the open days, in weekday order. */
export function setVenueHours(venueId: string, hours: DayHours[]) {
  const sorted = [...hours]
    .sort((a, b) => a.weekday - b.weekday)
    .map((d) => ({ weekday: d.weekday, opens: d.opens, closes: d.closes }));
  return supabase.rpc('set_venue_hours', { p_venue_id: venueId, p_hours: sorted });
}

export function addVenueClosure(input: { venueId: string; startsOn: string; endsOn: string; reason: string }) {
  return supabase.rpc('add_venue_closure', {
    p_venue_id: input.venueId,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_reason: input.reason.trim() || null,
  });
}

export function removeVenueClosure(closureId: string) {
  return supabase.rpc('remove_venue_closure', { p_closure_id: closureId });
}

export type PriceInput = {
  format: string;
  priceCents: number;
};

export function setPriceRule(venueId: string, input: PriceInput) {
  return supabase.rpc('set_price_rule', {
    p_venue_id: venueId,
    p_format: input.format,
    p_price_cents: input.priceCents,
  });
}

export function removePriceRule(venueId: string, format: string) {
  return supabase.rpc('remove_price_rule', { p_venue_id: venueId, p_format: format });
}

/** A pitch's fields. Null keeps the saved value; an empty surface or
 *  description clears it. The order is never sent from here (kept). */
export type PitchInput = {
  name: string;
  size: string | null;
  formats: string[] | null;
  surface: string;
  indoor: boolean;
  description: string;
};

/** Adds a pitch (pitchId null) or edits one. */
export function savePitch(venueId: string, pitchId: string | null, input: PitchInput) {
  return supabase.rpc('save_pitch', {
    p_venue_id: venueId,
    p_pitch_id: pitchId,
    p_name: input.name,
    p_size: input.size,
    p_formats: input.formats,
    p_surface: input.surface,
    p_indoor: input.indoor,
    p_description: input.description,
    p_sort_order: null,
  });
}

export function setPitchOpen(pitchId: string, open: boolean) {
  return supabase.rpc('set_pitch_open', { p_pitch_id: pitchId, p_open: open });
}

export function deletePitch(pitchId: string) {
  return supabase.rpc('delete_pitch', { p_pitch_id: pitchId });
}

export function addPitchCombination(venueId: string, format: string, pitchIds: string[]) {
  return supabase.rpc('add_pitch_combination', { p_venue_id: venueId, p_format: format, p_pitch_ids: pitchIds });
}

export function removePitchCombination(combinationId: string) {
  return supabase.rpc('remove_pitch_combination', { p_combination_id: combinationId });
}

// ---- Rules the app only uses to choose what to ask ------------------------

/** Whether the new week opens any day later, closes it earlier or closes it.
 *  Such a change may put booked games outside the hours, so staff confirm
 *  first; the server works out who is told. */
export function hoursShortened(before: DayHours[], after: DayHours[]): boolean {
  return before.some((old) => {
    const next = after.find((d) => d.weekday === old.weekday);
    return !next || next.opens > old.opens || next.closes < old.closes;
  });
}

// ---- Words ---------------------------------------------------------------

export const NOTIFY_WARNING =
  "If any games are already booked then, they stay on and their players will be told you've closed new bookings.";

export const NEW_PRICES_NOTE = 'New prices apply to new bookings only. Games already booked keep their price.';

export function describeSetupError(code: string): string {
  switch (code) {
    case 'invalid_hours':
      return 'Each open day needs a closing time after its opening time.';
    case 'invalid_range':
      return 'Pick a last day on or after the first day.';
    case 'day_in_past':
      return 'That closure has already ended.';
    case 'closure_not_found':
      return 'That closure is already gone.';
    case 'invalid_format':
      return 'Pick a format.';
    case 'invalid_price':
      return 'Every price must be more than €0.';
    case 'price_rule_not_found':
      return 'That price is already gone.';
    case 'invalid_pitch':
      return 'A pitch needs a name, a size and at least one format.';
    case 'pitch_name_taken':
      return 'Another pitch already has that name.';
    case 'pitch_has_future_bookings':
      return 'This pitch has games still to come, so its size and formats can’t change.';
    case 'pitch_has_bookings':
      return 'This pitch has held games, so it can only be closed.';
    case 'pitch_not_found':
      return 'That pitch is already gone.';
    case 'invalid_combination':
      return 'Pick two or more different pitches.';
    case 'combination_not_found':
      return 'That combination is already gone.';
    default:
      return describeVenueError(code);
  }
}

function time(t: string): string {
  return t === '24:00' ? 'midnight' : t;
}

export function hoursLabel(day: DayHours | undefined): string {
  return day ? `${day.opens}–${time(day.closes)}` : 'Closed';
}

export function closureLabel(c: Closure): string {
  return c.starts_on === c.ends_on ? formatDay(c.starts_on) : `${formatDay(c.starts_on)} – ${formatDay(c.ends_on)}`;
}

/** The server's one price, shown unchanged. */
export function priceSummary(rule: PriceRule): string {
  return `${formatEuros(rule.price_cents)} an hour`;
}
