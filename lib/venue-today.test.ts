// The venue dashboard's Today screens (docs/specs/13-payments-bookings.md
// "Venue dashboard", spec 05 section 12): every write goes to its server
// function with ids and choices only; the app never computes an amount. The
// one amount the app sends is a walk-in's price, and only when staff changed
// the venue's price (spec 13: that money never goes through Futty).
import {
  addBlock,
  appClashSummary,
  blockFeeLine,
  blocksOnLegacy,
  clashesToCancel,
  clashTime,
  clashTitle,
  confirmBlock,
  counterClashSummary,
  counterRefundLine,
  fetchBlockClashes,
  moveBooking,
  moveLabel,
  startBlock,
  addCounterBooking,
  addDays,
  attendanceLabel,
  bookingSummary,
  bookingTitle,
  cancelCounterBooking,
  clearConditions,
  canStartGame,
  confirmVenueCancel,
  cyprusNow,
  cyprusToday,
  dayTitle,
  describeAttendanceError,
  describeVenueError,
  describeVenuePlayerError,
  fetchCheckInCode,
  fetchDayBoard,
  fetchRoster,
  fetchSlotPrice,
  fetchVenueQuote,
  flagConditions,
  halfHourAfter,
  kindLabel,
  markArrived,
  markCashReceived,
  markCounterPaid,
  gameEnd,
  markLabel,
  noShowsCaption,
  offerVenuePlayer,
  pitchColumn,
  quoteMovesMoney,
  removeBlock,
  requestCollection,
  rosterStateLabel,
  setAllows6v6,
  slotIsPast,
  SLOT_STARTS,
  unassignedBookings,
  unmarkArrived,
  venuePlayerStateLabel,
  venueQuoteWords,
  weekdayDates,
  weekdayIndex,
  withdrawVenuePlayer,
} from './venue-today';
import {
  appBooking,
  appClash,
  appRoster,
  blockClashes,
  blockSaved,
  counterClash,
  dayBoard,
  phoneBooking,
  PITCH_1,
  venueQuote,
  walkIn,
} from './venue-today.fixtures';

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
  await addBlock({ venueId: 'v1', day: '2026-11-16', start: null, end: null, pitchId: 'p1', reason: null }, 'bq-0');
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
      // Doc 28: a block is saved only through venue_add_block, with the clash list's quote.
      [
        'venue_add_block',
        {
          p_venue_id: 'v1',
          p_pitch_id: 'p1',
          p_day: '2026-11-16',
          p_start: null,
          p_end: null,
          p_reason: null,
          p_expected_quote: 'bq-0',
        },
      ],
    ]);
    // Removing stays a delete of the venue's own row; nothing inserts a block directly.
    expect(mockFrom.mock.calls).toEqual([['venue_blocks']]);
    expect(mockInsert).not.toHaveBeenCalled();
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
    await addBlock({ venueId: 'v1', day: '2026-11-16', start: '19:00', end: '20:00', pitchId: null, reason: '' }, 'bq-0');
    expect(mockRpc.mock.calls[0][1].p_contact_phone).toBeNull();
    expect(mockRpc.mock.calls[1][1].p_note).toBeNull();
    expect(mockRpc.mock.calls[2]).toEqual([
      'venue_add_block',
      expect.objectContaining({ p_start: '19:00', p_end: '20:00', p_pitch_id: null, p_reason: null }),
    ]);
  });
});

// ---- Block clashes (doc 28 prompt 1; spec 13 "Blocking pitches") ---------

const blockRange = { venueId: 'v1', day: '2026-11-16', start: '18:00', end: '20:00', pitchId: 'p1' };

describe('block clashes: reads and writes', () => {
  it('lists the clashes for exactly the range staff chose, and changes nothing', async () => {
    await fetchBlockClashes(blockRange);
    expect(mockRpc).toHaveBeenCalledWith('venue_block_clashes', {
      p_venue_id: 'v1',
      p_pitch_id: 'p1',
      p_day: '2026-11-16',
      p_start: '18:00',
      p_end: '20:00',
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('a whole-day block on every pitch sends nulls', async () => {
    await fetchBlockClashes({ ...blockRange, start: null, end: null, pitchId: null });
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_venue_id: 'v1',
      p_pitch_id: null,
      p_day: '2026-11-16',
      p_start: null,
      p_end: null,
    });
  });

  it('moves a booking with its id and the server’s pitch ids only', async () => {
    await moveBooking('b-app', ['p4', 'p5']);
    expect(mockRpc).toHaveBeenCalledWith('venue_move_booking', { p_booking_id: 'b-app', p_pitch_ids: ['p4', 'p5'] });
  });
});

describe('startBlock', () => {
  it('nothing clashes: saves at once with the empty list’s quote', async () => {
    const list = blockClashes({ clashes: [], venue_stripe_fee_cents: 0, quote: 'bq-empty' });
    const saved = blockSaved({ cancelled: 0, call_them: [] });
    mockRpc.mockResolvedValueOnce({ data: list, error: null }).mockResolvedValueOnce({ data: saved, error: null });
    const result = await startBlock({ ...blockRange, reason: ' Resurfacing ' });
    expect(result).toEqual({ status: 'saved', saved });
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual(['venue_block_clashes', 'venue_add_block']);
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_reason: 'Resurfacing', p_expected_quote: 'bq-empty' });
  });

  it('something clashes: returns the list and saves nothing', async () => {
    const list = blockClashes();
    mockRpc.mockResolvedValueOnce({ data: list, error: null });
    expect(await startBlock({ ...blockRange, reason: '' })).toEqual({ status: 'clashes', clashes: list });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('a refused list reads as words, and nothing is saved', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'not_venue_staff' } });
    expect(await startBlock({ ...blockRange, reason: '' })).toEqual({
      status: 'error',
      message: "You're not staff at this venue.",
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('the list changed between reading and saving: shows the new list', async () => {
    const empty = blockClashes({ clashes: [], quote: 'bq-empty' });
    const fresh = blockClashes({ quote: 'bq-2' });
    mockRpc
      .mockResolvedValueOnce({ data: empty, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'clashes_changed' } })
      .mockResolvedValueOnce({ data: fresh, error: null });
    expect(await startBlock({ ...blockRange, reason: '' })).toEqual({ status: 'clashes', clashes: fresh });
  });
});

describe('confirmBlock', () => {
  const input = { ...blockRange, reason: 'Resurfacing' };

  it('saves with exactly the quote staff saw and returns who to call', async () => {
    const saved = blockSaved();
    mockRpc.mockResolvedValueOnce({ data: saved, error: null });
    expect(await confirmBlock(input, 'bq-1')).toEqual({ status: 'saved', saved });
    expect(mockRpc).toHaveBeenCalledWith('venue_add_block', {
      p_venue_id: 'v1',
      p_pitch_id: 'p1',
      p_day: '2026-11-16',
      p_start: '18:00',
      p_end: '20:00',
      p_reason: 'Resurfacing',
      p_expected_quote: 'bq-1',
    });
  });

  it('clashes_changed: reloads the list and says so in one line', async () => {
    const fresh = blockClashes({ quote: 'bq-2' });
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'clashes_changed' } })
      .mockResolvedValueOnce({ data: fresh, error: null });
    expect(await confirmBlock(input, 'bq-1')).toEqual({
      status: 'changed',
      clashes: fresh,
      message: 'The games changed. Check the list again.',
    });
    expect(mockRpc.mock.calls[1][0]).toBe('venue_block_clashes');
  });

  it('clashes_changed and the reload fails: an error to try again', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: null, error: { message: 'clashes_changed' } })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await confirmBlock(input, 'bq-1')).toEqual({ status: 'error', message: 'Something went wrong. Try again.' });
  });

  it('legacy_booking: one line, nothing saved', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'legacy_booking' } });
    expect(await confirmBlock(input, 'bq-1')).toEqual({
      status: 'error',
      message: 'Move or cancel the older booking first.',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});

describe('block clashes: words', () => {
  it('an app booking: players in, unpaid and how they pay', () => {
    expect(appClashSummary(appClash())).toBe('7 of 10 in · 1 unpaid · Each pays');
    expect(appClashSummary(appClash({ unpaid: 0, payment_mode: 'pay_all' }))).toBe('7 of 10 in · Booker pays all');
    expect(appClashSummary(appClash({ payment_mode: 'each_pays_responsible', unpaid: 0 }))).toBe('7 of 10 in · Each pays');
    expect(appClashSummary(appClash({ payment_mode: 'gipedo_pano', unpaid: 0 }))).toBe('7 of 10 in · Gipedo Pano');
    expect(appClashSummary(appClash({ payment_mode: null, unpaid: 0, capacity: null }))).toBe('7 of 0 in');
  });

  it('a walk-in or phone booking: source, phone and what they paid (the server’s refund_cents)', () => {
    expect(counterClashSummary(counterClash())).toBe('Phone · +35799000002 · Paid €45.00');
    expect(counterClashSummary(counterClash({ source: 'walk_in', phone: null, paid: false, refund_cents: 0 }))).toBe(
      'Walk-in · Not paid',
    );
    expect(counterClashSummary(counterClash({ paid: true, refund_cents: 0 }))).toBe('Phone · +35799000002 · Free');
  });

  it('times, titles and where it can move', () => {
    expect(clashTime(appClash())).toBe('18:00–19:00');
    expect(clashTitle(appClash())).toBe('Nikos Georgiou');
    expect(clashTitle(appClash({ booker_name: null }))).toBe('App booking');
    expect(clashTitle(counterClash())).toBe('Maria');
    expect(clashTitle(counterClash({ contact_name: null, source: 'walk_in' }))).toBe('Walk-in');
    expect(moveLabel({ pitch_ids: ['p4', 'p5'], pitch_names: ['Pitch 4', 'Pitch 5'] })).toBe('Pitch 4 + Pitch 5');
  });

  it('the fee line is the server’s total, as spec 13 words it; none when it’s nothing', () => {
    expect(blockFeeLine(blockClashes())).toBe("Stripe's fees on these payments: €3.15");
    expect(blockFeeLine(blockClashes({ venue_stripe_fee_cents: 0 }))).toBeNull();
  });

  it('the counter refund line, as spec 13 words it; none when nothing was paid', () => {
    expect(counterRefundLine(4500)).toBe('They paid €45.00 at the counter — refund it.');
    expect(counterRefundLine(0)).toBeNull();
  });

  it('what saving would cancel: every clash that hasn’t started', () => {
    expect(clashesToCancel(blockClashes())).toBe(2);
    expect(
      clashesToCancel(blockClashes({ clashes: [appClash({ started: true }), counterClash({ started: true })] })),
    ).toBe(0);
  });

  it('an older (legacy) booking that hasn’t started stops the block', () => {
    expect(blocksOnLegacy(blockClashes())).toBe(false);
    expect(blocksOnLegacy(blockClashes({ clashes: [appClash({ legacy: true })] }))).toBe(true);
    expect(blocksOnLegacy(blockClashes({ clashes: [appClash({ legacy: true, started: true })] }))).toBe(false);
  });

  it('the move and block refusals in one line each', () => {
    expect(describeVenueError('clashes_changed')).toBe('The games changed. Check the list again.');
    expect(describeVenueError('legacy_booking')).toBe('Move or cancel the older booking first.');
    expect(describeVenueError('pitch_blocked')).toBe('That pitch is blocked then. Pick another.');
    expect(describeVenueError('invalid_pitches')).toBe("That pitch can't take this game. Pick another.");
    expect(describeVenueError('invalid_block_time')).toBe('Pick an end time after the start time.');
    expect(describeVenueError('not_found')).toBe('This booking is no longer there.');
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

  it('the time now is the Cyprus time, as HH:MM', () => {
    expect(cyprusNow(new Date('2026-11-15T22:30:00Z'))).toBe('00:30');
    expect(cyprusNow(new Date('2026-07-15T15:05:00Z'))).toBe('18:05');
  });

  it('a half hour is past once it has ended, in Cyprus time', () => {
    // Today at 18:10: the 17:30 half hour has ended, 18:00 hasn't.
    expect(slotIsPast('17:30', '2026-11-16', '2026-11-16', '18:10')).toBe(true);
    expect(slotIsPast('18:00', '2026-11-16', '2026-11-16', '18:10')).toBe(false);
    expect(slotIsPast('17:30', '2026-11-16', '2026-11-16', '18:00')).toBe(true);
    // Every slot of an earlier day, none of a later one.
    expect(slotIsPast('23:30', '2026-11-15', '2026-11-16', '00:10')).toBe(true);
    expect(slotIsPast('07:00', '2026-11-17', '2026-11-16', '23:50')).toBe(false);
  });

  it('weekdays are counted from Monday, on the Cyprus date', () => {
    expect(weekdayIndex('2026-11-16')).toBe(0); // Monday
    expect(weekdayIndex('2026-11-22')).toBe(6); // Sunday
  });

  it('a weekly series starts on the next such weekday from the Cyprus today', () => {
    // Today is Monday 16 November in Cyprus.
    expect(weekdayDates(0, 3, '2026-11-16')).toEqual(['2026-11-16', '2026-11-23', '2026-11-30']);
    expect(weekdayDates(6, 2, '2026-11-16')).toEqual(['2026-11-22', '2026-11-29']);
    // Sunday 15th: the next Monday is the 16th, across a month end too.
    expect(weekdayDates(0, 1, '2026-11-15')).toEqual(['2026-11-16']);
    expect(weekdayDates(1, 2, '2026-12-30')).toEqual(['2027-01-05', '2027-01-12']);
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

  it('a game must end by midnight: 23:30 takes no game, 23:00 only 60 minutes', () => {
    expect(gameEnd('22:30', 90)).toBe('24:00');
    expect(gameEnd('23:00', 60)).toBe('24:00');
    expect(gameEnd('23:00', 90)).toBeNull();
    expect(gameEnd('23:30', 60)).toBeNull();
    expect(canStartGame('23:00')).toBe(true);
    expect(canStartGame('23:30')).toBe(false);
  });

  it('places a booking on its pitch at its time', () => {
    const column = pitchColumn(dayBoard(), 'p1');
    expect(column.bookings).toEqual([{ booking: appBooking(), row: 22, span: 2, flagged: false, earlier: false }]);
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

  it('a booking that starts before 07:00 is drawn from 07:00 and marked as starting earlier, never hidden', () => {
    const early = appBooking({ id: 'b-early', start_time: '06:00:00', end_time: '07:30:00' });
    const before = appBooking({ id: 'b-before', start_time: '05:30:00', end_time: '06:30:00', pitch_ids: ['p2'] });
    const board = dayBoard({ bookings: [early, before] });
    expect(pitchColumn(board, 'p1').bookings[0]).toMatchObject({ row: 0, span: 1, earlier: true });
    expect(pitchColumn(board, 'p2').bookings[0]).toMatchObject({ row: 0, span: 1, earlier: true });
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
      "Stripe's fees on these payments: €1.37. This comes off your next payout.",
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
      "Stripe's fees on these payments: €1.37. This comes off your next payout.",
    ]);
  });

  it("shows nothing about Stripe's fees when the server says 0, or says nothing", () => {
    const zero = venueQuoteWords(venueQuote({ venue_stripe_fee_cents: 0 }), appRoster());
    expect(zero).toHaveLength(5);
    expect(zero.some((w) => w.includes('Stripe'))).toBe(false);
    const missing = venueQuoteWords(venueQuote({ venue_stripe_fee_cents: undefined }), appRoster());
    expect(missing.some((w) => w.includes('Stripe'))).toBe(false);
  });

  it('a game with nobody paid in it says so', () => {
    expect(venueQuoteWords(venueQuote({ lines: [], venue_stripe_fee_cents: 0 }), appRoster())).toEqual([
      'The booking is cancelled and its pitches are released. Every player is told.',
    ]);
  });
});

describe('quoteMovesMoney', () => {
  it('is true when anyone gets money back, credit back or cash handed back', () => {
    expect(quoteMovesMoney(venueQuote())).toBe(true);
    const credit = { ...venueQuote().lines[3], credit_used_cents: 600 };
    expect(quoteMovesMoney(venueQuote({ lines: [credit] }))).toBe(true);
    const cash = { ...venueQuote().lines[3], cash_back_cents: 600 };
    expect(quoteMovesMoney(venueQuote({ lines: [cash] }))).toBe(true);
  });

  it('is false when nobody has paid', () => {
    expect(quoteMovesMoney(venueQuote({ lines: [venueQuote().lines[3]] }))).toBe(false);
    expect(quoteMovesMoney(venueQuote({ lines: [] }))).toBe(false);
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

// P6e: venue staff offer a player to a short team (spec 13 "Venue-offered
// players"; the server is supabase/migrations/20261117153008_pay_venue_player.sql).
describe('venue players', () => {
  it('offer sends the booking id and the name only, trimmed', async () => {
    await offerVenuePlayer('b-app', '  Andreas  ');
    expect(mockRpc.mock.calls).toEqual([['offer_venue_player', { p_booking_id: 'b-app', p_name: 'Andreas' }]]);
  });

  it('withdraw sends the offer id only', async () => {
    await withdrawVenuePlayer('o1');
    expect(mockRpc.mock.calls).toEqual([['withdraw_venue_player', { p_offer_id: 'o1' }]]);
  });

  it.each([
    ['offered', { label: 'Offered, waiting for the booker', tone: 'warning' }],
    ['accepted', { label: 'Accepted', tone: 'success' }],
    ['declined', { label: 'Declined by the booker', tone: 'inkMuted' }],
    ['withdrawn', { label: 'Withdrawn', tone: 'inkMuted' }],
    ['removed', { label: 'Removed by the booker', tone: 'inkMuted' }],
    ['lapsed', { label: 'Not answered before kickoff', tone: 'inkMuted' }],
  ] as const)('names the %s state', (state, label) => {
    expect(venuePlayerStateLabel(state)).toEqual(label);
  });

  it.each([
    ['name_required', 'Enter the player’s name.'],
    ['name_too_long', 'That name is too long. Use a shorter one.'],
    ['no_empty_spot', 'Every spot in this game is taken or already offered.'],
    ['not_each_pays', 'You can offer a player only when each player pays their own share.'],
    ['booking_not_confirmed', 'The booker hasn’t paid yet, so this game can’t take a player.'],
    ['counter_booking', 'You can offer a player only to an app booking.'],
    ['not_an_app_booking', 'You can offer a player only to an app booking.'],
    ['booking_started', 'This game has already started.'],
    ['offer_closed', 'The booker didn’t answer before kickoff, so this offer has closed.'],
    ['offer_not_open', 'This offer was already answered or withdrawn.'],
    ['offer_not_found', 'This offer is no longer there.'],
    // Everything else reads as the dashboard's other refusals do.
    ['booking_cancelled', 'This booking is already cancelled.'],
    ['not_venue_staff', "You're not staff at this venue."],
    ['something_new', 'Something went wrong. Try again.'],
  ])('%s', (code, words) => {
    expect(describeVenuePlayerError(code)).toBe(words);
  });
});

// P6e no-shows (spec 13 "No-shows"; the server is
// supabase/migrations/20261117180513_match_no_shows.sql): staff tick a spot
// holder who came but didn't scan, and undo only their own tick.
describe('no-shows', () => {
  it('mark arrived sends the match id and the player id only', async () => {
    await markArrived('m1', 'u2');
    expect(mockRpc.mock.calls).toEqual([['venue_mark_arrived', { p_match_id: 'm1', p_profile_id: 'u2' }]]);
  });

  it('undo arrived sends the match id and the player id only', async () => {
    await unmarkArrived('m1', 'u2');
    expect(mockRpc.mock.calls).toEqual([['venue_unmark_arrived', { p_match_id: 'm1', p_profile_id: 'u2' }]]);
  });

  it.each([
    ['checked_in', 'qr', { label: 'Checked in', tone: 'success' }],
    ['checked_in', 'captain', { label: 'Checked in', tone: 'success' }],
    ['checked_in', 'venue', { label: 'Ticked by venue', tone: 'success' }],
    ['not_yet', null, { label: 'Not checked in yet', tone: 'inkMuted' }],
    ['missing', null, { label: "Didn't check in", tone: 'warning' }],
    ['no_show', null, { label: 'No-show', tone: 'danger' }],
  ] as const)('names %s (%s)', (attendance, method, label) => {
    expect(attendanceLabel(attendance, method)).toEqual(label);
  });

  it('shows nothing with no match (or a void one): the server sends null', () => {
    expect(attendanceLabel(null, null)).toBeNull();
  });

  it.each([
    [0, null],
    [1, '1 no-show here'],
    [3, '3 no-shows here'],
  ])('captions %s no-shows', (count, words) => {
    expect(noShowsCaption(count)).toBe(words);
  });

  it.each([
    ['check_in_used', "They've already voted or rated, so this can't be undone."],
    ['check_in_closed', 'Check-in for this game is closed.'],
    ['not_in_match', "This player doesn't hold a spot in this game."],
    ['not_checked_in', "This player isn't checked in."],
    ['not_venue_check_in', 'They checked in themselves or their captain ticked them, so this can’t be undone here.'],
    ['match_not_found', 'This game is no longer there.'],
    // Everything else reads as the dashboard's other refusals do.
    ['not_venue_staff', "You're not staff at this venue."],
    ['something_new', 'Something went wrong. Try again.'],
  ])('%s', (code, words) => {
    expect(describeAttendanceError(code)).toBe(words);
  });
});
