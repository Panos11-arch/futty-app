// venue_media replies for the P6e photos, amenities and menu screens' tests,
// shaped as supabase/migrations/20261117191238_pay_venue_media.sql returns them.
import type { MenuItem, VenueMedia, VenuePhoto } from '@/lib/venue-media';

export const MEDIA_VENUE = '11111111-1111-4111-8111-111111111111';

export function mediaPhoto(n: number): VenuePhoto {
  const id = `bbbbbbbb-0000-4000-8000-00000000000${n}`;
  return { id, storage_path: `${MEDIA_VENUE}/photos/${id}.jpg`, is_cover: n === 1 };
}

export function menuItem(id: string, overrides: Partial<MenuItem> = {}): MenuItem {
  return {
    id,
    name: `Item ${id}`,
    category: null,
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
    ...overrides,
  };
}

export const MENU: MenuItem[] = [
  menuItem('i1', { name: 'Frappé', category: 'Drinks', price_cents: 350, sort_order: 1 }),
  menuItem('i2', {
    name: 'Keo beer',
    category: 'Drinks',
    price_cents: 400,
    offer_price_cents: 300,
    is_post_match_offer: true,
    offer_text: 'After your game',
    available_from: '17:00',
    available_to: '23:00',
    available_weekdays: [1, 2, 3, 4, 5],
    sort_order: 2,
  }),
  menuItem('i3', {
    name: 'Halloumi wrap',
    category: 'Food',
    description: 'With tomato and mint',
    price_cents: 650,
    dietary_tags: ['vegetarian'],
    photo_path: `${MEDIA_VENUE}/items/cccccccc-0000-4000-8000-000000000001.jpg`,
    sort_order: 3,
  }),
  menuItem('i4', { name: 'Ice cream', price_cents: 250, active: false, sort_order: 4 }),
];

export function venueMedia(overrides: Partial<VenueMedia> = {}): VenueMedia {
  return {
    max_photos: 10,
    photo_permission: { by: 'u1', at: '2026-11-17T10:00:00Z' },
    photos: [mediaPhoto(1), mediaPhoto(2), mediaPhoto(3)],
    amenities: [
      { kind: 'parking', note: '20 spaces' },
      { kind: 'showers', note: null },
    ],
    items: MENU,
    ...overrides,
  };
}
