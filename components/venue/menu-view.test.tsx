import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { Modal } from 'react-native';

import { loadWithFile } from '@/components/ui/test-utils';
import { MenuView } from '@/components/venue/menu-view';
import {
  callsTo,
  refuse,
  resetMedia,
  rpc as mockRpc,
  storage as mockStorage,
  writes,
} from '@/components/venue/setup-test-helpers';
import { MEDIA_VENUE, venueMedia } from '@/lib/venue-media.fixtures';

// The food and drink menu (P6e; spec 13 "Venue photos, amenities and menu"):
// staff add, edit, reorder, switch off and delete items. Prices are typed in
// euros and read as whole cents (parseEurosInput); the server decides what
// is allowed: a price above €0, and an offer price above €0 and below it.

loadWithFile(Modal, Image, MenuView);

jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => mockRpc(fn, args), storage: { from: () => mockStorage } },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('expo-crypto', () => ({ randomUUID: () => 'eeeeeeee-0000-4000-8000-000000000001' }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ arrayBuffer: () => Promise.resolve('jpeg bytes') })),
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: () =>
    Promise.resolve({ canceled: false, assets: [{ uri: 'file:///wrap.jpg', width: 1000, height: 800 }] }),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => {
      const context = {
        resize: () => context,
        renderAsync: () => Promise.resolve({ saveAsync: () => Promise.resolve({ uri: 'file:///cache/wrap.jpg' }) }),
      };
      return context;
    },
  },
}));

beforeEach(() => resetMedia());

async function openItem(id: string) {
  await render(<MenuView venueId={MEDIA_VENUE} />);
  await fireEvent.press(await screen.findByTestId(`item-${id}`));
}

async function openNew() {
  await render(<MenuView venueId={MEDIA_VENUE} />);
  await fireEvent.press(await screen.findByText('Add item'));
}

describe('MenuView', () => {
  it('lists the items by category, uncategorised last, with the server’s prices', async () => {
    await render(<MenuView venueId={MEDIA_VENUE} />);
    const drinks = await screen.findByTestId('menu-group-Drinks');
    expect(within(drinks).getByText('Frappé')).toBeTruthy();
    expect(within(drinks).getByText('Keo beer')).toBeTruthy();
    expect(within(screen.getByTestId('menu-group-Food')).getByText('Halloumi wrap')).toBeTruthy();
    expect(within(screen.getByTestId('menu-group-Other')).getByText('Ice cream')).toBeTruthy();
    expect(screen.getByTestId('item-i1')).toHaveTextContent(/€3\.50/);
    expect(screen.getByTestId('item-i2')).toHaveTextContent(/€4\.00 · post-match offer €3\.00/);
    expect(screen.getByTestId('item-i4')).toHaveTextContent(/Switched off/);
  });

  it('adds an item with its price as whole cents', async () => {
    await openNew();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Lemonade');
    await fireEvent.changeText(screen.getByLabelText('Category'), 'Drinks');
    await fireEvent.changeText(screen.getByLabelText('Price'), '3,50');
    await fireEvent.changeText(screen.getByLabelText('Dietary tags'), 'vegan, gluten free,');
    await fireEvent.press(screen.getByText('Save item'));
    await waitFor(() => expect(callsTo('save_menu_item')).toHaveLength(1));
    expect(callsTo('save_menu_item')[0]).toEqual({
      p_venue_id: MEDIA_VENUE,
      p_item_id: null,
      p_item: {
        name: 'Lemonade',
        category: 'Drinks',
        description: null,
        price_cents: 350,
        is_post_match_offer: false,
        offer_price_cents: null,
        offer_text: null,
        available_from: null,
        available_to: null,
        available_weekdays: null,
        dietary_tags: ['vegan', 'gluten free'],
        active: true,
      },
    });
  });

  it("a €0 price goes to the server and is stopped with the server's words", async () => {
    refuse('save_menu_item', 'invalid_price');
    await openNew();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Water');
    await fireEvent.changeText(screen.getByLabelText('Price'), '0');
    await fireEvent.press(screen.getByText('Save item'));
    expect(await screen.findByText('The price must be more than €0.')).toBeTruthy();
    expect(callsTo('save_menu_item')[0]).toMatchObject({ p_item: { price_cents: 0 } });
  });

  it('an offer price at or above the price is stopped with the server’s words', async () => {
    refuse('save_menu_item', 'invalid_offer_price');
    await openItem('i2');
    await fireEvent.changeText(screen.getByLabelText('Offer price'), '4');
    await fireEvent.press(screen.getByText('Save item'));
    expect(
      await screen.findByText('The offer price must be more than €0 and less than the normal price.'),
    ).toBeTruthy();
    expect(callsTo('save_menu_item')[0]).toMatchObject({ p_item: { price_cents: 400, offer_price_cents: 400 } });
  });

  it('text that is not an amount is stopped in the app, calling nothing', async () => {
    await openNew();
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Water');
    await fireEvent.changeText(screen.getByLabelText('Price'), 'two euros');
    await fireEvent.press(screen.getByText('Save item'));
    expect(await screen.findByText('Enter a price like 3 or 3.50.')).toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it('editing an offer keeps its days, times and offer text', async () => {
    await openItem('i2');
    await fireEvent.changeText(screen.getByLabelText('Price'), '4.20');
    await fireEvent.press(screen.getByText('Save item'));
    await waitFor(() => expect(callsTo('save_menu_item')).toHaveLength(1));
    expect(callsTo('save_menu_item')[0]).toEqual({
      p_venue_id: MEDIA_VENUE,
      p_item_id: 'i2',
      p_item: {
        name: 'Keo beer',
        category: 'Drinks',
        description: null,
        price_cents: 420,
        is_post_match_offer: true,
        offer_price_cents: 300,
        offer_text: 'After your game',
        available_from: '17:00',
        available_to: '23:00',
        available_weekdays: [1, 2, 3, 4, 5],
        dietary_tags: [],
        active: true,
      },
    });
  });

  it('turning an item into a post-match offer with days and a window', async () => {
    await openItem('i1');
    await fireEvent.press(screen.getByLabelText('Post-match offer'));
    await fireEvent.changeText(screen.getByLabelText('Offer price'), '2.50');
    await fireEvent.press(screen.getByTestId('item-day-6'));
    await fireEvent.press(screen.getByTestId('item-day-7'));
    await fireEvent.press(screen.getByLabelText('Set times'));
    await fireEvent.press(screen.getByTestId('item-from-18:00'));
    await fireEvent.press(screen.getByTestId('item-to-22:30'));
    await fireEvent.press(screen.getByText('Save item'));
    await waitFor(() => expect(callsTo('save_menu_item')).toHaveLength(1));
    expect(callsTo('save_menu_item')[0]).toMatchObject({
      p_item: {
        is_post_match_offer: true,
        offer_price_cents: 250,
        available_weekdays: [6, 7],
        available_from: '18:00',
        available_to: '22:30',
      },
    });
  });

  it('moves an item down within its category, sending every item', async () => {
    await openItem('i1');
    expect(screen.queryByText('Move up')).toBeNull();
    await fireEvent.press(screen.getByText('Move down'));
    await waitFor(() =>
      expect(callsTo('reorder_menu_items')).toEqual([{ p_venue_id: MEDIA_VENUE, p_item_ids: ['i2', 'i1', 'i3', 'i4'] }]),
    );
  });

  it('switches an item off and on', async () => {
    await openItem('i1');
    await fireEvent.press(screen.getByText('Switch off'));
    await waitFor(() => expect(callsTo('set_menu_item_active')).toEqual([{ p_item_id: 'i1', p_active: false }]));
  });

  it('deletes an item after a second tap, and its photo file', async () => {
    resetMedia(venueMedia());
    const path = `${MEDIA_VENUE}/items/cccccccc-0000-4000-8000-000000000001.jpg`;
    await openItem('i3');
    await fireEvent.press(screen.getByText('Delete item'));
    expect(writes()).toEqual([]);
    mockRpc.mockImplementationOnce(() => Promise.resolve({ data: path, error: null }));
    await fireEvent.press(screen.getByText('Yes, delete'));
    await waitFor(() => expect(callsTo('delete_menu_item')).toEqual([{ p_item_id: 'i3' }]));
    await waitFor(() => expect(mockStorage.remove).toHaveBeenCalledWith([path]));
  });

  it('adds a photo to an item, uploaded to the venue’s items folder', async () => {
    await openItem('i1');
    await fireEvent.press(screen.getByText('Add photo'));
    const path = `${MEDIA_VENUE}/items/eeeeeeee-0000-4000-8000-000000000001.jpg`;
    await waitFor(() => expect(callsTo('set_menu_item_photo')).toEqual([{ p_item_id: 'i1', p_path: path }]));
    expect(mockStorage.upload).toHaveBeenCalledWith(path, 'jpeg bytes', { contentType: 'image/jpeg', upsert: false });
  });

  it('without photo permission an item offers no photo upload', async () => {
    resetMedia(venueMedia({ photo_permission: null }));
    await openItem('i1');
    expect(screen.queryByText('Add photo')).toBeNull();
    expect(screen.getByText('To add photos, confirm they’re yours on the Photos screen first.')).toBeTruthy();
  });
});
