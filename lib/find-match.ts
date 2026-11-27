// Find a match (S6; image 05; Playtomic 15, 16): the public open games,
// filtered by format, place, Cyprus days and a start-time window, grouped by
// Cyprus day. The server (find_matches, 20261124191659_match_find_matches)
// decides which games are listed and every fact on a card: the organiser,
// players in and places, the avatars and the level range. Each price per
// player comes from the same calls B4 uses (booking_post_quotes for Booking
// v2 posts, squad_post_prices for older "Need players" posts); the app never
// works one out. Filters are kept on the phone only (best effort).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Href } from 'expo-router';

import { PITCH_FORMATS } from '@/lib/booking';
import { bookingDetailHref } from '@/lib/booking-navigation';
import { getBookingPostQuotes, type BookingPostQuote } from '@/lib/booking-posts';
import {
  daysChipLabel,
  placeLabel,
  TIME_PRESETS,
  timeChipLabel,
  type BookPlace,
  type TimeWindow,
} from '@/lib/booking-search';
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import { formatLevel } from '@/lib/match/levels';
import { formatEuros } from '@/lib/money/format';
import { getSquadPostPrices, type SquadPostPrice } from '@/lib/squads';
import { supabase } from '@/lib/supabase';

// ---- Filters ------------------------------------------------------------

/** "Which format?" offers every format (prompt S6). */
export const MATCH_FORMATS = PITCH_FORMATS;

export type MatchFilters = {
  /** Null: any format. */
  format: string | null;
  place: BookPlace;
  /** Cyprus days (YYYY-MM-DD); empty: any day. */
  days: string[];
  window: TimeWindow;
};

const ALL_DAY = TIME_PRESETS[0];

/** Where a first filter starts: any format, everywhere, any day, all day. */
export function emptyFilters(): MatchFilters {
  return {
    format: null,
    place: { kind: 'all' },
    days: [],
    window: { preset: ALL_DAY.id, from: ALL_DAY.from, to: ALL_DAY.to },
  };
}

const NO_FILTERS_LABEL = 'Format | Places | Dates and times';

/** The filter chip: "Format | Places | Dates and times" before any filter,
 *  then "5-a-side | Limassol | Today", each part its placeholder while unset. */
export function filtersChipLabel(filters: MatchFilters | null, today: string): string {
  if (!filters) return NO_FILTERS_LABEL;
  const allDay = filters.window.preset === ALL_DAY.id;
  let when: string;
  if (filters.days.length > 0) {
    when = daysChipLabel(filters.days, today) + (allDay ? '' : ` ${timeChipLabel(filters.window)}`);
  } else {
    when = allDay ? 'Dates and times' : timeChipLabel(filters.window);
  }
  return [filters.format ?? 'Format', filters.place.kind === 'all' ? 'Places' : placeLabel(filters.place), when].join(
    ' | ',
  );
}

/** Days before today drop off (a filter kept from last week). */
export function withoutPastDays(filters: MatchFilters, today: string): MatchFilters {
  const days = filters.days.filter((d) => d >= today);
  return days.length === filters.days.length ? filters : { ...filters, days };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_KEY = /^\d{2}:\d{2}$/;

function isPlace(value: unknown): value is BookPlace {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (p.kind === 'all') return true;
  if (p.kind === 'town') return typeof p.town === 'string';
  if (p.kind === 'venue') return typeof p.venueId === 'string' && typeof p.name === 'string';
  return false;
}

function isWindow(value: unknown): value is TimeWindow {
  if (!value || typeof value !== 'object') return false;
  const w = value as Record<string, unknown>;
  const preset = w.preset === 'specific' || TIME_PRESETS.some((p) => p.id === w.preset);
  return preset && typeof w.from === 'string' && TIME_KEY.test(w.from) && typeof w.to === 'string' && TIME_KEY.test(w.to);
}

/** A stored value, if it is a whole, valid filter. */
export function parseFilters(value: unknown): MatchFilters | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as Record<string, unknown>;
  const format = f.format === null || (typeof f.format === 'string' && (MATCH_FORMATS as readonly string[]).includes(f.format));
  const days = Array.isArray(f.days) && f.days.every((d) => typeof d === 'string' && DAY_KEY.test(d));
  if (!format || !days || !isPlace(f.place) || !isWindow(f.window)) return null;
  return { format: f.format as string | null, place: f.place, days: f.days as string[], window: f.window };
}

const FILTERS_KEY = 'futty.find_match.filters';

/** The last filters, or null (none yet, or storage failed). */
export async function loadMatchFilters(): Promise<MatchFilters | null> {
  try {
    const raw = await AsyncStorage.getItem(FILTERS_KEY);
    return raw ? parseFilters(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function saveMatchFilters(filters: MatchFilters): Promise<void> {
  try {
    await AsyncStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // Not kept this time.
  }
}

// ---- Games ----------------------------------------------------------------

export type MatchPerson = { id: string | null; name: string };

/** One find_matches row. Levels come back as numeric (a string or number). */
export type MatchRow = {
  post_id: string;
  kind: 'players' | 'opposition';
  scheduled_at: string;
  format: string;
  venue_id: string;
  venue_name: string;
  venue_city: string | null;
  organiser_id: string | null;
  organiser_name: string;
  team_id: string | null;
  team_name: string | null;
  players_in: number | null;
  capacity: number | null;
  level_min: number | string | null;
  level_max: number | string | null;
  people: MatchPerson[];
  /** The caller's own post's booking; null on anyone else's. */
  booking_id: string | null;
};

export type MatchCard = MatchRow & {
  /** Cyprus day and kickoff time. */
  day: string;
  time: string;
  /** The server's price per player, if it has one for the caller. */
  priceCents: number | null;
  /** A Booking v2 post (has a B4 quote). */
  v2: boolean;
  /** The caller's own post (B4 quote "mine"). */
  mine: boolean;
};

export type MatchSection = { day: string; title: string; data: MatchCard[] };

const cyprusParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: CYPRUS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** An instant's Cyprus day and time: { day: '2026-11-27', time: '19:00' }. */
export function cyprusDayTime(iso: string): { day: string; time: string } {
  const parts: Record<string, string> = {};
  for (const part of cyprusParts.formatToParts(new Date(iso))) parts[part.type] = part.value;
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** A day heading: "Today", "Tomorrow", or "Friday 27 Nov". */
export function dayTitle(day: string, today: string): string {
  if (day === today) return 'Today';
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const [ty, tm, td] = today.split('-').map(Number);
  if (date.getTime() - Date.UTC(ty, tm - 1, td) === 86_400_000) return 'Tomorrow';
  return date
    .toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '');
}

/** "Level 4.2–6.0", "Level 6.1" when one value, or null when nobody has one. */
export function levelText(min: number | string | null, max: number | string | null): string | null {
  if (min === null || max === null) return null;
  const low = formatLevel(min);
  const high = formatLevel(max);
  return low === high ? `Level ${low}` : `Level ${low}–${high}`;
}

/** "3/10" on a players game; null on an opposition post. */
export function spotsText(card: Pick<MatchRow, 'kind' | 'players_in' | 'capacity'>): string | null {
  if (card.kind !== 'players' || card.players_in === null || card.capacity === null) return null;
  return `${card.players_in}/${card.capacity}`;
}

/** "€6.80 per player", or B4's "Paid by the captain" when a joiner pays nothing. */
export function priceText(cents: number | null): string | null {
  if (cents === null) return null;
  return cents === 0 ? 'Paid by the captain' : `${formatEuros(cents)} per player`;
}

/** Who organises it: the posting team on an older opposition post, else the poster. */
export function organiserOf(card: Pick<MatchRow, 'team_id' | 'team_name' | 'organiser_id' | 'organiser_name'>):
  | { kind: 'team'; id: string; name: string }
  | { kind: 'player'; id: string | null; name: string } {
  if (card.team_id && card.team_name) return { kind: 'team', id: card.team_id, name: card.team_name };
  return { kind: 'player', id: card.organiser_id, name: card.organiser_name };
}

/** The price per player B4 shows: a players post's join price (or an older
 *  post's share), side B's "each" price on an opposition post. */
function priceFor(row: MatchRow, quote: BookingPostQuote | undefined, price: SquadPostPrice | undefined): number | null {
  if (quote) return row.kind === 'players' ? quote.join_cents : quote.each_pays_cents;
  if (row.kind === 'players' && price) return price.share_cents;
  return null;
}

/** The rows as cards: Cyprus day and time, price, and B4's open check (a
 *  Booking v2 post its quote calls closed is left out). */
export function buildCards(
  rows: MatchRow[],
  quotes: Map<string, BookingPostQuote>,
  prices: Map<string, SquadPostPrice> | null,
): MatchCard[] {
  return rows.flatMap((row) => {
    const quote = quotes.get(row.post_id);
    if (quote && !quote.open) return [];
    const { day, time } = cyprusDayTime(row.scheduled_at);
    return [
      {
        ...row,
        people: Array.isArray(row.people) ? row.people : [],
        day,
        time,
        priceCents: priceFor(row, quote, prices?.get(row.post_id)),
        v2: !!quote,
        mine: quote?.mine ?? false,
      },
    ];
  });
}

/** Cards by Cyprus day, in kickoff order. */
export function groupByDay(cards: MatchCard[], today: string): MatchSection[] {
  const sorted = [...cards].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const sections: MatchSection[] = [];
  for (const card of sorted) {
    const last = sections[sections.length - 1];
    if (last && last.day === card.day) last.data.push(card);
    else sections.push({ day: card.day, title: dayTitle(card.day, today), data: [card] });
  }
  return sections;
}

/** Where "Open post" on my own post goes: its booking (the screen My bookings
 *  opens); a matched opposition post with no booking, its fixture; any other
 *  post with no booking, nowhere (the posts list never shows my own post). */
export function ownPostHref(item: {
  item_id: string;
  post_type: string;
  post_status: string;
  booking_id: string | null;
}): Href | null {
  if (item.booking_id) return bookingDetailHref(item.booking_id);
  if (item.post_type === 'opposition' && item.post_status === 'matched') {
    return { pathname: '/fixture-confirmed', params: { kind: 'squad', id: item.item_id } };
  }
  return null;
}

/** Where a card goes: my own post with a booking to that booking (as
 *  ownPostHref); otherwise the existing B4 join or "Accept as opponent"
 *  screens; the caller's own post without a booking and older opposition
 *  posts (offered from the posts list) to the posts list. */
export function cardHref(card: Pick<MatchCard, 'post_id' | 'kind' | 'v2' | 'mine' | 'booking_id'>): Href {
  if (card.booking_id) {
    // find_matches lists open posts only.
    const own = ownPostHref({ item_id: card.post_id, post_type: card.kind, post_status: 'open', booking_id: card.booking_id });
    if (own) return own;
  }
  if (card.mine) return { pathname: '/squad-posts', params: { view: card.kind } };
  if (card.kind === 'players') return { pathname: '/join-squad-post', params: { postId: card.post_id } };
  if (card.v2) return { pathname: '/opposition-invite', params: { postId: card.post_id } };
  return { pathname: '/squad-posts', params: { view: 'opposition' } };
}

/** The server's games for these filters, priced as B4 prices them. Throws
 *  one line to show with "Try again". */
export async function fetchMatches(filters: MatchFilters): Promise<MatchCard[]> {
  const failed = 'Couldn’t load games. Try again.';
  const { data, error } = await supabase.rpc('find_matches', {
    p_format: filters.format,
    p_town: filters.place.kind === 'town' ? filters.place.town : null,
    p_venue_id: filters.place.kind === 'venue' ? filters.place.venueId : null,
    p_days: filters.days.length > 0 ? filters.days : null,
    p_from: filters.window.from,
    p_to: filters.window.to,
  });
  if (error) throw new Error(failed);
  const rows = (data ?? []) as MatchRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.post_id);
  const [quotes, prices] = await Promise.all([
    getBookingPostQuotes(ids),
    // Older "Need players" posts only; a failure leaves their price off.
    getSquadPostPrices(rows.filter((r) => r.kind === 'players').map((r) => r.post_id)),
  ]);
  // Without the quotes a Booking v2 post's price and screen aren't known.
  if (!quotes) throw new Error(failed);
  return buildCards(rows, quotes, prices);
}
