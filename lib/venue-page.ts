// The venue page's data (docs/specs/15-design.md section 5; spec 13,
// "Venue pages and the venue data import"). Everything comes from the
// server's venue_page function: the app only formats it. Amounts are
// integer cents from price_rules and venue_menu_items, never computed here.
import type { IconSymbolName } from '@/components/ui/icon-symbol';

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
  };
  /** False when the venue isn't live or has no price: the Book bar is off. */
  bookable: boolean;
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
  prices: { format: string; hour_cents: number; peak_hour_cents: number | null; weekend_hour_cents: number | null }[];
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

/** The cancellation rules from spec 13 "Cancellations and refunds" (the
 *  same for every venue), in three lines as on checkout (spec 15). */
export const CANCELLATION_RULES = [
  'Cancel within 1 hour of paying and get everything back, if you booked more than 6 hours before kickoff.',
  'After that, €1 is kept and the rest becomes credit at this venue, until 6 hours before kickoff.',
  'Less than 6 hours before kickoff, there are no refunds.',
] as const;

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
