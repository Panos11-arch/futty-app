import {
  acceptOppositionPost,
  fetchOppositionPost,
  fetchPublishableBookings,
  getBookingPostQuotes,
  isPostShown,
  joinPriceText,
  postAction,
  publishGameRow,
  sideBPriceText,
  type BookingPostQuote,
  type PublishableBooking,
} from './booking-posts';
import { describeBookingErrorMessage } from './booking-errors';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

beforeEach(() => {
  jest.resetAllMocks();
});

function quote(over: Partial<BookingPostQuote> = {}): BookingPostQuote {
  return {
    post_id: 'p1',
    kind: 'players',
    side: null,
    mine: false,
    open: true,
    closes_at: '2027-01-08T10:00:00Z',
    join_cents: 480,
    join_pitch_cents: 400,
    join_fee_cents: 80,
    pay_all_cents: null,
    each_pays_cents: null,
    guarantee_cents: null,
    ...over,
  };
}

function game(over: Partial<PublishableBooking> = {}): PublishableBooking {
  return {
    booking_id: 'b1',
    venue_name: 'Arena',
    booking_day: '2027-01-08',
    start_time: '12:00:00',
    end_time: '13:00:00',
    format: '5-a-side',
    pitch_label: 'Pitch 1',
    kind: 'half',
    side: 'a',
    open_spots: 4,
    players_post_id: null,
    opposition_post_id: null,
    can_publish_players: true,
    can_publish_opposition: true,
    ...over,
  };
}

describe('what a post card offers', () => {
  it('a post made before Booking v2 (no quote) keeps its old card', () => {
    expect(postAction('players', null, false)).toBeNull();
    expect(postAction('opposition', null, false)).toBeNull();
  });

  it('my own open post: Unpublish', () => {
    expect(postAction('players', quote({ mine: true }), false)).toBe('unpublish');
    expect(postAction('opposition', quote({ kind: 'opposition', mine: true }), false)).toBe('unpublish');
  });

  it('someone else\'s: Join, or Accept as opponent', () => {
    expect(postAction('players', quote(), false)).toBe('join');
    expect(postAction('opposition', quote({ kind: 'opposition' }), false)).toBe('accept');
  });

  it('a game I joined: View booking, even once it is full', () => {
    expect(postAction('players', quote(), true)).toBe('view');
    expect(postAction('players', quote({ open: false }), true)).toBe('view');
  });

  it('closed (full, unpublished, found, 24 hours before kickoff): nothing to do', () => {
    expect(postAction('players', quote({ open: false }), false)).toBe('closed');
    expect(postAction('opposition', quote({ kind: 'opposition', open: false, mine: true }), false)).toBe('closed');
  });

  it('a closed post leaves the list unless I joined it; an old post always shows', () => {
    expect(isPostShown(null, false)).toBe(true);
    expect(isPostShown(quote(), false)).toBe(true);
    expect(isPostShown(quote({ open: false }), false)).toBe(false);
    expect(isPostShown(quote({ open: false }), true)).toBe(true);
  });
});

describe('prices, as the server gives them', () => {
  it('a joiner pays nothing when his side paid for everyone, else his own share', () => {
    expect(joinPriceText(quote({ join_cents: 0, join_pitch_cents: 0, join_fee_cents: 0 }))).toBe('Paid by the captain');
    expect(joinPriceText(quote())).toBe('€4.80 each');
    expect(joinPriceText(quote({ join_cents: 400 }))).toBe('€4.00 each');
    expect(joinPriceText(quote({ join_cents: null }))).toBeNull();
  });

  it('side B: pay for everyone, or pay for myself', () => {
    expect(sideBPriceText(quote({ kind: 'opposition', pay_all_cents: 2275, each_pays_cents: 480, guarantee_cents: 2000 }))).toBe(
      '€22.75 for your side, or €4.80 each',
    );
    expect(sideBPriceText(quote({ kind: 'opposition' }))).toBeNull();
  });
});

describe('my games to publish', () => {
  it('players: Publish while there are open spots, Unpublish once published', () => {
    expect(publishGameRow(game(), 'players')).toEqual({
      title: 'Arena',
      subtitle: 'Fri 8 Jan · 12:00–13:00 · Pitch 1 · 4 open spots',
      action: 'publish',
      postId: null,
    });
    expect(publishGameRow(game({ players_post_id: 'p9' }), 'players')).toMatchObject({ action: 'unpublish', postId: 'p9' });
    expect(publishGameRow(game({ open_spots: 0, can_publish_players: false }), 'players')).toBeNull();
    expect(publishGameRow(game({ open_spots: 1 }), 'players')?.subtitle).toMatch(/1 open spot$/);
  });

  it('opposition: only side A of a half pitch with no side B, until 24 hours before kickoff', () => {
    expect(publishGameRow(game(), 'opposition')).toMatchObject({ action: 'publish', subtitle: 'Fri 8 Jan · 12:00–13:00 · Pitch 1' });
    expect(publishGameRow(game({ opposition_post_id: 'p7' }), 'opposition')).toMatchObject({ action: 'unpublish', postId: 'p7' });
    expect(publishGameRow(game({ can_publish_opposition: false }), 'opposition')).toBeNull();
    expect(publishGameRow(game({ kind: 'whole', side: null, can_publish_opposition: false }), 'opposition')).toBeNull();
  });

  it('an open post shows Unpublish even when it could no longer be published', () => {
    expect(publishGameRow(game({ players_post_id: 'p9', can_publish_players: false }), 'players')).toMatchObject({
      action: 'unpublish',
    });
  });
});

describe('server calls', () => {
  it('quotes come 50 posts at a time, by post id', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `p${i}`);
    mockRpc.mockImplementation(async (_name: string, args: { p_post_ids: string[] }) => ({
      data: args.p_post_ids.map((id) => quote({ post_id: id })),
      error: null,
    }));
    const quotes = await getBookingPostQuotes(ids);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc.mock.calls[0]).toEqual(['booking_post_quotes', { p_post_ids: ids.slice(0, 50) }]);
    expect(quotes?.size).toBe(51);
    expect(quotes?.get('p50')?.join_cents).toBe(480);
  });

  it('no posts: no call; any failure: null, so no card shows a price that may be wrong', async () => {
    expect((await getBookingPostQuotes([]))?.size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await getBookingPostQuotes(['p1'])).toBeNull();
  });

  it('my publishable games, or the error in words', async () => {
    mockRpc.mockResolvedValueOnce({ data: [game()], error: null });
    expect(await fetchPublishableBookings()).toEqual([game()]);
    expect(mockRpc).toHaveBeenCalledWith('my_publishable_bookings');
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'not_authenticated' } });
    await expect(fetchPublishableBookings()).rejects.toThrow(describeBookingErrorMessage('not_authenticated'));
  });

  it('an opposition post for the accept screen, in the invite\'s shape', async () => {
    const row = {
      post_id: 'p1',
      booking_id: 'b1',
      venue_name: 'Arena',
      booking_day: '2027-01-08',
      start_time: '12:00:00',
      end_time: '13:00:00',
      format: '5-a-side',
      pitch_label: 'Pitch 1',
      side_pitch_cents: 2000,
      side_players: 5,
      pay_all_cents: 2275,
      each_pays_cents: 480,
      guarantee_cents: 2000,
      found: false,
      open: true,
    };
    mockRpc.mockResolvedValueOnce({ data: [row], error: null });
    const invite = await fetchOppositionPost('p1');
    expect(mockRpc).toHaveBeenCalledWith('opposition_post_detail', { p_post_id: 'p1' });
    expect(invite).toMatchObject({ invite_id: 'p1', booking_id: 'b1', team_id: null, pay_all_cents: 2275, found: false });

    // Found: the screen says "Opposition found".
    mockRpc.mockResolvedValueOnce({ data: [{ ...row, found: true, open: false }], error: null });
    expect((await fetchOppositionPost('p1')).found).toBe(true);

    // Closed (unpublished, or 24 hours before kickoff), or gone.
    mockRpc.mockResolvedValueOnce({ data: [{ ...row, open: false }], error: null });
    await expect(fetchOppositionPost('p1')).rejects.toThrow('This game is no longer open.');
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(fetchOppositionPost('p1')).rejects.toThrow('This game is no longer open.');
  });

  it('accepting a post: the server makes him side B\'s captain and returns his share', async () => {
    mockRpc.mockResolvedValueOnce({ data: { booking_id: 'b1', share_id: 's1', amount_cents: 2275 }, error: null });
    expect(await acceptOppositionPost('p1', 'pay_all')).toEqual({
      accepted: { booking_id: 'b1', share_id: 's1', amount_cents: 2275 },
    });
    expect(mockRpc).toHaveBeenCalledWith('accept_opposition_post', { p_post_id: 'p1', p_mode: 'pay_all' });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'opposition_found' } });
    expect(await acceptOppositionPost('p1', 'pay_all')).toEqual({ error: describeBookingErrorMessage('opposition_found') });
  });
});
