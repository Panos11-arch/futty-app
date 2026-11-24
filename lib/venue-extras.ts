// A venue's food, drink and amenities for the places that show a little of
// them (S5A): the screen after paying ("At the venue") and Home's next game
// card. From venue_page, which already returns only the venue's active items
// and what it has entered; prices are its own, in integer cents, and the
// app only formats them. Nothing the venue hasn't entered is ever shown.
import { offerPrices } from '@/lib/post-match-offers';
import { supabase } from '@/lib/supabase';
import { amenitiesByPriority, VENUE_PHOTOS_BUCKET, type AmenityKind, type VenuePageData } from '@/lib/venue-page';

/** How many food and drink cards "At the venue" shows. */
export const AT_VENUE_FOOD = 3;
const PHOTO_URL_SECONDS = 60 * 60;

/** One food or drink card: the offer price with the normal one struck
 *  through when both exist and differ, and the After game tag. */
export type FoodCard = {
  id: string;
  name: string;
  photoUrl: string | null;
  price: string | null;
  was: string | null;
  afterGame: boolean;
};

export type VenueExtras = { amenities: AmenityKind[]; food: FoodCard[]; hasAfterGameOffers: boolean };

export function foodCard(item: VenuePageData['menu'][number], photoUrl: string | null): FoodCard {
  const prices = offerPrices(item);
  return {
    id: item.id,
    name: item.name,
    photoUrl,
    price: prices.now,
    was: prices.was,
    afterGame: item.is_post_match_offer,
  };
}

export async function fetchVenueExtras(venueId: string): Promise<VenueExtras> {
  const { data, error } = await supabase.rpc('venue_page', { p_venue_id: venueId });
  if (error || !data) throw new Error('Could not load this venue. Try again.');
  const page = data as Pick<VenuePageData, 'amenities' | 'offers' | 'menu'>;
  const items = (page.menu ?? []).slice(0, AT_VENUE_FOOD);
  const paths = items.flatMap((i) => (i.photo_path ? [i.photo_path] : []));
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    // A photo that can't be signed is left out; the card still shows.
    const { data: signed } = await supabase.storage.from(VENUE_PHOTOS_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return {
    amenities: amenitiesByPriority(page.amenities.map((a) => a.kind)),
    food: items.map((i) => foodCard(i, i.photo_path ? (urls[i.photo_path] ?? null) : null)),
    hasAfterGameOffers: page.offers.length > 0,
  };
}
