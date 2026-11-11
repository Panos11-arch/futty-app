import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { VENUE_PHOTOS_BUCKET, type VenuePageData } from '@/lib/venue-page';

export type VenuePageState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: VenuePageData; photoUrls: Record<string, string> };

/** How long a photo's signed URL lasts. The page reloads long before. */
const PHOTO_URL_SECONDS = 60 * 60;

/** The venue page from the server (venue_page), with signed URLs for its
 *  photos. A venue that isn't live is not_found for everyone but its owner. */
export function useVenuePage(venueId: string | undefined) {
  const [state, setState] = useState<VenuePageState>({ status: 'loading' });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    if (!venueId) {
      setState({ status: 'not_found' });
      return;
    }
    setState({ status: 'loading' });

    const { data, error } = await supabase.rpc('venue_page', { p_venue_id: venueId });
    if (requestRef.current !== request) return;
    if (error) {
      setState(error.message.includes('venue_not_found') ? { status: 'not_found' } : { status: 'error', message: error.message });
      return;
    }
    const page = data as VenuePageData;

    const paths = [
      ...page.photos.map((p) => p.storage_path),
      ...page.offers.flatMap((o) => (o.photo_path ? [o.photo_path] : [])),
    ];
    const photoUrls: Record<string, string> = {};
    if (paths.length > 0) {
      // A photo that can't be signed is left out; the page still shows.
      const { data: signed } = await supabase.storage.from(VENUE_PHOTOS_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS);
      if (requestRef.current !== request) return;
      for (const s of signed ?? []) if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl;
    }
    setState({ status: 'ready', data: page, photoUrls });
  }, [venueId]);

  useEffect(() => {
    reload();
    return () => {
      requestRef.current += 1;
    };
  }, [reload]);

  return { state, reload };
}
