// The venue dashboard's Today screens (docs/specs/13-payments-bookings.md
// "Venue dashboard", spec 05 section 12): every write goes to its server
// function with ids and choices only; the app never computes an amount. The
// one amount the app sends is a walk-in's price, and only when staff changed
// the venue's price (spec 13: that money never goes through Futty).
import {
  addBlock,
  addCounterBooking,
  addDays,
  bookingSummary,
  bookingTitle,
  cancelCounterBooking,
  clearConditions,
  confirmVenueCancel,
  cyprusToday,
  dayTitle,
  describeVenueError,
  fetchCheckInCode,
  fetchDayBoard,
  fetchRoster,
  fetchSlotPrice,
  fetchVenueQuote,
  flagConditions,
  halfHourAfter,
  kindLabel,
  markCashReceived,
  markCounterPaid,
  markLabel,
  pitchColumn,
  removeBlock,
  requestCollection,
  rosterStateLabel,
  setAllows6v6,
  SLOT_STARTS,
  unassignedBookings,
  venueQuoteWords,
} from './venue-today';
import { appBooking, appRoster, dayBoard, phoneBooking, PITCH_1, venueQuote, walkIn } from './venue-today.fixtures';

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockInsert = jest.fn();
const mockDeleteEq = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    from: (table: string) => {
      mockFrom(table);
      return {
        insert: (...args: unknown[]) => mockInsert(...args),
        delete: () => ({ eq: (...args: unknown[]) => mockDeleteEq(...args) }),
      };
    },
  },
}));

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockInvoke.mockReset().mockResolvedValue({ data: { cancelled: true }, error: null });
  mockInsert.mockReset().mockResolvedValue({ data: null, error: null });
  mockDeleteEq.mockReset().mockResolvedValue({ data: null, error: null });
  mockFrom.mockReset();
});

const counterInput = {
  venueId: 'v1',
  day: '2026-11-16',
  start: '20:00',
  end: '21:00',
  format: '5-a-side',
  source: 'walk_in' as const,
  contactName: 'Andreas',
  contactPhone: '99 000001',
  pitchId: 'p2',
  chargedCents: null,
  paidMethod: 'cash' as const,
};

/** Every write the Today screens make, each with ids and choices only. */
async function everyWrite() {
  await markCashReceived('s2');
  await requestCollection('b-app');
  await addCounterBooking(counterInput);
  await markCounterPaid('b-walk', 'card');
  await cancelCounterBooking('b-walk');
  await flagConditions({ venueId: 'v1', day: '2026-11-16', start: '18:00', end: '20:00', pitchId: null, note: null });
  await clearConditions('f1');
  await setAllows6v6('v1', true);
  await addBlock({ venueId: 'v1', day: '2026-11-16', start: null, end: null, pitchId: 'p1', reason: null }, 'staff1');
  await removeBlock('blk1');
  await confirmVenueCancel('b-app', 'q-1', { quote: jest.fn() });
}

describe('writes', () => {
  it('send ids and choices, never an amount (a walk-in at the venue price sends none either)', async () => {
    await everyWrite();
    const payloads = [
      ...mockRpc.mock.calls.map((c) => c[1]),
      ...mockInsert.mock.calls.map((c) => c[0]),
      ...mockInvoke.mock.calls.map((c) => c[1].body),
    ];
    expect(payloads).toHaveLength(10);
    for (const payload of payloads) {
      for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        if (/cents|price|amount|fee|total|capacity/i.test(key)) {
          // The only one: the walk-in's charged price, null unless staff changed it.
          expect([key, value]).toEqual(['p_charged_cents', null]);
        }
      }
    }
  });

  it('call the right function with the right ids', async () => {
    await everyWrite();
    expect(mockRpc.mock.calls).toEqual([
      ['mark_cash_received', { p_share_id: 's2' }],
      ['request_collection', { p_booking_id: 'b-app' }],
      [
        'add_counter_booking',
        {
          p_venue_id: 'v1',
          p_day: '2026-11-16',
          p_start: '20:00',
          p_end: '21:00',
          p_format: '5-a-side',
          p_source: 'walk_in',
          p_contact_name: 'Andreas',
          p_contact_phone: '99 000001',
          p_pitch_id: 'p2',
          p_charged_cents: null,
          p_paid_method: 'cash',
        },
      ],
      ['mark_counter_paid', { p_booking_id: 'b-walk', p_method: 'card' }],
      ['cancel_counter_booking', { p_booking_id: 'b-walk' }],
      [
        'flag_conditions',
        { p_venue_id: 'v1', p_day: '2026-11-16', p_start: '18:00', p_end: '20:00', p_pitch_id: null, p_note: null },
      ],
      ['clear_conditions', { p_flag_id: 'f1' }],
      ['set_venue_allows_6v6', { p_venue_id: 'v1', p_allowed: true }],
    ]);
    expect(mockFrom.mock.calls).toEqual([['venue_blocks'], ['venue_blocks']]);
    expect(mockInsert).toHaveBeenCalledWith({
      venue_id: 'v1',
      pitch_id: 'p1',
      block_day: '2026-11-16',
      starts_at: null,
      ends_at: null,
      reason: null,
      created_by: 'staff1',
    });
    expect(mockDeleteEq).toHaveBeenCalledWith('id', 'blk1');
    expect(mockInvoke).toHaveBeenCalledWith('cancel-booking', {
      body: { bookingId: 'b-app', scope: 'venue', quote: 'q-1' },
    });
  });

  it('a walk-in whose price staff changed sends the typed cents', async () => {
    await addCounterBooking({ ...counterInput, chargedCents: 4550, paidMethod: null });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_charged_cents: 4550, p_paid_method: null });
  });

  it('an empty phone or note goes as null', async () => {
    await addCounterBooking({ ...counterInput, contactPhone: '  ' });
    await flagConditions({ venueId: 'v1', day: '2026-11-16', start: null, end: null, pitchId: 'p1', note: ' ' });
    await addBlock({ venueId: 'v1', day: '2026-11-16', start: '19:00', end: '20:00', pitchId: null, reason: '' }, 's');
    expect(mockRpc.mock.calls[0][1].p_contact_phone).toBeNull();
    expect(mockRpc.mock.calls[1][1].p_note).toBeNull();
    expect(mockInsert.mock.calls[0][0]).toMatchObject({ starts_at: '19:00', ends_at: '20:00', reason: null });
  });
});

describe('reads', () => {
  it('ask the server for the board, roster, price, check-in code and the venue quote', async () => {
    await fetchDayBoard('v1', '2026-11-16');
    await fetchRoster('b-app');
    await fetchSlotPrice({ venueId: 'v1', day: '2026-11-16', start: '20:00', end: '21:00', format: '5-a-side' });
    await fetchCheckInCode('m1');
    await fetchVenueQuote('b-app');
    expect(mockRpc.mock.calls).toEqual([
      ['venue_day_board', { p_venue_id: 'v1', p_day: '2026-11-16' }],
      ['venue_booking_roster', { p_booking_id: 'b-app' }],
      [
        'slot_price_cents',
        { p_venue_id: 'v1', p_day: '2026-11-16', p_start: '20:00', p_end: '21:00', p_format: '5-a-side' },
      ],
      ['get_match_check_in_code', { p_match_id: 'm1' }],
      ['cancellation_quote', { p_booking_id: 'b-app', p_scope: 'venue' }],
    ]);
  });
});

describe('confirmVenueCancel', () => {
  it('cancels exactly the quote shown', async () => {
    expect(await confirmVenueCancel('b-app', 'q-1', { quote: jest.fn() })).toEqual({ status: 'cancelled' });
  });

  it('shows the new quote when what would happen has changed', async () => {
    const { FunctionsHttpError } = jest.requireActual('@supabase/supabase-js');
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'quote_changed' }))),
    });
    const fresh = venueQuote({ quote: 'q-2' });
    const quote = jest.fn().mockResolvedValue({ data: fresh, error: null });
    expect(await confirmVenueCancel('b-app', 'q-1', { quote })).toEqual({ status: 'changed', quote: fresh });
  });

  it('says why when the server refuses', async () => {
    const { FunctionsHttpError } = jest.requireActual('@supabase/supabase-js');
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'already_cancelled' }))),
    });
    expect(await confirmVenueCancel('b-app', 'q-1', { quote: jest.fn() })).toEqual({
      status: 'error',
      message: 'This booking is already cancelled.',
    });
  });

  it('says why when the new quote cannot be read', async () => {
    const { FunctionsHttpError } = jest.requireActual('@supabase/supabase-js');
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'quote_changed' }))),
    });
    const quote = jest.fn().mockResolvedValue({ data: null, error: { message: 'booking_cancelled' } });
    expect(await confirmVenueCancel('b-app', 'q-1', { quote })).toEqual({
      status: 'error',
      message: 'This booking is already cancelled.',
    });
  });
});

describe('days in Cyprus time', () => {
  it('today is the Cyprus date, not the phone or UTC date', () => {
    // 22:30 UTC on 15 November is 00:30 on 16 November in Cyprus (UTC+2).
    expect(cyprusToday(new Date('2026-11-15T22:30:00Z'))).toBe('2026-11-16');
    expect(cyprusToday(new Date('2026-11-15T21:30:00Z'))).toBe('2026-11-15');
  });

  it('steps days across months and years', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('names the day', () => {
    expect(dayTitle('2026-11-16', '2026-11-16')).toBe('Today');
    expect(dayTitle('2026-11-17', '2026-11-16')).toBe('Tomorrow');
    expect(dayTitle('2026-11-15', '2026-11-16')).toBe('Yesterday');
    expect(dayTitle('2026-11-21', '2026-11-16')).toBe('Sat 21 Nov');
  });
});

describe('labels', () => {
  it('names walk-ins and phone bookings by their source and contact, never as an app booking', () => {
    expect(kindLabel(walkIn())).toBe('Walk-in');
    expect(kindLabel(phoneBooking())).toBe('Phone');
    expect(kindLabel(appBooking())).toBe('App');
    expect(kindLabel(appBooking({ kind: 'owner_block' }))).toBe('Training');
    expect(bookingTitle(walkIn())).toBe('Andreas');
    expect(bookingTitle(appBooking())).toBe('Nikos Georgiou');
    expect(bookingTitle(appBooking({ kind: 'owner_block', note: 'U14 academy' }))).toBe('U14 academy');
    expect(bookingTitle(appBooking({ kind: 'owner_block', note: null }))).toBe('Training');
  });

  it('shows the server amounts unchanged', () => {
    expect(bookingSummary(walkIn())).toBe('Paid cash · €45.50');
    expect(bookingSummary(walkIn({ paid_method: 'card' }))).toBe('Paid card · €45.50');
    expect(bookingSummary(phoneBooking())).toBe('Not paid · €50.00');
    expect(bookingSummary(walkIn({ charged_cents: 0, paid_method: null }))).toBe('Free');
    expect(bookingSummary(appBooking())).toBe('7 of 10 in · 1 unpaid · 2 cash to tick');
    expect(bookingSummary(appBooking({ unpaid: 0, cash_to_tick: 0 }))).toBe('7 of 10 in');
    expect(bookingSummary(appBooking({ kind: 'owner_block' }))).toBe('');
  });

  it("names each player's payment choice and state", () => {
    expect(rosterStateLabel('in_app')).toEqual({ label: 'Paid in app', tone: 'success' });
    expect(rosterStateLabel('cash')).toEqual({ label: 'Cash, not yet paid', tone: 'warning' });
    expect(rosterStateLabel('cash_paid')).toEqual({ label: 'Cash, paid', tone: 'success' });
    expect(rosterStateLabel('unpaid')).toEqual({ label: 'Unpaid', tone: 'warning' });
    expect(rosterStateLabel('covered')).toEqual({ label: 'Paid by the booker', tone: 'inkMuted' });
  });

  it('names blocks and flags by pitch and time', () => {
    const board = dayBoard();
    expect(markLabel(board, { pitch_id: null, starts_at: null, ends_at: null })).toBe('All pitches · All day');
    expect(markLabel(board, { pitch_id: 'p1', starts_at: '19:00:00', ends_at: '20:30:00' })).toBe(
      'Pitch 1 · 19:00–20:30',
    );
    expect(markLabel(board, { pitch_id: 'gone', starts_at: '19:00:00', ends_at: '24:00:00' })).toBe(
      'A pitch · 19:00–24:00',
    );
  });
});

describe('the calendar', () => {
  it('a slot ends half an hour after it starts, the last at midnight', () => {
    expect(halfHourAfter('09:00')).toBe('09:30');
    expect(halfHourAfter('18:30')).toBe('19:00');
    expect(halfHourAfter('23:30')).toBe('24:00');
  });

  it('runs every half hour from 07:00 to 23:30', () => {
    expect(SLOT_STARTS).toHaveLength(34);
    expect(SLOT_STARTS[0]).toBe('07:00');
    expect(SLOT_STARTS[33]).toBe('23:30');
  });

  it('places a booking on its pitch at its time', () => {
    const column = pitchColumn(dayBoard(), 'p1');
    expect(column.bookings).toEqual([{ booking: appBooking(), row: 22, span: 2, flagged: false }]);
    expect(column.cells.find((c) => c.start === '18:00')).toMatchObject({ free: false });
    expect(column.cells.find((c) => c.start === '19:00')).toMatchObject({ free: true, blocked: null, flagged: null });
  });

  it('shows a block on the pitches and times it covers', () => {
    const allPitches = { id: 'blk1', pitch_id: null, starts_at: '19:00:00', ends_at: '20:00:00', reason: null };
    const dayOnP2 = { id: 'blk2', pitch_id: 'p2', starts_at: null, ends_at: null, reason: 'Resurfacing' };
    const board = dayBoard({ blocks: [allPitches, dayOnP2] });
    const p1 = pitchColumn(board, 'p1');
    expect(p1.cells.find((c) => c.start === '19:00')?.blocked).toBe(allPitches);
    expect(p1.cells.find((c) => c.start === '19:30')?.blocked).toBe(allPitches);
    expect(p1.cells.find((c) => c.start === '20:00')?.blocked).toBeNull();
    const p2 = pitchColumn(board, 'p2');
    expect(p2.cells.every((c) => c.blocked !== null)).toBe(true);
  });

  it('shows a condition flag on its slots and on the bookings it covers', () => {
    const flag = { id: 'f1', pitch_id: 'p1', starts_at: '18:30:00', ends_at: '20:00:00', note: 'Waterlogged' };
    const column = pitchColumn(dayBoard({ flags: [flag] }), 'p1');
    expect(column.bookings[0].flagged).toBe(true);
    expect(column.cells.find((c) => c.start === '19:30')?.flagged).toBe(flag);
    expect(column.cells.find((c) => c.start === '18:00')?.flagged).toBeNull();
    expect(pitchColumn(dayBoard({ flags: [flag] }), 'p2').cells.every((c) => c.flagged === null)).toBe(true);
  });

  it('lists bookings that hold no named pitch apart', () => {
    const old = appBooking({ id: 'b-old', kind: 'owner_block', pitch_ids: [] });
    expect(unassignedBookings(dayBoard({ bookings: [appBooking(), old] }))).toEqual([old]);
  });

  it('a booking that runs past the grid is cut at its end', () => {
    const late = appBooking({ start_time: '23:00:00', end_time: '24:00:00' });
    expect(pitchColumn(dayBoard({ bookings: [late] }), PITCH_1.id).bookings[0]).toMatchObject({ row: 32, span: 2 });
  });
});

describe('venueQuoteWords', () => {
  it("says what each player gets back, with the server's amounts", () => {
    expect(venueQuoteWords(venueQuote(), appRoster())).toEqual([
      'The booking is cancelled and its pitches are released. Every player is told.',
      'Nikos Georgiou: €6.80 back, by card refund or as credit at your venue, their choice.',
      'Eleni: €0.80 back, by card refund or as credit at your venue, their choice.',
      'Marios: €0.80 back, by card refund or as credit at your venue, their choice. Hand back €6.00 cash.',
      'Petros: nothing was taken.',
      "Your venue pays Stripe's fee on each card payment that goes back. It comes off your next payout.",
    ]);
  });

  it('says when credit used for a share goes back to it', () => {
    const quote = venueQuote({
      lines: [
        { ...venueQuote().lines[0], paid_cents: 0, refund_cents: 0, credit_used_cents: 600, action: 'release' },
      ],
    });
    expect(venueQuoteWords(quote, appRoster())[1]).toBe('Nikos Georgiou: €6.00 goes back to their credit at your venue.');
  });

  it("releases the booker's guarantee and names an unknown player plainly", () => {
    const quote = venueQuote({
      guarantee_hold_placed: true,
      lines: [
        { ...venueQuote().lines[0], profile_id: 'gone' },
        { ...venueQuote().lines[3], share_id: null, guarantee_id: 'g1', profile_id: 'u1', paid_cents: 6000 },
      ],
    });
    expect(venueQuoteWords(quote, appRoster())).toEqual([
      'The booking is cancelled and its pitches are released. Every player is told.',
      'A player: €6.80 back, by card refund or as credit at your venue, their choice.',
      "The booker's guarantee hold is released.",
      "Your venue pays Stripe's fee on each card payment that goes back. It comes off your next payout.",
    ]);
  });

  it('a game with nobody paid in it says so', () => {
    expect(venueQuoteWords(venueQuote({ lines: [] }), appRoster())).toEqual([
      'The booking is cancelled and its pitches are released. Every player is told.',
    ]);
  });
});

describe('describeVenueError', () => {
  it.each([
    ['slot_blocked', 'That pitch is blocked then. Remove the block first, or pick another time.'],
    ['slot_full', 'That pitch is already taken then. Pick another time or pitch.'],
    ['outside_opening_hours', "That's outside your opening hours."],
    ['venue_closed', "You're closed that day."],
    ['slot_ended', 'That game has already ended.'],
    ['price_required', 'There is no price for that slot. Enter what you charged.'],
    ['name_required', 'Enter the customer’s name.'],
    ['invalid_amount', 'Enter a price of €0.00 or more.'],
    ['not_venue_staff', "You're not staff at this venue."],
    ['match_not_over', 'Collection can run once the game has ended.'],
    ['already_collected', 'Collection has already run for this game.'],
    ['already_cancelled', 'This booking is already cancelled.'],
    ['booking_cancelled', 'This booking is already cancelled.'],
    ['too_late_to_cancel', 'This game has already started, so it can no longer be cancelled.'],
    ['invalid_time_range', 'Pick an end time after the start time.'],
    ['game_started', 'This game has already started, so it can no longer be cancelled.'],
    ['already_paid', 'This booking is already marked paid.'],
    ['not_cash', "This player isn't paying cash."],
    ['share_not_active', 'This player is no longer in the game.'],
    ['collection_started', 'Collection has already run for this game.'],
    ['day_in_past', 'That day has passed.'],
    ['flag_not_found', 'That flag is already gone.'],
    ['something_new', 'Something went wrong. Try again.'],
  ])('%s', (code, words) => {
    expect(describeVenueError(code)).toBe(words);
  });
});
