import {
  AMENITIES,
  amenitiesByPriority,
  appleMapsUrl,
  cancellationLines,
  googleMapsUrl,
  offerWhen,
  pitchSummary,
  shortTime,
  openingHours,
  phoneUrl,
  pitchLine,
  venueCardLine,
  venueShareMessage,
  venueStartTab,
  websiteUrl,
  weekdaysLabel,
  type VenuePageData,
} from './venue-page';

describe('cancellationLines', () => {
  it('builds the three lines from the server\'s numbers', () => {
    expect(cancellationLines({ fee_cents: 100, free_minutes: 60, refund_cutoff_hours: 6 })).toEqual([
      'Cancel within 1 hour of paying and get everything back, if you booked more than 6 hours before kickoff.',
      'After that, €1.00 is kept and the rest becomes credit at this venue, until 6 hours before kickoff.',
      'Less than 6 hours before kickoff, there are no refunds.',
    ]);
  });

  it('words other numbers correctly', () => {
    const [free, kept, late] = cancellationLines({ fee_cents: 250, free_minutes: 120, refund_cutoff_hours: 1 });
    expect(free).toBe('Cancel within 2 hours of paying and get everything back, if you booked more than 1 hour before kickoff.');
    expect(kept).toContain('€2.50 is kept');
    expect(late).toBe('Less than 1 hour before kickoff, there are no refunds.');
    expect(cancellationLines({ fee_cents: 100, free_minutes: 45, refund_cutoff_hours: 6 })[0]).toContain('within 45 minutes');
  });
});

const venue = { name: 'Nuevo Campo', address: '2 Aristidou Street', city: 'Nicosia', google_maps_link: null };

describe('directions', () => {
  it('opens Apple Maps at the address, labelled with the name', () => {
    expect(appleMapsUrl(venue)).toBe(
      'https://maps.apple.com/?q=Nuevo%20Campo&address=2%20Aristidou%20Street%2C%20Nicosia%2C%20Cyprus',
    );
  });

  it('uses the venue\'s own Google Maps link when there is one, otherwise a search', () => {
    expect(googleMapsUrl({ ...venue, google_maps_link: 'https://www.google.com/maps/place/?q=place_id:abc' })).toBe(
      'https://www.google.com/maps/place/?q=place_id:abc',
    );
    expect(googleMapsUrl(venue)).toBe(
      'https://www.google.com/maps/search/?api=1&query=Nuevo%20Campo%2C%202%20Aristidou%20Street%2C%20Nicosia%2C%20Cyprus',
    );
    expect(googleMapsUrl({ ...venue, address: null, city: null })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Nuevo%20Campo%2C%20Cyprus',
    );
  });
});

describe('times and days', () => {
  it('shows the end of the day as midnight', () => {
    expect(shortTime('15:00:00')).toBe('15:00');
    expect(shortTime('23:59:59')).toBe('00:00');
  });

  it('names day lists', () => {
    expect(weekdaysLabel([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
    expect(weekdaysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(weekdaysLabel([6, 7])).toBe('Sat, Sun');
    expect(weekdaysLabel([1, 2, 3, 5, 7])).toBe('Mon–Wed, Fri, Sun');
    expect(weekdaysLabel(null)).toBeNull();
    expect(weekdaysLabel([])).toBeNull();
  });

  it('says when an offer is on, or nothing when the sheet doesn\'t', () => {
    expect(offerWhen({ available_from: '15:00:00', available_to: '22:30:00', available_weekdays: [6, 7] })).toBe(
      'Sat, Sun, 15:00–22:30',
    );
    expect(offerWhen({ available_from: null, available_to: null, available_weekdays: null })).toBeNull();
  });
});

it('sums up a pitch in one line', () => {
  expect(
    pitchSummary({
      id: 'p',
      name: 'Pitch 1',
      size: '5-a-side',
      formats: ['5-a-side'],
      surface: null,
      indoor: true,
      description: null,
      is_open: true,
    }),
  ).toBe('5-a-side · Indoor');
});

// ---- S5: the venue page (03-venue-book-tab) ---------------------------

const pitch = (over: Partial<VenuePageData['pitches'][number]>): VenuePageData['pitches'][number] => ({
  id: 'p',
  name: 'Pitch 1',
  size: '5-a-side',
  formats: ['5-a-side'],
  surface: 'Artificial grass',
  indoor: false,
  description: null,
  is_open: true,
  ...over,
});

describe('pitchLine (Facilities)', () => {
  it('names the size once, not again as a format', () => {
    expect(pitchLine(pitch({}))).toBe('5-a-side · Artificial grass · Outdoor');
  });

  it('adds the other formats a pitch hosts, and Closed', () => {
    expect(pitchLine(pitch({ size: '7-a-side', formats: ['7-a-side', '5-a-side'], indoor: true }))).toBe(
      '7-a-side · 5-a-side · Artificial grass · Indoor',
    );
    expect(pitchLine(pitch({ surface: null, is_open: false }))).toBe('5-a-side · Outdoor · Closed');
  });
});

describe('venueStartTab', () => {
  it('opens on Book from Book a pitch, on Home from anywhere else', () => {
    expect(venueStartTab({ tab: 'book' })).toBe('book');
    expect(venueStartTab({ day: '2026-11-26', start: '20:00' })).toBe('book');
    expect(venueStartTab({})).toBe('home');
    expect(venueStartTab({ tab: 'facilities' })).toBe('home');
    expect(venueStartTab({ day: '2026-11-26' })).toBe('home');
  });
});

describe('the card under the photos', () => {
  const data = { address: 'Kamares', city: 'Limassol' };
  it('the area only: S5A shows the amenities as icons under the card', () => {
    expect(venueCardLine(data)).toBe('Kamares, Limassol');
    expect(venueCardLine({ address: null, city: 'Limassol' })).toBe('Limassol');
    expect(venueCardLine({ address: null, city: null })).toBe('');
  });

  it('Call dials the number without its spaces; Website always opens a web address', () => {
    expect(phoneUrl('+357 25 (12) 34-56')).toBe('tel:+35725123456');
    expect(phoneUrl(null)).toBeNull();
    expect(phoneUrl('  ')).toBeNull();
    expect(websiteUrl('https://arena.example.com')).toBe('https://arena.example.com');
    expect(websiteUrl('arena.example.com')).toBe('https://arena.example.com');
    expect(websiteUrl(null)).toBeNull();
  });

  it('Share sends the name, the area and the map link', () => {
    expect(venueShareMessage({ name: 'Nuevo Campo', address: '2 Aristidou Street', city: 'Nicosia', google_maps_link: null })).toBe(
      'Nuevo Campo\n2 Aristidou Street, Nicosia\nhttps://www.google.com/maps/search/?api=1&query=Nuevo%20Campo%2C%202%20Aristidou%20Street%2C%20Nicosia%2C%20Cyprus',
    );
    expect(venueShareMessage({ name: 'X', address: null, city: null, google_maps_link: 'https://maps/x' })).toBe(
      'X\nhttps://maps/x',
    );
  });
});

describe('S5A amenities', () => {
  it('restaurant, vending machines and shop each have a label and their own icon', () => {
    expect(AMENITIES.restaurant).toEqual({ label: 'Restaurant', icon: 'fork.knife' });
    expect(AMENITIES.vending_machines).toEqual({ label: 'Vending machines', icon: 'takeoutbag.and.cup.and.straw.fill' });
    expect(AMENITIES.shop).toEqual({ label: 'Shop', icon: 'bag.fill' });
    const icons = Object.values(AMENITIES).map((a) => a.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('food and drink first (café or bar, restaurant, vending machines), then parking, then the rest in list order', () => {
    expect(
      amenitiesByPriority(['wifi', 'showers', 'parking', 'vending_machines', 'shop', 'restaurant', 'cafe_or_bar']),
    ).toEqual(['cafe_or_bar', 'restaurant', 'vending_machines', 'parking', 'showers', 'wifi', 'shop']);
    expect(amenitiesByPriority(['wifi', 'showers', 'parking', 'cafe_or_bar'], 2)).toEqual(['cafe_or_bar', 'parking']);
    expect(amenitiesByPriority([])).toEqual([]);
  });
});

describe('openingHours', () => {
  it('one row per day, Monday first; a day without hours is Closed', () => {
    expect(
      openingHours([
        { weekday: 6, opens: '08:00:00', closes: '23:59:59' },
        { weekday: 1, opens: '15:00:00', closes: '22:30:00' },
      ]),
    ).toEqual([
      { day: 'Mon', hours: '15:00–22:30' },
      { day: 'Tue', hours: 'Closed' },
      { day: 'Wed', hours: 'Closed' },
      { day: 'Thu', hours: 'Closed' },
      { day: 'Fri', hours: 'Closed' },
      { day: 'Sat', hours: '08:00–00:00' },
      { day: 'Sun', hours: 'Closed' },
    ]);
  });

  it('no hours at all: nothing to show', () => {
    expect(openingHours([])).toEqual([]);
  });
});
