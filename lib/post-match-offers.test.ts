import {
  checkOfferCode,
  describeOfferError,
  fetchPostMatchOffers,
  offerPrices,
  openPostMatchOffer,
  redeemOfferCode,
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
