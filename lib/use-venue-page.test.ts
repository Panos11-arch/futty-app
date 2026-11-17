import { renderHook, waitFor } from '@testing-library/react-native';

import { useVenuePage } from '@/lib/use-venue-page';

// The venue page signs every photo it shows: the gallery, the offers and
// (P6e) the food and drink items. A photo that can't be signed is left out.

const mockRpc = jest.fn();
const mockSign = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
    storage: { from: () => ({ createSignedUrls: (paths: string[], s: number) => mockSign(paths, s) }) },
  },
}));

const page = {
  venue: { id: 'v1', name: 'Nuevo Campo' },
  photos: [{ storage_path: 'v1/photos/a.jpg', pitch_id: null }],
  offers: [{ id: 'o1', photo_path: 'v1/items/offer.jpg' }],
  menu: [
    { id: 'm1', photo_path: 'v1/items/wrap.jpg' },
    { id: 'm2', photo_path: null },
  ],
};

beforeEach(() => {
  mockRpc.mockResolvedValue({ data: page, error: null });
  mockSign.mockImplementation((paths: string[]) =>
    Promise.resolve({
      data: paths.filter((p) => p !== 'v1/items/offer.jpg').map((path) => ({ path, signedUrl: `https://signed/${path}` })),
      error: null,
    }),
  );
});

it('signs the gallery, offer and menu photos together', async () => {
  const { result } = await renderHook(() => useVenuePage('v1'));
  await waitFor(() => expect(result.current.state.status).toBe('ready'));
  expect(mockSign).toHaveBeenCalledWith(['v1/photos/a.jpg', 'v1/items/offer.jpg', 'v1/items/wrap.jpg'], 3600);
  expect(result.current.state).toMatchObject({
    photoUrls: { 'v1/photos/a.jpg': 'https://signed/v1/photos/a.jpg', 'v1/items/wrap.jpg': 'https://signed/v1/items/wrap.jpg' },
  });
});
