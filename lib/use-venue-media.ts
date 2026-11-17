// Loads venue_media for the P6e photos, amenities and menu screens, with
// signed URLs for the photos (the bucket is private; staff can read their
// own venue's files), and runs their writes: after the server accepts a
// change the screen reloads quietly; a refusal comes back in words.
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { describeMediaError, fetchVenueMedia, type VenueMedia } from '@/lib/venue-media';
import { VENUE_PHOTOS_BUCKET } from '@/lib/venue-page';

export type LoadedMedia = VenueMedia & {
  /** Signed URL by storage path; a photo that can't be signed is left out. */
  photoUrls: Record<string, string>;
};

export type MediaState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; setup: LoadedMedia };

/** How long a photo's signed URL lasts. The screen reloads long before. */
const PHOTO_URL_SECONDS = 60 * 60;

type Result = PromiseLike<{ error: { message: string } | null }>;

export function useVenueMedia(venueId: string) {
  const [state, setState] = useState<MediaState>({ status: 'loading' });
  const request = useRef(0);

  const reload = useCallback(async () => {
    const id = ++request.current;
    const { data, error } = await fetchVenueMedia(venueId);
    if (id !== request.current) return;
    if (error || !data) {
      setState({ status: 'error', message: describeMediaError(error?.message ?? '') });
      return;
    }
    const media = data as VenueMedia;
    const paths = [
      ...media.photos.map((p) => p.storage_path),
      ...media.items.flatMap((i) => (i.photo_path ? [i.photo_path] : [])),
    ];
    const photoUrls: Record<string, string> = {};
    if (paths.length > 0) {
      const { data: signed } = await supabase.storage.from(VENUE_PHOTOS_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS);
      if (id !== request.current) return;
      for (const s of signed ?? []) if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl;
    }
    setState({ status: 'ready', setup: { ...media, photoUrls } });
  }, [venueId]);

  useEffect(() => {
    setState({ status: 'loading' });
    reload();
    return () => {
      request.current += 1;
    };
  }, [reload]);

  /** Null when the server accepted it (and the screen reloads), or its refusal in words. */
  const write = useCallback(
    async (result: Result): Promise<string | null> => {
      const { error } = await result;
      if (error) return describeMediaError(error.message);
      reload();
      return null;
    },
    [reload],
  );

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    reload();
  }, [reload]);

  return { state, write, retry };
}
