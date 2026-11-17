import { fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { Modal } from 'react-native';

import { PostMatchOffers } from '@/components/offers/post-match-offers';
import { loadWithFile } from '@/components/ui/test-utils';

// A8 (spec 13, "Post-match offers"): the match screen lists the offers the
// server returns, with photo, prices and offer text; tapping one shows the
// player's code. The app computes nothing.

loadWithFile(Modal, Image, PostMatchOffers);

const mockRpc = jest.fn();
const mockSign = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: { from: () => ({ createSignedUrls: (...args: unknown[]) => mockSign(...args) }) },
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const wrap = {
  id: 'i1',
  name: 'Lunch wrap',
  description: null,
  offer_text: 'Wrap and a drink after your match',
  price_cents: 400,
  offer_price_cents: 300,
  photo_path: 'V001/items/wrap.jpg',
};
const lemonade = { ...wrap, id: 'i2', name: 'Lemonade', offer_text: null, price_cents: 250, offer_price_cents: null, photo_path: null };

beforeEach(() => {
  mockRpc.mockReset();
  mockSign.mockReset();
  mockSign.mockResolvedValue({ data: [{ path: wrap.photo_path, signedUrl: 'https://signed/wrap' }], error: null });
});

describe('PostMatchOffers', () => {
  it('lists each offer with its photo, prices and offer text', async () => {
    mockRpc.mockResolvedValueOnce({ data: [wrap, lemonade], error: null });
    await render(<PostMatchOffers matchId="m1" />);
    await screen.findByText('Post-match offers');
    expect(mockRpc).toHaveBeenCalledWith('post_match_offers', { p_match_id: 'm1' });
    expect(screen.getByText('Lunch wrap')).toBeTruthy();
    expect(screen.getByText('€3.00')).toBeTruthy();
    expect(screen.getByLabelText('was €4.00')).toBeTruthy();
    expect(screen.getByText('Wrap and a drink after your match')).toBeTruthy();
    expect(screen.getByLabelText('Lunch wrap').props.source).toEqual([{ uri: 'https://signed/wrap' }]);
    expect(screen.getByText('€2.50')).toBeTruthy();
  });

  it('shows nothing when no offer is on', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await render(<PostMatchOffers matchId="m1" />);
    expect(mockRpc).toHaveBeenCalled();
    expect(screen.queryByText('Post-match offers')).toBeNull();
  });

  it('tapping an offer shows "Show this at the counter" with the code', async () => {
    mockRpc.mockResolvedValueOnce({ data: [wrap], error: null }).mockResolvedValueOnce({
      data: { code: 'K7M2QX', expires_at: '2026-12-02T22:00:00Z', redeemed_at: null, offer: wrap },
      error: null,
    });
    await render(<PostMatchOffers matchId="m1" />);
    await fireEvent.press(await screen.findByLabelText('Lunch wrap, show the code'));
    expect(mockRpc).toHaveBeenLastCalledWith('open_post_match_offer', { p_match_id: 'm1', p_item_id: 'i1' });
    expect(await screen.findByText('Show this at the counter')).toBeTruthy();
    expect(screen.getByText('K7M2QX')).toBeTruthy();
    expect(screen.getByText(/Valid until midnight/)).toBeTruthy();
  });

  it('says when the code has been redeemed', async () => {
    mockRpc.mockResolvedValueOnce({ data: [wrap], error: null }).mockResolvedValueOnce({
      data: { code: 'K7M2QX', expires_at: '2026-12-02T22:00:00Z', redeemed_at: '2026-12-02T15:00:00Z', offer: wrap },
      error: null,
    });
    await render(<PostMatchOffers matchId="m1" />);
    await fireEvent.press(await screen.findByLabelText('Lunch wrap, show the code'));
    expect(await screen.findByText('Redeemed.')).toBeTruthy();
  });

  it('an offer that has just ended says so and reloads the list', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: [wrap], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'offer_not_available' } })
      .mockResolvedValueOnce({ data: [], error: null });
    await render(<PostMatchOffers matchId="m1" />);
    await fireEvent.press(await screen.findByLabelText('Lunch wrap, show the code'));
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRpc).toHaveBeenLastCalledWith('post_match_offers', { p_match_id: 'm1' });
  });
});
