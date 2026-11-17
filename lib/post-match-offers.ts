// Post-match food and drink offers (A8; spec 05 "Food and drink after the
// game", spec 13 "Post-match offers"). The server decides which offers show,
// makes the codes and checks redemptions; prices are the venue's own, in
// integer cents, and the app only formats them.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ResultMatch } from '@/lib/match/result';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';
import { VENUE_PHOTOS_BUCKET } from '@/lib/venue-page';

export type PostMatchOffer = {
  id: string;
  name: string;
  description: string | null;
  offer_text: string | null;
  price_cents: number | null;
  offer_price_cents: number | null;
  photo_path: string | null;
};

export type OfferCode = {
  code: string;
  expires_at: string;
  redeemed_at: string | null;
  offer: PostMatchOffer;
};

/** The offer price, with the normal price struck through when both exist and differ. */
export function offerPrices(offer: Pick<PostMatchOffer, 'price_cents' | 'offer_price_cents'>) {
  const { price_cents: price, offer_price_cents: offerPrice } = offer;
  if (offerPrice !== null) {
    return { now: formatEuros(offerPrice), was: price !== null && price !== offerPrice ? formatEuros(price) : null };
  }
  return { now: price !== null ? formatEuros(price) : null, was: null };
}

/**
 * Whether a score is in, as public.post_match_offers_open decides it: the
 * match has a venue, isn't void, and has a submission (even a rejected one;
 * decided 17 November) or is confirmed. The match screen only asks for
 * offers then; the server still decides which, and for whom.
 */
export function scoreEntered({ match, submission }: Pick<ResultMatch, 'match' | 'submission'>) {
  return match.venue_id !== null && match.status !== 'void' && (submission !== null || match.status === 'confirmed');
}

export function fetchPostMatchOffers(matchId: string) {
  return supabase.rpc('post_match_offers', { p_match_id: matchId });
}

/** Home, after a submit or accept: open the match screen only when it has offers to show. */
export async function openIfOffers(matchId: string, open: (matchId: string) => void) {
  const { data, error } = await fetchPostMatchOffers(matchId);
  if (!error && Array.isArray(data) && data.length > 0) open(matchId);
}

/** The caller's code for this offer (made the first time); also records a view. */
export function openPostMatchOffer(matchId: string, itemId: string) {
  return supabase.rpc('open_post_match_offer', { p_match_id: matchId, p_item_id: itemId });
}

/** Staff: what a code is for, before redeeming it. */
export function checkOfferCode(venueId: string, code: string) {
  return supabase.rpc('check_offer_code', { p_venue_id: venueId, p_code: code });
}

export function redeemOfferCode(venueId: string, code: string) {
  return supabase.rpc('redeem_offer_code', { p_venue_id: venueId, p_code: code });
}

const ERRORS: Record<string, string> = {
  code_not_found: 'No offer with that code at this venue.',
  code_already_redeemed: 'This code has already been used.',
  code_expired: 'This code has expired. Codes last until midnight on the day of the match.',
  own_code: "You can't redeem your own code.",
  not_venue_staff: 'Only staff of this venue can redeem its codes.',
  offer_not_available: 'This offer is no longer available.',
  not_in_match: 'Only players in this match can see its offers.',
};

export function describeOfferError(error: { message: string }): string {
  return ERRORS[error.message] ?? 'Something went wrong. Try again.';
}

const PHOTO_URL_SECONDS = 60 * 60;

export type PostMatchOffersState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; offers: PostMatchOffer[]; photoUrls: Record<string, string> };

/** The offers the signed-in player sees for this match, with signed photo URLs. */
export function usePostMatchOffers(matchId: string) {
  const [state, setState] = useState<PostMatchOffersState>({ status: 'loading' });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    const { data, error } = await fetchPostMatchOffers(matchId);
    if (requestRef.current !== request) return;
    if (error) {
      setState({ status: 'error', message: describeOfferError(error) });
      return;
    }
    const offers = (data ?? []) as PostMatchOffer[];
    const paths = offers.flatMap((o) => (o.photo_path ? [o.photo_path] : []));
    const photoUrls: Record<string, string> = {};
    if (paths.length > 0) {
      // A photo that can't be signed is left out; the offer still shows.
      const { data: signed } = await supabase.storage.from(VENUE_PHOTOS_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS);
      if (requestRef.current !== request) return;
      for (const s of signed ?? []) if (s.path && s.signedUrl) photoUrls[s.path] = s.signedUrl;
    }
    setState({ status: 'ready', offers, photoUrls });
  }, [matchId]);

  useEffect(() => {
    reload();
    return () => {
      requestRef.current += 1;
    };
  }, [reload]);

  return { state, reload };
}
