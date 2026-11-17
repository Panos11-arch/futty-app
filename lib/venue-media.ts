// The venue dashboard's photos, amenities and menu (P6e; docs/specs/13-payments-bookings.md
// "Venue photos, amenities and menu"; spec 05 section 12). Everything goes
// through the staff-checked server functions of
// supabase/migrations/20261117191238_pay_venue_media.sql; the tables are
// read-only to the app. The app only picks and shrinks a photo, uploads it
// to <venue id>/(photos|items)/<uuid>.jpg (the storage policy refuses any
// other name, and refuses it before photo permission is confirmed), then
// registers it; if the server refuses, the new file is removed again. When
// the server lets go of a file (a removed photo, a replaced or deleted
// item's photo) it returns the path and the app deletes it. Prices are what
// staff typed, already whole cents (parseEurosInput); the server decides
// whether they are allowed.
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { launchImageLibraryAsync } from 'expo-image-picker';

import { supabase } from '@/lib/supabase';
import { AMENITIES, VENUE_PHOTOS_BUCKET, type AmenityKind } from '@/lib/venue-page';

export { groupMenu, type MenuGroup } from '@/lib/venue-page';
import { describeVenueError } from '@/lib/venue-today';

// ---- Types: as venue_media returns them ----------------------------------

export type VenuePhoto = { id: string; storage_path: string; is_cover: boolean };

export type Amenity = { kind: AmenityKind; note: string | null };

export type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  price_cents: number | null;
  offer_price_cents: number | null;
  is_post_match_offer: boolean;
  offer_text: string | null;
  /** "HH:MM", or null: all day. */
  available_from: string | null;
  available_to: string | null;
  /** ISO weekdays (1 = Monday), or null: every day. */
  available_weekdays: number[] | null;
  dietary_tags: string[] | null;
  photo_path: string | null;
  active: boolean;
  sort_order: number;
};

export type VenueMedia = {
  max_photos: number;
  /** Null until a staff member confirms the photos are the venue's own. */
  photo_permission: { by: string | null; at: string } | null;
  /** In order; the first is the cover. */
  photos: VenuePhoto[];
  amenities: Amenity[];
  /** Every item, switched off ones too: by category (none last), then the staff's order, then name. */
  items: MenuItem[];
};

// ---- Fixed lists ---------------------------------------------------------

/** The fixed list, in the order staff see it. */
export const AMENITY_KINDS: AmenityKind[] = [
  'parking',
  'changing_rooms',
  'showers',
  'lockers',
  'cafe_or_bar',
  'floodlights',
  'bibs',
  'ball_hire',
  'first_aid',
  'wifi',
  'other',
];

/** What staff call each amenity ("Other" is "More" on the venue page). */
export function amenityLabel(kind: AmenityKind): string {
  return kind === 'other' ? 'Other' : AMENITIES[kind].label;
}

export const AMENITY_NOTE_MAX = 60;

export const PHOTO_PERMISSION_TEXT = 'These are our photos and Futty may show them in the app.';

// ---- Photos: pick, shrink, upload ----------------------------------------

/** The long edge staff photos are saved at (spec 13). */
export const PHOTO_LONG_EDGE = 1600;
const JPEG_QUALITY = 0.8;

/** How to resize a photo so its long edge is 1600 px; null when it is
 *  already that small (a photo is never enlarged). */
export function resizeFor(width: number, height: number): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= PHOTO_LONG_EDGE) return null;
  return width >= height ? { width: PHOTO_LONG_EDGE } : { height: PHOTO_LONG_EDGE };
}

/** Opens the photo library (photos only, one at a time) and returns a local
 *  JPEG, 1600 px on the long edge at most; null when staff cancel. */
export async function pickAndCompressPhoto(): Promise<string | null> {
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];

  let { width, height } = asset;
  if (!width || !height) {
    // The library didn't say: read the size from the decoded photo.
    const decoded = await ImageManipulator.manipulate(asset.uri).renderAsync();
    ({ width, height } = decoded);
  }
  const context = ImageManipulator.manipulate(asset.uri);
  const size = resizeFor(width, height);
  if (size) context.resize(size);
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return saved.uri;
}

export type MediaFolder = 'photos' | 'items';

/** A new file's name: <venue id>/<photos|items>/<uuid>.jpg. */
export function photoPath(venueId: string, folder: MediaFolder): string {
  return `${venueId}/${folder}/${Crypto.randomUUID().toLowerCase()}.jpg`;
}

const STAFF_FILE = /^[0-9a-f-]{36}\/(photos|items)\/[0-9a-f-]{36}\.jpg$/;

type Outcome = { error: { message: string } | null };

async function upload(venueId: string, folder: MediaFolder, uri: string): Promise<{ path: string } | Outcome> {
  const path = photoPath(venueId, folder);
  try {
    const bytes = await new File(uri).arrayBuffer();
    const { error } = await supabase.storage
      .from(VENUE_PHOTOS_BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
    return error ? { error: { message: 'upload_failed' } } : { path };
  } catch {
    return { error: { message: 'upload_failed' } };
  }
}

/** Deletes a file the server no longer points to. Only the staff's own
 *  uploads; imported files aren't theirs to delete. A failure is left: the
 *  file can't be read by players any more. */
async function deleteFile(path: unknown) {
  if (typeof path === 'string' && STAFF_FILE.test(path)) {
    await supabase.storage.from(VENUE_PHOTOS_BUCKET).remove([path]);
  }
}

// ---- Server calls --------------------------------------------------------

export function fetchVenueMedia(venueId: string) {
  return supabase.rpc('venue_media', { p_venue_id: venueId });
}

export function confirmPhotoPermission(venueId: string) {
  return supabase.rpc('confirm_photo_permission', { p_venue_id: venueId });
}

/** Uploads a picked photo as the venue's last photo. */
export async function addVenuePhoto(venueId: string, uri: string): Promise<Outcome> {
  const uploaded = await upload(venueId, 'photos', uri);
  if (!('path' in uploaded)) return uploaded;
  const { error } = await supabase.rpc('add_venue_photo', { p_venue_id: venueId, p_path: uploaded.path });
  if (error) await deleteFile(uploaded.path);
  return { error };
}

export async function removeVenuePhoto(photoId: string): Promise<Outcome> {
  const { data, error } = await supabase.rpc('remove_venue_photo', { p_photo_id: photoId });
  if (!error) await deleteFile(data);
  return { error };
}

/** Every photo id, in the new order; the first is the cover. */
export function reorderVenuePhotos(venueId: string, photoIds: string[]) {
  return supabase.rpc('reorder_venue_photos', { p_venue_id: venueId, p_photo_ids: photoIds });
}

export function setVenueAmenities(venueId: string, amenities: { kind: AmenityKind; note: string }[]) {
  return supabase.rpc('set_venue_amenities', {
    p_venue_id: venueId,
    p_amenities: amenities.map((a) => ({ kind: a.kind, note: a.note.trim() || null })),
  });
}

export type MenuItemInput = {
  name: string;
  category: string;
  description: string;
  /** Null: not an amount (the server refuses it). */
  priceCents: number | null;
  isPostMatchOffer: boolean;
  offerPriceCents: number | null;
  offerText: string;
  availableFrom: string | null;
  availableTo: string | null;
  availableWeekdays: number[] | null;
  dietaryTags: string[];
  active: boolean;
};

/** Adds an item (itemId null) or edits one; every field is sent. */
export function saveMenuItem(venueId: string, itemId: string | null, input: MenuItemInput) {
  const offer = input.isPostMatchOffer;
  return supabase.rpc('save_menu_item', {
    p_venue_id: venueId,
    p_item_id: itemId,
    p_item: {
      name: input.name.trim(),
      category: input.category.trim() || null,
      description: input.description.trim() || null,
      price_cents: input.priceCents,
      is_post_match_offer: offer,
      offer_price_cents: offer ? input.offerPriceCents : null,
      offer_text: offer ? input.offerText.trim() || null : null,
      available_from: input.availableFrom,
      available_to: input.availableTo,
      available_weekdays: input.availableWeekdays,
      dietary_tags: input.dietaryTags,
      active: input.active,
    },
  });
}

/** Uploads a picked photo for an item and deletes the one it replaces. */
export async function setMenuItemPhoto(venueId: string, itemId: string, uri: string): Promise<Outcome> {
  const uploaded = await upload(venueId, 'items', uri);
  if (!('path' in uploaded)) return uploaded;
  const { data, error } = await supabase.rpc('set_menu_item_photo', { p_item_id: itemId, p_path: uploaded.path });
  await deleteFile(error ? uploaded.path : data);
  return { error };
}

export async function removeMenuItemPhoto(itemId: string): Promise<Outcome> {
  const { data, error } = await supabase.rpc('set_menu_item_photo', { p_item_id: itemId, p_path: null });
  if (!error) await deleteFile(data);
  return { error };
}

export function setMenuItemActive(itemId: string, active: boolean) {
  return supabase.rpc('set_menu_item_active', { p_item_id: itemId, p_active: active });
}

/** Deletes an item and its photo file. Its post-match codes stay (server). */
export async function deleteMenuItem(itemId: string): Promise<Outcome> {
  const { data, error } = await supabase.rpc('delete_menu_item', { p_item_id: itemId });
  if (!error) await deleteFile(data);
  return { error };
}

/** Every item id, in the new order. */
export function reorderMenuItems(venueId: string, itemIds: string[]) {
  return supabase.rpc('reorder_menu_items', { p_venue_id: venueId, p_item_ids: itemIds });
}

// ---- Order --------------------------------------------------

/** The photo ids after moving one earlier, later, or to the front (the cover). */
export function movePhoto(ids: string[], id: string, move: 'earlier' | 'later' | 'cover'): string[] {
  const from = ids.indexOf(id);
  const to = move === 'cover' ? 0 : move === 'earlier' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/** Every item id after moving one up or down within its category; null when
 *  it is already first or last there (items never move across a category). */
export function moveMenuItem(items: MenuItem[], id: string, move: 'up' | 'down'): string[] | null {
  const from = items.findIndex((i) => i.id === id);
  const to = move === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= items.length || items[to].category !== items[from].category) return null;
  const ids = items.map((i) => i.id);
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}

// ---- Words ---------------------------------------------------------------

export function describeMediaError(code: string): string {
  switch (code) {
    case 'photo_permission_required':
      return 'Confirm the photos are yours before adding one.';
    case 'invalid_photo_path':
    case 'photo_path_in_use':
    case 'photo_file_missing':
    case 'upload_failed':
      return 'The photo couldn’t be uploaded. Check your connection and try again.';
    case 'picker_failed':
      return 'That photo couldn’t be opened. Try another one.';
    case 'too_many_photos':
      return 'You already have as many photos as a venue can have. Remove one to add another.';
    case 'photo_not_found':
      return 'That photo is already gone.';
    case 'photo_list_mismatch':
    case 'item_list_mismatch':
      return 'Something changed meanwhile. Check the order and try again.';
    case 'invalid_amenities':
      return 'Each note can be up to 60 characters, and Other needs a note.';
    case 'item_not_found':
      return 'That item is already gone.';
    case 'invalid_name':
      return 'An item needs a name of up to 60 characters.';
    case 'invalid_category':
      return 'A category can be up to 40 characters.';
    case 'invalid_description':
      return 'A description can be up to 200 characters.';
    case 'invalid_price':
      return 'The price must be more than €0.';
    case 'invalid_offer_price':
      return 'The offer price must be more than €0 and less than the normal price.';
    case 'invalid_offer_text':
      return 'The offer text can be up to 120 characters.';
    case 'invalid_window':
      return 'Pick both times, with the end after the start, or neither.';
    case 'invalid_weekdays':
      return 'Pick the days again.';
    case 'invalid_dietary_tags':
      return 'Up to 6 dietary tags, each up to 20 characters.';
    case 'item_name_taken':
      return 'Another item already has that name.';
    case 'not_authenticated':
      return 'Sign in again to make changes.';
    default:
      return describeVenueError(code);
  }
}
