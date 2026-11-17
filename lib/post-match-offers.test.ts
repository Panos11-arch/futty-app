import { mockResultMatch } from '@/lib/match/mock';
import {
  checkOfferCode,
  describeOfferError,
  fetchPostMatchOffers,
  offerPrices,
  openIfOffers,
  openPostMatchOffer,
  redeemOfferCode,
  scoreEntered,
} from '@/lib/post-match-offers';

// A8 (spec 13, "Post-match offers"): the server returns the offers, codes and
// prices; the app sends only ids and the code staff typed, and formats what
// comes back.

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

beforeEach(() => {
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe('offerPrices', () => {
  it('shows the offer price with the normal price struck through when both exist', () => {
    expect(offerPrices({ price_cents: 400, offer_price_cents: 300 })).toEqual({ now: '€3.00', was: '€4.00' });
  });

  it('shows whichever price there is', () => {
    expect(offerPrices({ price_cents: 400, offer_price_cents: null })).toEqual({ now: '€4.00', was: null });
    expect(offerPrices({ price_cents: null, offer_price_cents: 250 })).toEqual({ now: '€2.50', was: null });
    expect(offerPrices({ price_cents: null, offer_price_cents: null })).toEqual({ now: null, was: null });
  });

  it('strikes nothing through when the two are the same', () => {
    expect(offerPrices({ price_cents: 300, offer_price_cents: 300 })).toEqual({ now: '€3.00', was: null });
  });
});

describe('the server calls', () => {
  it('sends only the ids and the typed code', async () => {
    await fetchPostMatchOffers('m1');
    await openPostMatchOffer('m1', 'i1');
    await checkOfferCode('v1', 'abc 234');
    await redeemOfferCode('v1', 'ABC234');
    expect(mockRpc.mock.calls).toEqual([
      ['post_match_offers', { p_match_id: 'm1' }],
      ['open_post_match_offer', { p_match_id: 'm1', p_item_id: 'i1' }],
      ['check_offer_code', { p_venue_id: 'v1', p_code: 'abc 234' }],
      ['redeem_offer_code', { p_venue_id: 'v1', p_code: 'ABC234' }],
    ]);
  });
});

describe('describeOfferError', () => {
  it.each([
    ['code_not_found', 'No offer with that code at this venue.'],
    ['code_already_redeemed', 'This code has already been used.'],
    ['code_expired', 'This code has expired. Codes last until midnight on the day of the match.'],
    ['own_code', "You can't redeem your own code."],
    ['not_venue_staff', 'Only staff of this venue can redeem its codes.'],
    ['offer_not_available', 'This offer is no longer available.'],
    ['not_in_match', 'Only players in this match can see its offers.'],
  ])('%s', (code, words) => {
    expect(describeOfferError({ message: code })).toBe(words);
  });

  it('falls back to a plain message', () => {
    expect(describeOfferError({ message: 'connection reset' })).toBe('Something went wrong. Try again.');
  });
});

describe('scoreEntered (the match screen shows offers on the server\'s condition)', () => {
  it('once a score was submitted, accepted, rejected or the match is confirmed', () => {
    expect(scoreEntered(mockResultMatch({ submission: {} }))).toBe(true);
    expect(scoreEntered(mockResultMatch({ submission: { response: 'accepted' }, status: 'confirmed' }))).toBe(true);
    // Decided 17 November: a rejected score still counts; the players are still at the venue.
    expect(scoreEntered(mockResultMatch({ submission: { response: 'rejected' }, status: 'disputed' }))).toBe(true);
    expect(scoreEntered(mockResultMatch({ status: 'confirmed' }))).toBe(true);
  });

  it('not before a score, for a void match, or without a venue', () => {
    expect(scoreEntered(mockResultMatch())).toBe(false);
    expect(scoreEntered(mockResultMatch({ submission: {}, status: 'void' }))).toBe(false);
    const noVenue = mockResultMatch({ submission: {} });
    expect(scoreEntered({ ...noVenue, match: { ...noVenue.match, venue_id: null } })).toBe(false);
  });
});

describe('openIfOffers (Home, after a submit or accept)', () => {
  it('opens the match screen when the server returns an offer', async () => {
    mockRpc.mockResolvedValueOnce({ data: [{ id: 'i1' }], error: null });
    const open = jest.fn();
    await openIfOffers('m1', open);
    expect(mockRpc).toHaveBeenCalledWith('post_match_offers', { p_match_id: 'm1' });
    expect(open).toHaveBeenCalledWith('m1');
  });

  it('does nothing when there are none, or the call fails', async () => {
    const open = jest.fn();
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await openIfOffers('m1', open);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'connection reset' } });
    await openIfOffers('m1', open);
    expect(open).not.toHaveBeenCalled();
  });
});
