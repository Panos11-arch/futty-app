import {
  addDetailToCalendar,
  calendarBookingFrom,
  calendarMessage,
  cancelledMessage,
  cutoffLabel,
  cutoffPassed,
  describeQuote,
  rosterRow,
  shareText,
  syncDetailInCalendar,
} from './booking-detail';
import { bookerDetail, line, mySpotQuote, playerDetail, wholeTeamQuote } from './booking-detail.fixtures';

const mockAdd = jest.fn();
const mockSync = jest.fn();
jest.mock('@/lib/calendar', () => ({
  addBookingToCalendar: (...args: unknown[]) => mockAdd(...args),
  syncBookingInCalendar: (...args: unknown[]) => mockSync(...args),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const now = new Date('2026-11-16T08:00:00Z');
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

describe('rosterRow', () => {
  const booker = bookerDetail();
  const player = playerDetail();

  it('the booker sees every amount, exactly as the server sent it (580 -> €5.80)', () => {
    expect(booker.roster.map((r) => rosterRow(r, true).amount)).toEqual([
      '€5.80',
      '€0.80 + €5.00 cash',
      '€0.80 + €5.00 cash',
      '€5.80',
    ]);
  });

  it('another player sees only their own amount', () => {
    expect(player.roster.map((r) => rosterRow(r, false).amount)).toEqual([null, '€0.80 + €5.00 cash', null, null]);
  });

  it('never shows someone else’s amount to a non-booker, even if one were sent', () => {
    const leaked = { ...player.roster[0], amount_cents: 580 };
    expect(rosterRow(leaked, false).amount).toBeNull();
  });

  it.each([
    ['in_app', 'paid', 'Paid in the app'],
    ['cash', 'cash', 'Pays cash at the venue'],
    ['cash_paid', 'paid', 'Paid in cash at the venue'],
    ['unpaid', 'unpaid', 'Not paid yet'],
    ['covered', 'paid', 'The booker paid for this spot'],
  ] as const)('%s shows the %s pill and says "%s"', (state, pill, words) => {
    const row = rosterRow({ ...player.roster[2], state }, false);
    expect(row.pill).toBe(pill);
    expect(row.subtitle).toContain(words);
  });

  it('names the player, "You" for the caller, and marks the booker', () => {
    expect(rosterRow(player.roster[1], false).title).toBe('You');
    expect(rosterRow(player.roster[0], false).title).toBe('Dimitris');
    expect(rosterRow(player.roster[0], false).subtitle).toMatch(/^Booker · /);
  });

  it('a covered spot shows no amount', () => {
    expect(rosterRow({ ...booker.roster[3], state: 'covered', amount_cents: 0 }, true).amount).toBeNull();
  });
});

describe('cutoffLabel follows the server’s cutoff', () => {
  it('free hour ending', () => {
    expect(cutoffLabel({ kind: 'free_hour_ends', at: at(42) }, now)).toBe('Free cancellation ends in 42 min');
  });

  it('refunds stopping, in hours and days', () => {
    expect(cutoffLabel({ kind: 'refunds_stop', at: at(180) }, now)).toBe('Refunds stop in 3 h');
    expect(cutoffLabel({ kind: 'refunds_stop', at: at(185) }, now)).toBe('Refunds stop in 3 h 5 min');
    expect(cutoffLabel({ kind: 'refunds_stop', at: at(28 * 60) }, now)).toBe('Refunds stop in 1 d 4 h');
    expect(cutoffLabel({ kind: 'refunds_stop', at: at(48 * 60) }, now)).toBe('Refunds stop in 2 d');
  });

  it('a different server time gives a different label', () => {
    expect(cutoffLabel({ kind: 'free_hour_ends', at: at(7) }, now)).toBe('Free cancellation ends in 7 min');
  });

  it('rounds a part minute up, so it never reads "0 min" before the cutoff', () => {
    expect(cutoffLabel({ kind: 'free_hour_ends', at: new Date(now.getTime() + 10_000).toISOString() }, now)).toBe(
      'Free cancellation ends in 1 min',
    );
  });

  it('no cutoff: refunds have stopped', () => {
    expect(cutoffLabel(null, now)).toBe('Refunds have stopped for this game');
  });

  it('passed: no label, and cutoffPassed says so', () => {
    expect(cutoffLabel({ kind: 'refunds_stop', at: at(0) }, now)).toBeNull();
    expect(cutoffPassed({ kind: 'refunds_stop', at: at(0) }, now)).toBe(true);
    expect(cutoffPassed({ kind: 'refunds_stop', at: at(1) }, now)).toBe(false);
    expect(cutoffPassed(null, now)).toBe(false);
  });
});

describe('describeQuote', () => {
  it('my spot in the middle window: what is kept and what becomes credit', () => {
    expect(describeQuote(mySpotQuote(), 'Nuevo Campo')).toEqual([
      'Your spot opens up and the other players are told.',
      '€1.00 is kept. €5.80 becomes credit at Nuevo Campo.',
    ]);
  });

  it('my spot in the free hour: everything back', () => {
    const quote = mySpotQuote({ lines: [line({ profile_id: 'p2', window: 'free', action: 'release', value_cents: 680, refund_cents: 680 })] });
    expect(describeQuote(quote, 'Nuevo Campo')[1]).toBe('You get €6.80 back. The hold on your card is released.');
  });

  it('my spot less than 6 hours before kickoff: nothing back', () => {
    const quote = mySpotQuote({ lines: [line({ profile_id: 'p2', window: 'late', action: 'keep', value_cents: 680, kept_cents: 680 })] });
    expect(describeQuote(quote, 'Nuevo Campo')[1]).toBe('Nothing comes back. €6.80 is kept.');
  });

  it('an unpaid spot: nothing is charged', () => {
    const quote = mySpotQuote({ lines: [line({ profile_id: 'p2', window: null, action: 'none' })] });
    expect(describeQuote(quote, 'Nuevo Campo')[1]).toBe("You haven't paid for this spot, so nothing is charged.");
  });

  it('the whole team: the booker’s share, the others, the hold and the €6.00 charge', () => {
    expect(describeQuote(wholeTeamQuote(), 'Nuevo Campo')).toEqual([
      'The booking is cancelled and the pitch is released.',
      '€1.00 is kept. €4.80 becomes credit at Nuevo Campo.',
      '2 other players get their money back in full. A player whose payment was already taken chooses a card refund or credit within 48 hours.',
      'Your guarantee hold is released.',
      'Cancelling the whole team costs €6.00 (6 players whose payment was taken). It is charged to your card when you confirm.',
    ]);
  });

  it('the whole team late: the others get nothing back', () => {
    const quote = wholeTeamQuote({
      lines: [
        line({ profile_id: 'p1', is_booker: true, window: 'late', action: 'keep', value_cents: 580, kept_cents: 580 }),
        line({ profile_id: 'p2', window: 'other', action: 'keep', value_cents: 580, kept_cents: 580 }),
      ],
      booker_fee: null,
    });
    expect(describeQuote(quote, 'Nuevo Campo')).toEqual([
      'The booking is cancelled and the pitch is released.',
      'Nothing comes back. €5.80 is kept.',
      '1 other player gets nothing back.',
    ]);
  });
});

describe('calendar', () => {
  beforeEach(() => {
    mockAdd.mockReset().mockResolvedValue('added');
    mockSync.mockReset().mockResolvedValue('not_in_calendar');
  });

  const expected = {
    id: 'b1',
    status: 'confirmed',
    venueName: 'Nuevo Campo',
    venueAddress: '2 Aristidou Street, Latsia',
    pitch: null,
    format: '5-a-side',
    bookingDay: '2026-11-16',
    startTime: '19:00:00',
    endTime: '20:00:00',
    players: ['Dimitris', 'Andreas', 'Maria', 'Nikos'],
  };

  it('Add to calendar is called with the booking’s details', async () => {
    await expect(addDetailToCalendar(bookerDetail())).resolves.toBe('added');
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(expected);
  });

  it('sync passes the same details', async () => {
    await syncDetailInCalendar(bookerDetail());
    expect(mockSync).toHaveBeenCalledWith(expected);
  });

  it('a player with no name falls back to their username', () => {
    const detail = bookerDetail();
    detail.roster[1] = { ...detail.roster[1], name: null, username: 'andreas7' };
    expect(calendarBookingFrom(detail).players[1]).toBe('andreas7');
  });

  it.each(['added', 'updated', 'permission_denied', 'no_calendar', 'booking_cancelled', 'unavailable'] as const)(
    '%s has a message',
    (result) => {
      expect(calendarMessage(result).length).toBeGreaterThan(0);
    },
  );
});

describe('shareText', () => {
  it('venue, day and time, and the address; no link', () => {
    expect(shareText(bookerDetail())).toBe(
      'Football at Nuevo Campo, Mon 16 Nov · 19:00–20:00. 2 Aristidou Street, Latsia, Nicosia',
    );
  });
});

describe('cancelledMessage', () => {
  it('says what was cancelled', () => {
    expect(cancelledMessage('my_spot', { cancelled: true })).toBe('Your spot is cancelled.');
    expect(cancelledMessage('whole_team', { cancelled: true })).toBe('The booking is cancelled.');
  });

  it('the booker’s charge, with the server’s amount', () => {
    expect(cancelledMessage('whole_team', { cancelled: true, fee: { amountCents: 600, status: 'paid' } })).toBe(
      'The booking is cancelled. €6.00 was charged to your card.',
    );
    expect(cancelledMessage('whole_team', { cancelled: true, fee: { amountCents: 600, status: 'failed' } })).toBe(
      "The booking is cancelled. The €6.00 charge didn't go through; we'll try again and let you know.",
    );
  });
});
