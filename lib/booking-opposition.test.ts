import {
  acceptOpposition,
  cancelFree,
  fetchNoOpponentChoices,
  fetchOppositionInvite,
  inviteOpposition,
  noOpponentLines,
  payOtherHalf,
  payWholeLabel,
  publishBooking,
  rosterBySide,
  searchTeams,
  sideRow,
  unpublishPost,
} from './booking-opposition';
import { v2Fixture } from './booking-opposition.fixtures';
import { describeBookingErrorMessage } from './booking-errors';
import { primeRules } from './rules.fixtures';

const mockRpc = jest.fn();
const mockInvoke = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    functions: { invoke: (...a: unknown[]) => mockInvoke(...a) },
    from: (...a: unknown[]) => mockFrom(...a),
  },
}));
jest.mock('@/lib/edge-functions', () => ({ describeFunctionError: async (e: Error) => e.message }));

beforeEach(() => {
  jest.resetAllMocks();
  primeRules();
});

describe('the sides, in words', () => {
  it('each side: its captain (and team), how it pays, and whether he has paid or is held', () => {
    const [a, b] = v2Fixture().sides;
    expect(sideRow(a)).toEqual({ title: 'Side A · Andreas', subtitle: 'Pays for everyone', pill: 'held' });
    expect(sideRow(b)).toEqual({ title: 'Side B · Bambos (Lions)', subtitle: 'Pays for myself', pill: 'unpaid' });
    expect(sideRow({ ...a, state: 'paid' }).pill).toBe('paid');
    expect(sideRow({ ...a, state: 'left' })).toEqual({ title: 'Side A · Andreas', subtitle: 'Left the game', pill: null });
  });

  it('splits the roster by side, in the roster’s order', () => {
    const roster = [{ share_id: 's1' }, { share_id: 's2' }, { share_id: 's3' }, { share_id: 's9' }];
    expect(rosterBySide(roster, v2Fixture().roster_sides)).toEqual({
      a: [{ share_id: 's1' }, { share_id: 's9' }],
      b: [{ share_id: 's2' }, { share_id: 's3' }],
    });
  });
});

describe('the no-opponent choice (spec 13 "No side B by 24 hours before kickoff")', () => {
  const info = { due: true, choice: null, pitch_cents: 2000, fee_cents: 275, amount_cents: 2275, choose_by: '2026-11-26T12:00:00Z' };

  it('says what to choose and by when, in Cyprus time, and the server’s amount (example 6a)', () => {
    expect(noOpponentLines(info)).toEqual({
      title: 'No opponent yet',
      body: "Nobody has taken on your game. Choose by Thu 26 Nov, 14:00, or it's cancelled free.",
    });
    expect(payWholeLabel(2275)).toBe('Pay €22.75 and play');
    expect(payWholeLabel(2400)).toBe('Pay €24.00 and play');
  });
});

describe('server calls', () => {
  it('invites players by username and teams by id', async () => {
    mockRpc.mockImplementation(async (fn: string) =>
      fn === 'find_profile_by_username' ? { data: [{ id: 'p9', username: 'nikos' }], error: null } : { data: 2, error: null },
    );
    expect(await inviteOpposition('b1', { usernames: ['nikos'], teamIds: ['t1'] })).toEqual({ sent: 2 });
    expect(mockRpc).toHaveBeenCalledWith('invite_opposition', { p_booking_id: 'b1', p_profile_ids: ['p9'], p_team_ids: ['t1'] });
  });

  it('an unknown username is named, and nothing is sent', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    expect(await inviteOpposition('b1', { usernames: ['ghost'], teamIds: [] })).toEqual({ error: 'No player called ghost.' });
    expect(mockRpc).not.toHaveBeenCalledWith('invite_opposition', expect.anything());
  });

  it('a refusal is in words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'opposition_closed' } });
    expect(await inviteOpposition('b1', { usernames: [], teamIds: ['t1'] })).toEqual({
      error: describeBookingErrorMessage('opposition_closed'),
    });
  });

  it('searches teams by name, the ones you follow first', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({
        data: [
          { id: 't1', name: 'Apollon', city: null },
          { id: 't2', name: 'Apoel', city: 'Nicosia' },
        ],
        error: null,
      }),
    };
    mockFrom.mockReturnValue(chain);
    expect(await searchTeams('apo', new Set(['t2']))).toEqual([
      { id: 't2', name: 'Apoel', city: 'Nicosia' },
      { id: 't1', name: 'Apollon', city: null },
    ]);
    expect(chain.ilike).toHaveBeenCalledWith('name', '%apo%');
  });

  it('a short search asks the server nothing', async () => {
    expect(await searchTeams(' a ', new Set())).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('finds the invite, and accepts it with a way to pay; the server returns the share to pay', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ invite_id: 'i1', found: false }, { invite_id: 'i2', found: true }], error: null });
    expect(await fetchOppositionInvite('i2')).toEqual({ invite_id: 'i2', found: true });
    mockRpc.mockResolvedValueOnce({ data: { booking_id: 'b1', share_id: 's9', amount_cents: 2275 }, error: null });
    expect(await acceptOpposition('i2', 'pay_all')).toEqual({ accepted: { booking_id: 'b1', share_id: 's9', amount_cents: 2275 } });
    expect(mockRpc).toHaveBeenLastCalledWith('accept_opposition', { p_invite_id: 'i2', p_mode: 'pay_all' });
  });

  it('B1d: a Losers pay game is accepted knowingly', async () => {
    mockRpc.mockResolvedValueOnce({ data: { booking_id: 'b1', share_id: 's9', amount_cents: 960 }, error: null });
    await acceptOpposition('i2', 'each_pays_responsible', true);
    expect(mockRpc).toHaveBeenLastCalledWith('accept_opposition', {
      p_invite_id: 'i2',
      p_mode: 'each_pays_responsible',
      p_losers_pay: true,
    });
  });

  it('an invite that is gone is an error', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchOppositionInvite('i9')).rejects.toThrow('This invite is no longer open.');
  });

  it('another captain was first: "Opposition found"', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'opposition_found' } });
    expect(await acceptOpposition('i1', 'pay_all')).toEqual({ error: 'Opposition found. Another captain accepted first.' });
  });

  it('cancel free, publish and unpublish go to the server', async () => {
    mockRpc.mockResolvedValue({ data: { id: 'post1' }, error: null });
    expect(await cancelFree('b1')).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('booking_no_opponent_choice', { p_booking_id: 'b1', p_choice: 'cancel' });
    expect(await publishBooking('b1', 'opposition')).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('publish_booking', { p_booking_id: 'b1', p_kind: 'opposition' });
    expect(await unpublishPost('post1')).toBeNull();
    expect(mockRpc).toHaveBeenCalledWith('unpublish_post', { p_post_id: 'post1' });
  });

  it('Home’s choices', async () => {
    mockRpc.mockResolvedValue({ data: [{ booking_id: 'b1', amount_cents: 2275 }], error: null });
    expect(await fetchNoOpponentChoices()).toEqual([{ booking_id: 'b1', amount_cents: 2275 }]);
    expect(mockRpc).toHaveBeenCalledWith('my_no_opponent_choices');
  });

  it('"Pay the whole pitch and play": the server’s payment in Stripe’s sheet', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret', amountCents: 2275 }, error: null });
    const sheet = { init: jest.fn().mockResolvedValue({}), present: jest.fn().mockResolvedValue({}) };
    expect(await payOtherHalf('b1', sheet)).toEqual({ status: 'paid' });
    expect(mockInvoke).toHaveBeenCalledWith('pay-other-half', { body: { bookingId: 'b1' } });
    expect(sheet.init).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentClientSecret: 'pi_secret' }));
  });

  it('closing the sheet changes nothing; a refusal is in words', async () => {
    mockInvoke.mockResolvedValue({ data: { clientSecret: 'pi_secret' }, error: null });
    const closed = { init: jest.fn().mockResolvedValue({}), present: jest.fn().mockResolvedValue({ error: { code: 'Canceled', message: 'x' } }) };
    expect(await payOtherHalf('b1', closed)).toEqual({ status: 'cancelled' });
    mockInvoke.mockResolvedValue({ data: null, error: new Error('choice_closed') });
    expect(await payOtherHalf('b1', closed)).toEqual({ status: 'error', message: describeBookingErrorMessage('choice_closed') });
  });
});

describe('the Booking v2 refusals in words', () => {
  it.each([
    ['opposition_found', 'Opposition found. Another captain accepted first.'],
    ['opposition_closed', 'Invites close 24 hours before kickoff.'],
    ['not_invited', "You weren't invited to this game."],
    ['not_half_pitch', 'Only a half pitch has an opposition.'],
    ['booking_not_confirmed', 'Your booking is still being confirmed. Try again in a minute.'],
    ['side_not_paid', 'Pay for your side first, then publish.'],
    ['booking_full', 'Every spot is taken.'],
    ['not_your_post', "That's not your post."],
  ])('%s', (code, words) => {
    expect(describeBookingErrorMessage(code)).toBe(words);
  });
});
