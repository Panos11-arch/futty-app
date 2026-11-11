import {
  appleMapsUrl,
  cancellationLines,
  googleMapsUrl,
  offerWhen,
  pitchSummary,
  shortTime,
  weekdaysLabel,
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
