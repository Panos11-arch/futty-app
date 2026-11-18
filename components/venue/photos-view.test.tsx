import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { loadWithFile } from '@/components/ui/test-utils';
import { PhotosView } from '@/components/venue/photos-view';
import {
  callsTo,
  refuse,
  resetMedia,
  rpc as mockRpc,
  storage as mockStorage,
  writes,
} from '@/components/venue/setup-test-helpers';
import { MEDIA_VENUE, mediaPhoto, venueMedia } from '@/lib/venue-media.fixtures';

// Venue photos (P6e; spec 13 "Venue photos, amenities and menu"): staff
// confirm once that the photos are theirs, then add up to 10, in their own
// order; the first is the cover. A photo is shrunk to 1600 px JPEG, uploaded
// to <venue>/photos/<uuid>.jpg and only then registered.

loadWithFile(Image, PhotosView);

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args), storage: { from: () => mockStorage } },
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'dddddddd-0000-4000-8000-000000000009' }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ arrayBuffer: () => Promise.resolve('jpeg bytes') })),
}));
const mockLaunch = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (o: unknown) => mockLaunch(o) }));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => {
      const context = {
        resize: () => context,
        renderAsync: () => Promise.resolve({ saveAsync: () => Promise.resolve({ uri: 'file:///cache/small.jpg' }) }),
      };
      return context;
    },
  },
}));

const NEW_PATH = `${MEDIA_VENUE}/photos/dddddddd-0000-4000-8000-000000000009.jpg`;

beforeEach(() => {
  resetMedia();
  mockLaunch.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///big.jpg', width: 4000, height: 3000 }] });
});

describe('PhotosView', () => {
  it('asks for photo permission first, and offers no upload until it is given', async () => {
    resetMedia(venueMedia({ photo_permission: null, photos: [] }));
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    expect(await screen.findByText('These are our photos and Futty may show them in the app.')).toBeTruthy();
    expect(screen.queryByText('Add photo')).toBeNull();
    await fireEvent.press(screen.getByText('Confirm'));
    await waitFor(() => expect(callsTo('confirm_photo_permission')).toEqual([{ p_venue_id: MEDIA_VENUE }]));
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('shows the photos in order, the first as the cover, with how many of 10', async () => {
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    expect(await screen.findByText('3 of 10 photos')).toBeTruthy();
    expect(within(screen.getByTestId(`photo-${mediaPhoto(1).id}`)).getByText('Cover')).toBeTruthy();
    expect(within(screen.getByTestId(`photo-${mediaPhoto(2).id}`)).getByText('Photo 2')).toBeTruthy();
    expect(screen.getAllByTestId('venue-photo-image')).toHaveLength(3);
  });

  it('uploads a picked photo as a JPEG into the venue’s photos folder, then registers it', async () => {
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    await fireEvent.press(await screen.findByText('Add photo'));
    await waitFor(() => expect(callsTo('add_venue_photo')).toEqual([{ p_venue_id: MEDIA_VENUE, p_path: NEW_PATH }]));
    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'] }));
    expect(mockStorage.upload).toHaveBeenCalledWith(NEW_PATH, 'jpeg bytes', { contentType: 'image/jpeg', upsert: false });
  });

  it('cancelling the picker changes nothing', async () => {
    mockLaunch.mockResolvedValue({ canceled: true, assets: null });
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    await fireEvent.press(await screen.findByText('Add photo'));
    await waitFor(() => expect(mockLaunch).toHaveBeenCalled());
    expect(writes()).toEqual([]);
    expect(mockStorage.upload).not.toHaveBeenCalled();
  });

  it('at 10 photos there is no Add photo, and the picker never opens', async () => {
    resetMedia(venueMedia({ photos: Array.from({ length: 10 }, (_, i) => mediaPhoto(i)) }));
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    expect(await screen.findByText('10 of 10 photos')).toBeTruthy();
    expect(screen.queryByText('Add photo')).toBeNull();
    expect(screen.getByText('You have the most photos a venue can have. Remove one to add another.')).toBeTruthy();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it('a refused photo is removed from storage and the reason shown in words', async () => {
    refuse('add_venue_photo', 'too_many_photos');
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    await fireEvent.press(await screen.findByText('Add photo'));
    expect(
      await screen.findByText('You already have as many photos as a venue can have. Remove one to add another.'),
    ).toBeTruthy();
    expect(mockStorage.remove).toHaveBeenCalledWith([NEW_PATH]);
  });

  it('makes a photo the cover, sending every photo in the new order', async () => {
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    await fireEvent.press(await screen.findByTestId(`photo-cover-${mediaPhoto(3).id}`));
    await waitFor(() =>
      expect(callsTo('reorder_venue_photos')).toEqual([
        { p_venue_id: MEDIA_VENUE, p_photo_ids: [mediaPhoto(3).id, mediaPhoto(1).id, mediaPhoto(2).id] },
      ]),
    );
  });

  it('moves a photo later', async () => {
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    await fireEvent.press(await screen.findByTestId(`photo-later-${mediaPhoto(1).id}`));
    await waitFor(() =>
      expect(callsTo('reorder_venue_photos')[0]).toEqual({
        p_venue_id: MEDIA_VENUE,
        p_photo_ids: [mediaPhoto(2).id, mediaPhoto(1).id, mediaPhoto(3).id],
      }),
    );
  });

  it('removes a photo after a second tap, and deletes its file', async () => {
    mockRpc.mockClear();
    await render(<PhotosView venueId={MEDIA_VENUE} />);
    await fireEvent.press(await screen.findByTestId(`photo-remove-${mediaPhoto(2).id}`));
    expect(writes()).toEqual([]);
    await fireEvent.press(screen.getByText('Remove photo'));
    await waitFor(() => expect(callsTo('remove_venue_photo')).toEqual([{ p_photo_id: mediaPhoto(2).id }]));
  });
});
