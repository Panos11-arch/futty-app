import { fetchVenueExtras, foodCard } from './venue-extras';

const mockRpc = jest.fn();
const mockSign = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    storage: { from: () => ({ createSignedUrls: (...a: unknown[]) => mockSign(...a) }) },
  },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockSign.mockReset();
});

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Item ${id}`,
  category: null,
  description: null,
  price_cents: 400,
  offer_price_cents: null,
  is_post_match_offer: false,
  offer_text: null,
  photo_path: null,
  dietary_tags: null,
  ...over,
});

describe('foodCard', () => {
  it('the name, the price, and an offer price with the normal one struck through and the After game tag', () => {
    expect(foodCard(item('a', { price_cents: 400, offer_price_cents: 300, is_post_match_offer: true }), 'https://p/a')).toEqual({
      id: 'a',
      name: 'Item a',
      photoUrl: 'https://p/a',
      price: '€3.00',
      was: '€4.00',
      afterGame: true,
    });
    expect(foodCard(item('b', { price_cents: null }), null)).toEqual({
      id: 'b',
      name: 'Item b',
      photoUrl: null,
      price: null,
      was: null,
      afterGame: false,
    });
  });
});

describe('fetchVenueExtras', () => {
  it('the venue\'s amenities by priority, its first 3 active items with signed photos, and whether it has after-game offers', async () => {
    mockRpc.mockResolvedValue({
      data: {
        amenities: [{ kind: 'parking', note: null }, { kind: 'restaurant', note: null }],
        offers: [{ id: 'c' }],
        menu: [item('a', { photo_path: 'v/a.jpg' }), item('b'), item('c', { photo_path: 'v/c.jpg', is_post_match_offer: true }), item('d', { photo_path: 'v/d.jpg' })],
      },
      error: null,
    });
    mockSign.mockResolvedValue({ data: [{ path: 'v/a.jpg', signedUrl: 'https://s/a' }, { path: 'v/c.jpg', signedUrl: 'https://s/c' }] });
    const extras = await fetchVenueExtras('v1');
    expect(mockRpc).toHaveBeenCalledWith('venue_page', { p_venue_id: 'v1' });
    expect(mockSign).toHaveBeenCalledWith(['v/a.jpg', 'v/c.jpg'], 3600);
    expect(extras.amenities).toEqual(['restaurant', 'parking']);
    expect(extras.food.map((f) => [f.id, f.photoUrl, f.afterGame])).toEqual([
      ['a', 'https://s/a', false],
      ['b', null, false],
      ['c', 'https://s/c', true],
    ]);
    expect(extras.hasAfterGameOffers).toBe(true);
  });

  it('nothing entered: nothing to show, and no photo call', async () => {
    mockRpc.mockResolvedValue({ data: { amenities: [], offers: [], menu: [] }, error: null });
    expect(await fetchVenueExtras('v1')).toEqual({ amenities: [], food: [], hasAfterGameOffers: false });
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('a refusal is an error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'venue_not_found' } });
    await expect(fetchVenueExtras('v1')).rejects.toThrow();
  });
});
