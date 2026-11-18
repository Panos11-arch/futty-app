import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { AmenitiesView } from '@/components/venue/amenities-view';
import { callsTo, refuse, resetMedia, rpc as mockRpc, storage as mockStorage } from '@/components/venue/setup-test-helpers';
import { MEDIA_VENUE } from '@/lib/venue-media.fixtures';

// Amenities (P6e; spec 13 "Venue photos, amenities and menu"): the fixed
// list, each with an optional note of up to 60 characters; "Other" needs one.
// The server checks; the screen sends what staff picked.

loadWithFile(AmenitiesView);

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args), storage: { from: () => mockStorage } },
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: {} }));

beforeEach(() => resetMedia());

describe('AmenitiesView', () => {
  it('shows every kind on the fixed list, the saved ones picked with their notes', async () => {
    await render(<AmenitiesView venueId={MEDIA_VENUE} />);
    expect(await screen.findByTestId('amenity-parking')).toBeSelected();
    expect(screen.getByTestId('amenity-showers')).toBeSelected();
    expect(screen.getByTestId('amenity-wifi')).not.toBeSelected();
    expect(screen.getByText('Other')).toBeTruthy();
    expect(screen.getByLabelText('Parking note')).toHaveDisplayValue('20 spaces');
    expect(screen.queryByLabelText('Wi-Fi note')).toBeNull();
  });

  it('saves the picked kinds in list order, with their notes', async () => {
    await render(<AmenitiesView venueId={MEDIA_VENUE} />);
    await fireEvent.press(await screen.findByTestId('amenity-wifi'));
    await fireEvent.press(screen.getByTestId('amenity-showers'));
    await fireEvent.changeText(screen.getByLabelText('Wi-Fi note'), ' Free ');
    await fireEvent.press(screen.getByText('Save amenities'));
    await waitFor(() =>
      expect(callsTo('set_venue_amenities')).toEqual([
        {
          p_venue_id: MEDIA_VENUE,
          p_amenities: [
            { kind: 'parking', note: '20 spaces' },
            { kind: 'wifi', note: 'Free' },
          ],
        },
      ]),
    );
    expect(await screen.findByText('Amenities saved.')).toBeTruthy();
  });

  it('Other without a note is refused by the server, in plain words', async () => {
    refuse('set_venue_amenities', 'invalid_amenities');
    await render(<AmenitiesView venueId={MEDIA_VENUE} />);
    await fireEvent.press(await screen.findByTestId('amenity-other'));
    expect(screen.getByLabelText('Other note')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save amenities'));
    expect(await screen.findByText('Each note can be up to 60 characters, and Other needs a note.')).toBeTruthy();
    expect(callsTo('set_venue_amenities')[0]).toMatchObject({
      p_amenities: expect.arrayContaining([{ kind: 'other', note: null }]),
    });
  });
});
