import {
  addPitchCombination,
  addVenueClosure,
  closureLabel,
  daysLabel,
  deletePitch,
  describeSetupError,
  fetchVenueSetup,
  hoursLabel,
  hoursShortened,
  priceSummary,
  removePitchCombination,
  removePriceRule,
  removeVenueClosure,
  savePitch,
  setPitchOpen,
  setPriceRule,
  setVenueHours,
} from '@/lib/venue-setup';
import { PITCH_A, PITCH_B, venueSetup } from '@/lib/venue-setup.fixtures';

// The P6e setup screens' calls (docs/specs/13-payments-bookings.md "Venue
// setup"): each sends exactly the server function's parameters, prices in
// whole cents, and nothing the server works out for itself.

const mockRpc = jest.fn((_fn: string, _args: unknown) => Promise.resolve({ data: null, error: null }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args) } }));

beforeEach(() => mockRpc.mockClear());

describe('server calls', () => {
  it('venue_setup takes the venue id', async () => {
    await fetchVenueSetup('v1');
    expect(mockRpc).toHaveBeenCalledWith('venue_setup', { p_venue_id: 'v1' });
  });

  it('set_venue_hours gets the open days in weekday order', async () => {
    await setVenueHours('v1', [
      { weekday: 6, opens: '09:00', closes: '24:00' },
      { weekday: 1, opens: '08:00', closes: '23:00' },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('set_venue_hours', {
      p_venue_id: 'v1',
      p_hours: [
        { weekday: 1, opens: '08:00', closes: '23:00' },
        { weekday: 6, opens: '09:00', closes: '24:00' },
      ],
    });
  });

  it('add_venue_closure sends the days and a trimmed reason, or null', async () => {
    await addVenueClosure({ venueId: 'v1', startsOn: '2026-12-24', endsOn: '2026-12-26', reason: '  Christmas ' });
    await addVenueClosure({ venueId: 'v1', startsOn: '2026-12-31', endsOn: '2026-12-31', reason: '   ' });
    expect(mockRpc.mock.calls).toEqual([
      ['add_venue_closure', { p_venue_id: 'v1', p_starts_on: '2026-12-24', p_ends_on: '2026-12-26', p_reason: 'Christmas' }],
      ['add_venue_closure', { p_venue_id: 'v1', p_starts_on: '2026-12-31', p_ends_on: '2026-12-31', p_reason: null }],
    ]);
  });

  it('remove_venue_closure takes only the closure id', async () => {
    await removeVenueClosure('c1');
    expect(mockRpc).toHaveBeenCalledWith('remove_venue_closure', { p_closure_id: 'c1' });
  });

  it('set_price_rule sends every price in cents and the bands', async () => {
    await setPriceRule('v1', {
      format: '5-a-side',
      priceCents: 6050,
      peakCents: null,
      weekendCents: 5500,
      peakWeekdays: [1, 2, 3, 4, 5],
      peakStarts: '17:00',
      peakEnds: null,
      weekendWeekdays: [6, 7],
    });
    expect(mockRpc).toHaveBeenCalledWith('set_price_rule', {
      p_venue_id: 'v1',
      p_format: '5-a-side',
      p_price_cents: 6050,
      p_peak_cents: null,
      p_weekend_cents: 5500,
      p_peak_weekdays: [1, 2, 3, 4, 5],
      p_peak_starts: '17:00',
      p_peak_ends: null,
      p_weekend_weekdays: [6, 7],
    });
  });

  it('remove_price_rule takes the venue and format', async () => {
    await removePriceRule('v1', '7-a-side');
    expect(mockRpc).toHaveBeenCalledWith('remove_price_rule', { p_venue_id: 'v1', p_format: '7-a-side' });
  });

  it('save_pitch sends every field, null keeping the saved value', async () => {
    await savePitch('v1', null, {
      name: 'Pitch D',
      size: '7-a-side',
      formats: ['7-a-side', '6-a-side'],
      surface: '',
      indoor: true,
      description: 'New',
    });
    await savePitch('v1', PITCH_A, {
      name: 'Pitch A',
      size: null,
      formats: null,
      surface: '3G',
      indoor: false,
      description: '',
    });
    expect(mockRpc.mock.calls).toEqual([
      [
        'save_pitch',
        {
          p_venue_id: 'v1',
          p_pitch_id: null,
          p_name: 'Pitch D',
          p_size: '7-a-side',
          p_formats: ['7-a-side', '6-a-side'],
          p_surface: '',
          p_indoor: true,
          p_description: 'New',
          p_sort_order: null,
        },
      ],
      [
        'save_pitch',
        {
          p_venue_id: 'v1',
          p_pitch_id: PITCH_A,
          p_name: 'Pitch A',
          p_size: null,
          p_formats: null,
          p_surface: '3G',
          p_indoor: false,
          p_description: '',
          p_sort_order: null,
        },
      ],
    ]);
  });

  it('pitch open, delete and combinations send only ids and choices', async () => {
    await setPitchOpen(PITCH_A, false);
    await deletePitch(PITCH_B);
    await addPitchCombination('v1', '7-a-side', [PITCH_A, PITCH_B]);
    await removePitchCombination('k1');
    expect(mockRpc.mock.calls).toEqual([
      ['set_pitch_open', { p_pitch_id: PITCH_A, p_open: false }],
      ['delete_pitch', { p_pitch_id: PITCH_B }],
      ['add_pitch_combination', { p_venue_id: 'v1', p_format: '7-a-side', p_pitch_ids: [PITCH_A, PITCH_B] }],
      ['remove_pitch_combination', { p_combination_id: 'k1' }],
    ]);
  });
});

describe('hoursShortened', () => {
  const week = venueSetup().hours;

  it('is false for the same hours, longer hours or a newly opened day', () => {
    expect(hoursShortened(week, week)).toBe(false);
    expect(
      hoursShortened(week, week.map((d) => (d.weekday === 1 ? { ...d, opens: '07:00', closes: '24:00' } : d))),
    ).toBe(false);
    expect(hoursShortened(week, [...week, { weekday: 7, opens: '10:00', closes: '20:00' }])).toBe(false);
  });

  it('is true when a day opens later, closes earlier or closes', () => {
    expect(hoursShortened(week, week.map((d) => (d.weekday === 2 ? { ...d, opens: '08:30' } : d)))).toBe(true);
    expect(hoursShortened(week, week.map((d) => (d.weekday === 6 ? { ...d, closes: '23:30' } : d)))).toBe(true);
    expect(hoursShortened(week, week.filter((d) => d.weekday !== 3))).toBe(true);
  });
});

describe('words', () => {
  it('describes each setup refusal in plain words', () => {
    expect(describeSetupError('invalid_price')).toBe('Every price must be more than €0.');
    expect(describeSetupError('pitch_has_bookings')).toBe('This pitch has held games, so it can only be closed.');
    expect(describeSetupError('pitch_has_future_bookings')).toBe(
      'This pitch has games still to come, so its size and formats can’t change.',
    );
    expect(describeSetupError('pitch_name_taken')).toBe('Another pitch already has that name.');
    expect(describeSetupError('day_in_past')).toBe('That closure has already ended.');
    expect(describeSetupError('not_venue_staff')).toBe("You're not staff at this venue.");
    expect(describeSetupError('something_new')).toBe('Something went wrong. Try again.');
  });

  it('labels hours, days, closures and prices', () => {
    expect(hoursLabel({ weekday: 1, opens: '08:00', closes: '24:00' })).toBe('08:00–midnight');
    expect(hoursLabel(undefined)).toBe('Closed');
    expect(daysLabel([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(daysLabel([6, 7])).toBe('Sat–Sun');
    expect(daysLabel([1, 3])).toBe('Mon, Wed');
    expect(daysLabel([])).toBe('No days');
    expect(closureLabel({ id: 'c', starts_on: '2026-12-24', ends_on: '2026-12-26', reason: null })).toBe(
      'Thu 24 Dec 2026 – Sat 26 Dec 2026',
    );
    expect(closureLabel({ id: 'c', starts_on: '2026-12-31', ends_on: '2026-12-31', reason: null })).toBe(
      'Thu 31 Dec 2026',
    );
    const [five, seven] = venueSetup().prices;
    expect(priceSummary(five)).toBe(
      '€50.00 an hour · peak €60.00 (Mon–Fri 17:00–closing) · weekend €55.00 (Sat–Sun)',
    );
    expect(priceSummary(seven)).toBe('€70.00 an hour');
  });
});
