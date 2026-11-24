// The venue page's data (docs/specs/15-design.md section 5; spec 13,
// "Venue pages and the venue data import"). Everything comes from the
// server's venue_page function: the app only formats it. Amounts are
// integer cents from price_rules and venue_menu_items, never computed here.
import type { IconSymbolName } from '@/components/ui/icon-symbol';
import { formatEuros } from '@/lib/money/format';

export type AmenityKind =
  | 'parking'
  | 'changing_rooms'
  | 'showers'
  | 'lockers'
  | 'cafe_or_bar'
  | 'floodlights'
  | 'bibs'
  | 'ball_hire'
  | 'first_aid'
  | 'wifi'
  | 'other';

export type VenuePageData = {
  venue: {
    id: string;
    name: string;
    city: string | null;
    address: string | null;
    google_maps_link: string | null;
    phone: string | null;
    website: string | null;
    instagram: string | null;
    is_live: boolean;
    /** The venue allows 6 v 6 on its 5-a-side pitches ("Players per side"). */
    allows_6v6_on_5s?: boolean;
  };
  /** False when the venue isn't live or has no price: the Book bar is off. */
  bookable: boolean;
  /** The cancellation numbers, from the server (cancellation_terms). */
  cancellation: CancellationTerms;
  photos: { storage_path: string; pitch_id: string | null }[];
  amenities: { kind: AmenityKind; note: string | null }[];
  pitches: {
    id: string;
    name: string;
    size: string;
    formats: string[];
    surface: string | null;
    indoor: boolean;
    description: string | null;
    is_open: boolean;
  }[];
  /** One price per format, the same on every day and at every hour. */
  prices: { format: string; hour_cents: number }[];
  hours: { weekday: number; opens: string; closes: string }[];
  offers: {
    id: string;
    name: string;
    description: string | null;
    price_cents: number | null;
    offer_text: string | null;
    offer_price_cents: number | null;
    photo_path: string | null;
    available_from: string | null;
    available_to: string | null;
    available_weekdays: number[] | null;
  }[];
  /** P6e: the active food and drink items, by category (none last), then the staff's order. */
  menu: {
    id: string;
    name: string;
    category: string | null;
    description: string | null;
    price_cents: number | null;
    offer_price_cents: number | null;
    is_post_match_offer: boolean;
    offer_text: string | null;
    photo_path: string | null;
    dietary_tags: string[] | null;
  }[];
};

/** Photo files are in this private bucket; the app shows them through signed URLs. */
export const VENUE_PHOTOS_BUCKET = 'venue-photos';

export const AMENITIES: Record<AmenityKind, { label: string; icon: IconSymbolName }> = {
  parking: { label: 'Parking', icon: 'car.fill' },
  changing_rooms: { label: 'Changing rooms', icon: 'door.left.hand.closed' },
  showers: { label: 'Showers', icon: 'shower.fill' },
  lockers: { label: 'Lockers', icon: 'lock.rectangle.stack.fill' },
  cafe_or_bar: { label: 'Café or bar', icon: 'cup.and.saucer.fill' },
  floodlights: { label: 'Floodlights', icon: 'lightbulb.fill' },
  bibs: { label: 'Bibs', icon: 'tshirt.fill' },
  ball_hire: { label: 'Ball hire', icon: 'soccerball' },
  first_aid: { label: 'First aid', icon: 'cross.case.fill' },
  wifi: { label: 'Wi-Fi', icon: 'wifi' },
  other: { label: 'More', icon: 'ellipsis' },
};

export type CancellationTerms = { fee_cents: number; free_minutes: number; refund_cutoff_hours: number };

/** 60 -> "1 hour", 120 -> "2 hours", 90 -> "90 minutes". */
function minutesWords(minutes: number): string {
  if (minutes % 60 === 0) return hoursWords(minutes / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function hoursWords(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** The cancellation rules (spec 13 "Cancellations and refunds") in three
 *  lines, as on checkout (spec 15), built from the server's numbers: no
 *  amount or time is written in the app. */
export function cancellationLines(terms: CancellationTerms): [string, string, string] {
  const free = minutesWords(terms.free_minutes);
  const cutoff = hoursWords(terms.refund_cutoff_hours);
  return [
    `Cancel within ${free} of paying and get everything back, if you booked more than ${cutoff} before kickoff.`,
    `After that, ${formatEuros(terms.fee_cents)} is kept and the rest becomes credit at this venue, until ${cutoff} before kickoff.`,
    `Less than ${cutoff} before kickoff, there are no refunds.`,
  ];
}

/** Apple Maps for the venue: its address, labelled with its name. */
export function appleMapsUrl(venue: Pick<VenuePageData['venue'], 'name' | 'address' | 'city'>): string {
  const address = [venue.address, venue.city, 'Cyprus'].filter(Boolean).join(', ');
  return `https://maps.apple.com/?q=${encodeURIComponent(venue.name)}&address=${encodeURIComponent(address)}`;
}

/** Google Maps: the venue's own link from the sheet when there is one, otherwise a search for its name and address. */
export function googleMapsUrl(venue: Pick<VenuePageData['venue'], 'name' | 'address' | 'city' | 'google_maps_link'>): string {
  if (venue.google_maps_link) return venue.google_maps_link;
  const query = [venue.name, venue.address, venue.city, 'Cyprus'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** "15:00:00" -> "15:00"; the end of the day (23:59:59) reads as midnight. */
export function shortTime(time: string): string {
  return time.startsWith('23:59') ? '00:00' : time.slice(0, 5);
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** [1..7] -> "Every day"; [1,2,3,4,5] -> "Mon–Fri"; [6,7] -> "Sat, Sun". */
export function weekdaysLabel(days: number[] | null): string | null {
  if (!days || days.length === 0) return null;
  if (days.length === 7) return 'Every day';
  const sorted = [...days].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) => (r.length >= 3 ? `${DAY_NAMES[r[0] - 1]}–${DAY_NAMES[r[r.length - 1] - 1]}` : r.map((d) => DAY_NAMES[d - 1]).join(', ')))
    .join(', ');
}

/** When an offer is available, e.g. "Mon–Fri, 15:00–22:30"; null when the sheet doesn't say. */
export function offerWhen(offer: Pick<VenuePageData['offers'][number], 'available_from' | 'available_to' | 'available_weekdays'>) {
  const days = weekdaysLabel(offer.available_weekdays);
  const times =
    offer.available_from && offer.available_to ? `${shortTime(offer.available_from)}–${shortTime(offer.available_to)}` : null;
  return [days, times].filter(Boolean).join(', ') || null;
}

/** A pitch in one line: "5-a-side · Artificial grass · Indoor". */
export function pitchSummary(pitch: VenuePageData['pitches'][number]): string {
  return [pitch.size, pitch.surface, pitch.indoor ? 'Indoor' : 'Outdoor'].filter(Boolean).join(' · ');
}

export type MenuGroup<T> = { title: string | null; items: T[] };

/** Items in the server's order, grouped by category; items without one come
 *  last under "Other", or untitled when no item has a category. */
export function groupMenu<T extends { category: string | null }>(items: T[]): MenuGroup<T>[] {
  const groups: MenuGroup<T>[] = [];
  const loose: T[] = [];
  for (const item of items) {
    if (item.category === null) {
      loose.push(item);
      continue;
    }
    const last = groups[groups.length - 1];
    if (last && last.title === item.category) last.items.push(item);
    else groups.push({ title: item.category, items: [item] });
  }
  if (loose.length > 0) groups.push({ title: groups.length > 0 ? 'Other' : null, items: loose });
  return groups;
}

// ---- S5: the venue page (03-venue-book-tab) ---------------------------

export type VenueTab = 'home' | 'book' | 'facilities';

/** Coming from Book a pitch (tab=book, or the time chosen there) the page
 *  opens on Book; from anywhere else, on Home. */
export function venueStartTab(params: { tab?: string; day?: string; start?: string }): VenueTab {
  return params.tab === 'book' || (params.day && params.start) ? 'book' : 'home';
}

/** A pitch on Facilities: its size, any other format it hosts (never the
 *  size twice), surface, indoor or outdoor, and Closed. */
export function pitchLine(pitch: VenuePageData['pitches'][number]): string {
  return [
    pitch.size,
    ...pitch.formats.filter((f) => f !== pitch.size),
    pitch.surface,
    pitch.indoor ? 'Indoor' : 'Outdoor',
    pitch.is_open ? null : 'Closed',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** How many amenities the card under the photos names; Facilities lists them all. */
const CARD_AMENITIES = 3;

/** The card's one line: the area, then the first amenities. */
export function venueCardLine(
  venue: Pick<VenuePageData['venue'], 'address' | 'city'>,
  amenities: VenuePageData['amenities'],
): string {
  const area = [venue.address, venue.city].filter(Boolean).join(', ');
  const names = amenities
    .map((a) => (a.kind === 'other' ? a.note : AMENITIES[a.kind].label))
    .filter((n): n is string => Boolean(n))
    .slice(0, CARD_AMENITIES);
  return [area, ...names].filter(Boolean).join(' · ');
}

/** Call: the number as a tel: link, without spaces, brackets or dashes. */
export function phoneUrl(phone: string | null): string | null {
  const digits = phone?.replace(/[\s()-]/g, '') ?? '';
  return digits ? `tel:${digits}` : null;
}

/** Website: always a web address. */
export function websiteUrl(website: string | null): string | null {
  const url = website?.trim();
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Share: the name, the area and the map link. */
export function venueShareMessage(venue: Pick<VenuePageData['venue'], 'name' | 'address' | 'city' | 'google_maps_link'>): string {
  const area = [venue.address, venue.city].filter(Boolean).join(', ');
  return [venue.name, area, googleMapsUrl(venue)].filter(Boolean).join('\n');
}

/** Opening hours on Home: Monday to Sunday, "Closed" on a day without
 *  hours; nothing when the venue has no hours at all. */
export function openingHours(hours: VenuePageData['hours']): { day: string; hours: string }[] {
  if (hours.length === 0) return [];
  return DAY_NAMES.map((day, i) => {
    const h = hours.find((x) => x.weekday === i + 1);
    return { day, hours: h ? `${shortTime(h.opens)}–${shortTime(h.closes)}` : 'Closed' };
  });
}
