// P6e venue photos, amenities and menu (spec 13 "Venue photos, amenities and
// menu"): the app picks and shrinks a photo, uploads it to the venue's own
// folder, then registers it; a refused registration removes the file again.
// Everything else is the server's: these tests check what is sent, and that
// every refusal comes back in plain words.
import {
  addVenuePhoto,
  deleteMenuItem,
  describeMediaError,
  groupMenu,
  movePhoto,
  moveMenuItem,
  photoPath,
  pickAndCompressPhoto,
  removeMenuItemPhoto,
  removeVenuePhoto,
  resizeFor,
  saveMenuItem,
  setMenuItemPhoto,
  setVenueAmenities,
  type MenuItem,
  type MenuItemInput,
} from '@/lib/venue-media';

const VENUE = '11111111-1111-4111-8111-111111111111';
const UUID = 'abcdef01-2345-4678-89ab-cdef01234567';

const mockRpc = jest.fn();
const mockUpload = jest.fn();
const mockRemove = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
    storage: { from: () => ({ upload: mockUpload, remove: mockRemove }) },
  },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'ABCDEF01-2345-4678-89AB-CDEF01234567' }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({ arrayBuffer: () => Promise.resolve(`bytes of ${uri}`) })),
}));

const mockLaunch = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (o: unknown) => mockLaunch(o) }));

const mockResize = jest.fn();
const mockSave = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      const context = {
        resize: (size: unknown) => {
          mockResize(uri, size);
          return context;
        },
        renderAsync: () => Promise.resolve({ width: 4000, height: 3000, saveAsync: (o: unknown) => mockSave(o) }),
      };
      return context;
    },
  },
}));

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: null, error: null });
  mockUpload.mockReset().mockResolvedValue({ data: { path: 'x' }, error: null });
  mockRemove.mockReset().mockResolvedValue({ data: [], error: null });
  mockLaunch.mockReset();
  mockResize.mockReset();
  mockSave.mockReset().mockResolvedValue({ uri: 'file:///cache/small.jpg', width: 1600, height: 1200 });
});

function rpcNames() {
  return mockRpc.mock.calls.map(([fn]) => fn);
}

describe('resizeFor', () => {
  it('shrinks the long edge to 1600 px, keeping the ratio', () => {
    expect(resizeFor(4000, 3000)).toEqual({ width: 1600 });
    expect(resizeFor(3000, 4000)).toEqual({ height: 1600 });
    expect(resizeFor(2000, 2000)).toEqual({ width: 1600 });
  });

  it('never enlarges a photo already 1600 px or smaller', () => {
    expect(resizeFor(1600, 900)).toBeNull();
    expect(resizeFor(800, 1200)).toBeNull();
  });
});

describe('pickAndCompressPhoto', () => {
  it('opens the library for photos only, then saves a 1600 px JPEG at 0.8', async () => {
    mockLaunch.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///big.heic', width: 4000, height: 3000 }] });
    await expect(pickAndCompressPhoto()).resolves.toBe('file:///cache/small.jpg');
    expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: false }));
    expect(mockResize).toHaveBeenCalledWith('file:///big.heic', { width: 1600 });
    expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
  });

  it('still saves a small photo as JPEG, without resizing it', async () => {
    mockLaunch.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///small.png', width: 1200, height: 800 }] });
    await pickAndCompressPhoto();
    expect(mockResize).not.toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.8 });
  });

  it('uses the decoded size when the library gives none', async () => {
    mockLaunch.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x.jpg', width: 0, height: 0 }] });
    await pickAndCompressPhoto();
    expect(mockResize).toHaveBeenCalledWith('file:///x.jpg', { width: 1600 });
  });

  it('is null when staff cancel', async () => {
    mockLaunch.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickAndCompressPhoto()).resolves.toBeNull();
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('photoPath', () => {
  it('is <venue>/<photos|items>/<uuid>.jpg, lower case, as the storage policy wants it', () => {
    expect(photoPath(VENUE, 'photos')).toBe(`${VENUE}/photos/${UUID}.jpg`);
    expect(photoPath(VENUE, 'items')).toBe(`${VENUE}/items/${UUID}.jpg`);
  });
});

describe('addVenuePhoto', () => {
  it('uploads a JPEG to the photos folder (never replacing a file), then registers it', async () => {
    const { error } = await addVenuePhoto(VENUE, 'file:///cache/small.jpg');
    expect(error).toBeNull();
    expect(mockUpload).toHaveBeenCalledWith(`${VENUE}/photos/${UUID}.jpg`, 'bytes of file:///cache/small.jpg', {
      contentType: 'image/jpeg',
      upsert: false,
    });
    expect(mockRpc).toHaveBeenCalledWith('add_venue_photo', { p_venue_id: VENUE, p_path: `${VENUE}/photos/${UUID}.jpg` });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('removes the uploaded file when the server refuses it, and says why', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'too_many_photos' } });
    const { error } = await addVenuePhoto(VENUE, 'file:///cache/small.jpg');
    expect(mockRemove).toHaveBeenCalledWith([`${VENUE}/photos/${UUID}.jpg`]);
    expect(describeMediaError(error!.message)).toBe(
      'You already have as many photos as a venue can have. Remove one to add another.',
    );
  });

  it('registers nothing when the file can’t be read', async () => {
    mockUpload.mockRejectedValue(new Error('network'));
    await expect(addVenuePhoto(VENUE, 'file:///cache/small.jpg')).resolves.toEqual({ error: { message: 'upload_failed' } });
    expect(rpcNames()).toEqual([]);
  });

  it('registers nothing when the upload fails', async () => {
    mockUpload.mockResolvedValue({ data: null, error: { message: 'new row violates row-level security policy' } });
    const { error } = await addVenuePhoto(VENUE, 'file:///cache/small.jpg');
    expect(rpcNames()).toEqual([]);
    expect(error).toEqual({ message: 'upload_failed' });
    expect(describeMediaError('upload_failed')).toBe('The photo couldn’t be uploaded. Check your connection and try again.');
  });
});

describe('removing photos deletes the file the server lets go of', () => {
  it('a venue photo', async () => {
    mockRpc.mockResolvedValue({ data: `${VENUE}/photos/${UUID}.jpg`, error: null });
    await removeVenuePhoto('p1');
    expect(mockRpc).toHaveBeenCalledWith('remove_venue_photo', { p_photo_id: 'p1' });
    expect(mockRemove).toHaveBeenCalledWith([`${VENUE}/photos/${UUID}.jpg`]);
  });

  it('an imported photo is not the staff’s file to delete, so it is left', async () => {
    mockRpc.mockResolvedValue({ data: 'V001/photos/front.png', error: null });
    await removeVenuePhoto('p1');
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('nothing is deleted when the server refuses', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'photo_not_found' } });
    const { error } = await removeVenuePhoto('p1');
    expect(error).toEqual({ message: 'photo_not_found' });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('an item’s photo, and the item’s old photo when it is replaced', async () => {
    mockRpc.mockResolvedValue({ data: `${VENUE}/items/a0000000-0000-4000-8000-000000000000.jpg`, error: null });
    await setMenuItemPhoto(VENUE, 'i1', 'file:///cache/small.jpg');
    expect(mockUpload).toHaveBeenCalledWith(`${VENUE}/items/${UUID}.jpg`, expect.anything(), expect.anything());
    expect(mockRpc).toHaveBeenCalledWith('set_menu_item_photo', { p_item_id: 'i1', p_path: `${VENUE}/items/${UUID}.jpg` });
    expect(mockRemove).toHaveBeenCalledWith([`${VENUE}/items/a0000000-0000-4000-8000-000000000000.jpg`]);
  });

  it('a refused item photo removes the new file', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'photo_permission_required' } });
    await setMenuItemPhoto(VENUE, 'i1', 'file:///cache/small.jpg');
    expect(mockRemove).toHaveBeenCalledWith([`${VENUE}/items/${UUID}.jpg`]);
  });

  it('removing an item’s photo, and deleting an item', async () => {
    mockRpc.mockResolvedValue({ data: `${VENUE}/items/${UUID}.jpg`, error: null });
    await removeMenuItemPhoto('i1');
    expect(mockRpc).toHaveBeenLastCalledWith('set_menu_item_photo', { p_item_id: 'i1', p_path: null });
    await deleteMenuItem('i1');
    expect(mockRpc).toHaveBeenLastCalledWith('delete_menu_item', { p_item_id: 'i1' });
    expect(mockRemove).toHaveBeenCalledTimes(2);
  });

  it('an item without a photo deletes no file', async () => {
    await deleteMenuItem('i1');
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('setVenueAmenities', () => {
  it('sends each kind once with its trimmed note, or null', async () => {
    await setVenueAmenities(VENUE, [
      { kind: 'parking', note: '  20 spaces ' },
      { kind: 'showers', note: '' },
    ]);
    expect(mockRpc).toHaveBeenCalledWith('set_venue_amenities', {
      p_venue_id: VENUE,
      p_amenities: [
        { kind: 'parking', note: '20 spaces' },
        { kind: 'showers', note: null },
      ],
    });
  });
});

const INPUT: MenuItemInput = {
  name: ' Halloumi wrap ',
  category: 'Food',
  description: '',
  priceCents: 650,
  isPostMatchOffer: true,
  offerPriceCents: 500,
  offerText: 'After the game',
  availableFrom: '17:00',
  availableTo: '23:00',
  availableWeekdays: [1, 2, 3],
  dietaryTags: ['vegetarian'],
  active: true,
};

describe('saveMenuItem', () => {
  it('sends the item with prices in whole cents', async () => {
    await saveMenuItem(VENUE, null, INPUT);
    expect(mockRpc).toHaveBeenCalledWith('save_menu_item', {
      p_venue_id: VENUE,
      p_item_id: null,
      p_item: {
        name: 'Halloumi wrap',
        category: 'Food',
        description: null,
        price_cents: 650,
        is_post_match_offer: true,
        offer_price_cents: 500,
        offer_text: 'After the game',
        available_from: '17:00',
        available_to: '23:00',
        available_weekdays: [1, 2, 3],
        dietary_tags: ['vegetarian'],
        active: true,
      },
    });
  });

  it('an item that isn’t an offer sends no offer price or text', async () => {
    await saveMenuItem(VENUE, 'i1', { ...INPUT, isPostMatchOffer: false });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({
      p_item_id: 'i1',
      p_item: { is_post_match_offer: false, offer_price_cents: null, offer_text: null },
    });
  });

  it('a €0 price and an offer at or above the price are refused in plain words', () => {
    expect(describeMediaError('invalid_price')).toBe('The price must be more than €0.');
    expect(describeMediaError('invalid_offer_price')).toBe(
      'The offer price must be more than €0 and less than the normal price.',
    );
  });
});

describe('describeMediaError', () => {
  it.each([
    'photo_permission_required',
    'invalid_photo_path',
    'photo_path_in_use',
    'photo_file_missing',
    'too_many_photos',
    'photo_not_found',
    'photo_list_mismatch',
    'invalid_amenities',
    'item_not_found',
    'invalid_name',
    'invalid_category',
    'invalid_description',
    'invalid_price',
    'invalid_offer_price',
    'invalid_offer_text',
    'invalid_window',
    'invalid_weekdays',
    'invalid_dietary_tags',
    'item_name_taken',
    'item_list_mismatch',
    'not_venue_staff',
    'not_authenticated',
    'upload_failed',
    'picker_failed',
  ])('puts %s into words, never the code', (code) => {
    const words = describeMediaError(code);
    expect(words).not.toContain(code);
    expect(words).toMatch(/[.]$/);
  });
});

function item(id: string, category: string | null, extra: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    name: `Item ${id}`,
    category,
    description: null,
    price_cents: 300,
    offer_price_cents: null,
    is_post_match_offer: false,
    offer_text: null,
    available_from: null,
    available_to: null,
    available_weekdays: null,
    dietary_tags: null,
    photo_path: null,
    active: true,
    sort_order: 0,
    ...extra,
  };
}

describe('groupMenu', () => {
  it('groups the server’s order by category, uncategorised last, keeping the order inside each', () => {
    const groups = groupMenu([item('a', 'Drinks'), item('b', 'Drinks'), item('c', 'Food'), item('d', null)]);
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([
      ['Drinks', ['a', 'b']],
      ['Food', ['c']],
      ['Other', ['d']],
    ]);
  });

  it('a menu with no categories is one group without a title', () => {
    expect(groupMenu([item('a', null), item('b', null)])).toEqual([{ title: null, items: [item('a', null), item('b', null)] }]);
    expect(groupMenu([])).toEqual([]);
  });
});

describe('moving', () => {
  it('a photo earlier, later or to the cover', () => {
    expect(movePhoto(['a', 'b', 'c'], 'c', 'earlier')).toEqual(['a', 'c', 'b']);
    expect(movePhoto(['a', 'b', 'c'], 'a', 'later')).toEqual(['b', 'a', 'c']);
    expect(movePhoto(['a', 'b', 'c'], 'c', 'cover')).toEqual(['c', 'a', 'b']);
    expect(movePhoto(['a', 'b', 'c'], 'a', 'earlier')).toEqual(['a', 'b', 'c']);
  });

  it('an item up or down within its category, sending every item', () => {
    const items = [item('a', 'Drinks'), item('b', 'Drinks'), item('c', 'Food'), item('d', 'Food')];
    expect(moveMenuItem(items, 'b', 'up')).toEqual(['b', 'a', 'c', 'd']);
    expect(moveMenuItem(items, 'c', 'down')).toEqual(['a', 'b', 'd', 'c']);
    // Never across a category.
    expect(moveMenuItem(items, 'b', 'down')).toBeNull();
    expect(moveMenuItem(items, 'c', 'up')).toBeNull();
  });
});
