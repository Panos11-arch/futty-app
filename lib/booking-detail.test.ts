import {
  addDetailToCalendar,
  calendarBookingFrom,
  calendarMessage,
  cancelledMessage,
  confirmCancellation,
  countdownLabel,
  cutoffPassed,
  cyprusTimeLabel,
  describeQuote,
  paymentDeadlineLabel,
  rosterRow,
  shareText,
  syncDetailInCalendar,
  type BookingDetailData,
  type CancelDeps,
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

/** A card player who has paid €6.80, in the middle window unless overridden. */
function cardPlayer(overrides: Partial<BookingDetailData> = {}, me: Partial<NonNullable<BookingDetailData['me']>> = {}) {
  const detail = playerDetail(overrides);
  return {
    ...detail,
    me: { ...detail.me!, status: 'paid', payment_method: 'card' as const, amount_cents: 680, cash_cents: 0, free_until: null, ...me },
  };
}

describe('countdownLabel (spec 13, "Cancellations and refunds")', () => {
  it('in the free hour: free cancellation', () => {
    const detail = cardPlayer({ next_cutoff: { kind: 'free_hour_ends', at: at(42) } }, { status: 'authorized', free_until: at(42) });
    expect(countdownLabel(detail, now)).toBe('Free cancellation ends in 42 min');
  });

  it('a free hour that lasts until refunds stop is still free', () => {
    const detail = cardPlayer({ next_cutoff: { kind: 'refunds_stop', at: at(50) } }, { status: 'authorized', free_until: at(55) });
    expect(countdownLabel(detail, now)).toBe('Free cancellation ends in 50 min');
  });

  it('after the free hour: credit at the venue minus the server’s fee, not a refund', () => {
    const label = (minutes: number) => countdownLabel(cardPlayer({ next_cutoff: { kind: 'refunds_stop', at: at(minutes) } }), now);
    expect(label(180)).toBe('Cancel in the next 3 h and you get credit at Nuevo Campo, minus €1.00.');
    expect(label(185)).toBe('Cancel in the next 3 h 5 min and you get credit at Nuevo Campo, minus €1.00.');
    expect(label(28 * 60)).toBe('Cancel in the next 1 d 4 h and you get credit at Nuevo Campo, minus €1.00.');
    expect(label(48 * 60)).toBe('Cancel in the next 2 d and you get credit at Nuevo Campo, minus €1.00.');
  });

  it('the fee is the server’s, not the app’s', () => {
    const detail = cardPlayer({ next_cutoff: { kind: 'refunds_stop', at: at(180) }, cancellation: { fee_cents: 150, free_minutes: 60, refund_cutoff_hours: 6 } });
    expect(countdownLabel(detail, now)).toBe('Cancel in the next 3 h and you get credit at Nuevo Campo, minus €1.50.');
  });

  it('the booker who paid for everyone: the fee for each player', () => {
    const base = cardPlayer({ is_booker: true, next_cutoff: { kind: 'refunds_stop', at: at(180) } }, { amount_cents: 6550 });
    const detail = { ...base, booking: { ...base.booking, payment_mode: 'pay_all' as const } };
    expect(countdownLabel(detail, now)).toBe('Cancel in the next 3 h and you get credit at Nuevo Campo, minus €1.00 for each player.');
  });

  it('paid with credit only: the credit comes back, minus up to the fee', () => {
    const detail = cardPlayer({ next_cutoff: { kind: 'refunds_stop', at: at(180) } }, { amount_cents: 0 });
    expect(countdownLabel(detail, now)).toBe('Cancel in the next 3 h and your credit at Nuevo Campo comes back, minus up to €1.00.');
  });

  it('a cash player after the free hour: the fee is kept either way, so no countdown', () => {
    const detail = playerDetail({ next_cutoff: { kind: 'refunds_stop', at: at(180) } });
    expect(countdownLabel(detail, now)).toBeNull();
    expect(countdownLabel(playerDetail({ next_cutoff: { kind: 'free_hour_ends', at: at(30) } }), now)).toBe(
      'Free cancellation ends in 30 min',
    );
  });

  it('refunds have stopped: nothing back', () => {
    expect(countdownLabel(cardPlayer({ next_cutoff: null }), now)).toBe('Cancelling now gives no money back.');
  });

  it('only for a player who has paid', () => {
    const next = { kind: 'refunds_stop' as const, at: at(180) };
    expect(countdownLabel(cardPlayer({ next_cutoff: next }, { status: 'pending' }), now)).toBeNull();
    expect(countdownLabel(cardPlayer({ next_cutoff: next }, { status: 'covered' }), now)).toBeNull();
    expect(countdownLabel(cardPlayer({ next_cutoff: null }, { status: 'pending' }), now)).toBeNull();
    expect(countdownLabel({ ...cardPlayer({ next_cutoff: next }), me: null }, now)).toBeNull();
  });

  it('rounds a part minute up, so it never reads "0 min" before the cutoff', () => {
    const detail = cardPlayer({ next_cutoff: { kind: 'free_hour_ends', at: new Date(now.getTime() + 10_000).toISOString() } });
    expect(countdownLabel(detail, now)).toBe('Free cancellation ends in 1 min');
  });

  it('passed: no label, and cutoffPassed says so', () => {
    expect(countdownLabel(cardPlayer({ next_cutoff: { kind: 'refunds_stop', at: at(0) } }), now)).toBeNull();
    expect(cutoffPassed({ kind: 'refunds_stop', at: at(0) }, now)).toBe(true);
    expect(cutoffPassed({ kind: 'refunds_stop', at: at(1) }, now)).toBe(false);
    expect(cutoffPassed(null, now)).toBe(false);
  });
});

describe('paymentDeadlineLabel', () => {
  const pending = (overrides: Partial<BookingDetailData['booking']> = {}, isBooker = true) => {
    const detail = bookerDetail({ is_booker: isBooker });
    return {
      ...detail,
      booking: { ...detail.booking, status: 'pending_payment', payment_window_ends_at: '2026-11-16T08:15:00+00:00', ...overrides },
    };
  };

  it('the booker of a booking waiting for payment: the server’s deadline, in Cyprus time', () => {
    expect(paymentDeadlineLabel(pending())).toBe('Pay by 10:15 or the booking is released.');
  });

  it('summer time in Cyprus is UTC+3', () => {
    expect(cyprusTimeLabel('2026-07-01T08:15:00Z')).toBe('11:15');
  });

  it('nothing once confirmed, for other players, or without a window', () => {
    expect(paymentDeadlineLabel(pending({ status: 'confirmed' }))).toBeNull();
    expect(paymentDeadlineLabel(pending({}, false))).toBeNull();
    expect(paymentDeadlineLabel(pending({ payment_window_ends_at: null }))).toBeNull();
  });
});

describe('describeQuote', () => {
  it('my spot in the middle window: what is kept and what becomes credit', () => {
    expect(describeQuote(mySpotQuote(), 'Nuevo Campo')).toEqual([
      'Your spot opens up and the other players are told.',
      '€1.00 is kept. €5.80 becomes credit at Nuevo Campo.',
    ]);
  });

  describe('my spot in the free hour: everything back, said as the server’s line says it', () => {
    const free = (overrides: Parameters<typeof line>[0]) =>
      describeQuote(mySpotQuote({ lines: [line({ window: 'free', value_cents: 680, refund_cents: 680, ...overrides })] }), 'Nuevo Campo')[1];

    it('a card hold: the hold is released', () => {
      expect(free({ profile_id: 'p2', action: 'release', paid_cents: 680, stripe_intent_id: 'pi_1' })).toBe(
        'You get €6.80 back. The hold on your card is released.',
      );
    });

    it('paid with credit only: the credit goes back, no card hold mentioned', () => {
      expect(free({ profile_id: 'p2', action: 'release', paid_cents: 0, credit_used_cents: 680, stripe_intent_id: null })).toBe(
        'You get €6.80 back. It goes back to your credit at Nuevo Campo.',
      );
    });

    it('card and credit: both', () => {
      expect(free({ profile_id: 'p2', action: 'release', paid_cents: 180, credit_used_cents: 500, stripe_intent_id: 'pi_2' })).toBe(
        'You get €6.80 back: the hold on your card is released and €5.00 goes back to your credit at Nuevo Campo.',
      );
    });

    it('no card payment at Stripe and no credit: just the amount', () => {
      expect(free({ profile_id: 'p2', action: 'release', paid_cents: 680, stripe_intent_id: null })).toBe('You get €6.80 back.');
    });
  });

  it('my spot less than 6 hours before kickoff: nothing back', () => {
    const quote = mySpotQuote({ lines: [line({ profile_id: 'p2', window: 'late', action: 'keep', value_cents: 680, kept_cents: 680 })] });
    expect(describeQuote(quote, 'Nuevo Campo')[1]).toBe('Nothing comes back. €6.80 is kept.');
  });

  it('an unpaid spot: nothing is charged', () => {
    const quote = mySpotQuote({ lines: [line({ profile_id: 'p2', window: null, action: 'none' })] });
    expect(describeQuote(quote, 'Nuevo Campo')[1]).toBe("You haven't paid for this spot, so nothing is charged.");
  });

  it('the whole team: the booker’s share, the others, the hold and the €6.00 charge (spec 13: 6 taken x €1)', () => {
    expect(describeQuote(wholeTeamQuote(), 'Nuevo Campo')).toEqual([
      'The booking is cancelled and the pitch is released.',
      '€1.00 is kept. €4.80 becomes credit at Nuevo Campo.',
      '2 other players get their money back in full. A player whose payment was already taken chooses a card refund or credit within 48 hours.',
      'Your guarantee hold is released.',
      "Cancelling the whole team costs €6.00 (6 players whose payment was taken). It is charged to your card when you confirm. If the charge doesn't go through, the booking is still cancelled.",
    ]);
  });

  it('one player taken: singular', () => {
    const quote = wholeTeamQuote({ booker_fee: { profile_id: 'p1', players: 1, amount_cents: 100 } });
    expect(describeQuote(quote, 'Nuevo Campo')).toContain(
      "Cancelling the whole team costs €1.00 (1 player whose payment was taken). It is charged to your card when you confirm. If the charge doesn't go through, the booking is still cancelled.",
    );
  });

  it('the guarantee is only mentioned once its hold has been placed', () => {
    const words = describeQuote(wholeTeamQuote({ guarantee_hold_placed: false }), 'Nuevo Campo');
    expect(words.some((w) => /guarantee/.test(w))).toBe(false);
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

describe('cancelledMessage', () => {
  it('says what was cancelled', () => {
    expect(cancelledMessage('my_spot', { cancelled: true })).toBe('Your spot is cancelled.');
    expect(cancelledMessage('whole_team', { cancelled: true })).toBe('The booking is cancelled.');
  });

  it('the booker’s charge, with the server’s amount', () => {
    expect(cancelledMessage('whole_team', { cancelled: true, fee: { amountCents: 600, status: 'paid' } })).toBe(
      'The booking is cancelled. €6.00 was charged to your card.',
    );
    expect(cancelledMessage('whole_team', { cancelled: true, fee: { amountCents: 600, status: 'processing' } })).toBe(
      'The booking is cancelled. The €6.00 charge is being processed.',
    );
  });

  it.each(['failed', 'retry', 'requires_action'])('a %s charge: retried until kickoff, then a debt that blocks booking', (status) => {
    expect(cancelledMessage('whole_team', { cancelled: true, fee: { amountCents: 600, status } })).toBe(
      "The booking is cancelled. The €6.00 charge didn't go through. We'll try your card again until kickoff. " +
        "Anything still unpaid then becomes a debt to Futty, and you can't book or join a game until it's paid.",
    );
  });
});

describe('confirmCancellation', () => {
  function deps(overrides: Partial<CancelDeps> = {}): jest.Mocked<CancelDeps> {
    return {
      cancel: jest.fn(async () => ({ data: { cancelled: true }, error: null })),
      quote: jest.fn(async () => ({ quote: mySpotQuote({ quote: 'q9' }) })),
      errorCode: jest.fn(async () => 'quote_changed'),
      handleNextAction: jest.fn(async () => ({})),
      removeFromCalendar: jest.fn(async () => undefined),
      ...overrides,
    } as jest.Mocked<CancelDeps>;
  }

  it('sends exactly the quote shown, and says it’s done', async () => {
    const d = deps();
    await expect(confirmCancellation('b1', { scope: 'my_spot', quote: 'q1' }, d)).resolves.toEqual({
      status: 'cancelled',
      notice: 'Your spot is cancelled.',
    });
    expect(d.cancel).toHaveBeenCalledWith('b1', { scope: 'my_spot', quote: 'q1' });
  });

  it('quote_changed: asks for the quote again and hands it back to be confirmed, cancelling nothing', async () => {
    const d = deps({ cancel: jest.fn(async () => ({ data: null, error: new Error('409') })) });
    const result = await confirmCancellation('b1', { scope: 'my_spot', quote: 'q1' }, d);
    expect(d.errorCode).toHaveBeenCalledTimes(1);
    expect(d.quote).toHaveBeenCalledWith('my_spot');
    expect(result).toEqual({ status: 'changed', quote: mySpotQuote({ quote: 'q9' }) });
    expect(d.removeFromCalendar).not.toHaveBeenCalled();
  });

  it('quote_changed but the new quote fails: shows why', async () => {
    const d = deps({
      cancel: jest.fn(async () => ({ data: null, error: new Error('409') })),
      quote: jest.fn(async () => ({ error: 'The game has started, so it can no longer be cancelled.' })),
    });
    await expect(confirmCancellation('b1', { scope: 'my_spot', quote: 'q1' }, d)).resolves.toEqual({
      status: 'error',
      message: 'The game has started, so it can no longer be cancelled.',
    });
  });

  it('another refusal is put into words', async () => {
    const d = deps({ cancel: jest.fn(async () => ({ data: null, error: new Error('403') })), errorCode: jest.fn(async () => 'use_whole_team') });
    await expect(confirmCancellation('b1', { scope: 'my_spot', quote: 'q1' }, d)).resolves.toEqual({
      status: 'error',
      message: 'You paid for everyone, so you can only cancel the whole booking.',
    });
    expect(d.quote).not.toHaveBeenCalled();
  });

  it('3-D Secure on the whole-team charge: shown after the cancel, then "being processed"', async () => {
    const d = deps({
      cancel: jest.fn(async () => ({
        data: { cancelled: true, fee: { amountCents: 600, status: 'requires_action', clientSecret: 'pi_fee_secret' } },
        error: null,
      })),
    });
    const result = await confirmCancellation('b1', { scope: 'whole_team', quote: 'q2' }, d);
    expect(d.handleNextAction).toHaveBeenCalledWith('pi_fee_secret');
    expect(result).toEqual({ status: 'cancelled', notice: 'The booking is cancelled. The €6.00 charge is being processed.' });
  });

  it('3-D Secure not completed: the booking is still cancelled, and the retry and debt are explained', async () => {
    const d = deps({
      cancel: jest.fn(async () => ({
        data: { cancelled: true, fee: { amountCents: 600, status: 'requires_action', clientSecret: 'pi_fee_secret' } },
        error: null,
      })),
      handleNextAction: jest.fn(async () => ({ error: { code: 'Canceled' } })),
    });
    const result = await confirmCancellation('b1', { scope: 'whole_team', quote: 'q2' }, d);
    expect(result.status).toBe('cancelled');
    expect(result.status === 'cancelled' && result.notice).toMatch(/didn't go through. We'll try your card again until kickoff/);
  });

  it('no 3-D Secure step when the charge went through', async () => {
    const d = deps({
      cancel: jest.fn(async () => ({ data: { cancelled: true, fee: { amountCents: 600, status: 'paid' } }, error: null })),
    });
    await confirmCancellation('b1', { scope: 'whole_team', quote: 'q2' }, d);
    expect(d.handleNextAction).not.toHaveBeenCalled();
  });

  it('cancel my spot: the calendar event is removed', async () => {
    const d = deps();
    await confirmCancellation('b1', { scope: 'my_spot', quote: 'q1' }, d);
    expect(d.removeFromCalendar).toHaveBeenCalledWith('b1');
  });

  it('a calendar failure doesn’t undo the cancellation', async () => {
    const d = deps({ removeFromCalendar: jest.fn(async () => Promise.reject(new Error('no access'))) });
    await expect(confirmCancellation('b1', { scope: 'my_spot', quote: 'q1' }, d)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('whole team: the event is left to the sync after the reload (it removes cancelled bookings)', async () => {
    const d = deps();
    await confirmCancellation('b1', { scope: 'whole_team', quote: 'q2' }, d);
    expect(d.removeFromCalendar).not.toHaveBeenCalled();
  });

  it('a booking made before P4a sends no quote', async () => {
    const d = deps();
    await confirmCancellation('b1', { scope: 'whole_team', quote: null }, d);
    expect(d.cancel).toHaveBeenCalledWith('b1', undefined);
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
