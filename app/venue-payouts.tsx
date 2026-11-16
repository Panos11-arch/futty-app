// The venue dashboard's Payouts screen (P4d; spec 05 section 12 item 10).
// Wires venue_payouts_overview, venue_payout_bookings and connect-onboarding
// to PayoutsView. Opened from the dashboard with the venue's id, and by
// connect-return when Stripe's onboarding sends the owner back
// (futtyapp://venue-payouts?venueId=...): the screen then loads the
// account's state from the server, which learnt it from Stripe's webhook.
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/ui';
import { PayoutsView } from '@/components/venue/payouts-view';
import { useAuth } from '@/lib/auth';
import { useLoad } from '@/lib/booking-search';
import {
  describePayoutError,
  fetchPayoutDetail,
  fetchPayoutsOverview,
  openStripe,
  type PayoutDetail,
  type PayoutsOverview,
  type StripeAction,
} from '@/lib/payouts';
import { supabase } from '@/lib/supabase';

type OwnedVenue = { id: string; name: string };

export default function VenuePayoutsScreen() {
  const { user } = useAuth();
  const { venueId: venueParam } = useLocalSearchParams<{ venueId?: string }>();
  const [venue, setVenue] = useState<OwnedVenue | null | undefined>(undefined);

  // The venue asked for, if the caller owns it; else their first venue.
  useEffect(() => {
    if (!user) return;
    supabase
      .from('venues')
      .select('id, name')
      .eq('owner_profile_id', user.id)
      .then(({ data }) => {
        const owned = (data ?? []) as OwnedVenue[];
        setVenue(owned.find((v) => v.id === venueParam) ?? owned[0] ?? null);
      });
  }, [user, venueParam]);

  const load = useCallback(async () => {
    const { data, error } = await fetchPayoutsOverview(venue!.id);
    if (error || !data) throw new Error(describePayoutError(error?.message ?? ''));
    return data as PayoutsOverview;
  }, [venue]);
  const { state, reload } = useLoad(venue ? venue.id : null, load);

  async function stripe(action: StripeAction): Promise<string | null> {
    if (!venue) return null;
    const message = await openStripe(venue.id, action);
    // Back from Stripe: what changed is the server's to say.
    if (!message) reload();
    return message;
  }

  async function openPayout(payoutId: string): Promise<{ detail: PayoutDetail } | { error: string }> {
    if (!venue) return { error: describePayoutError('venue_not_found') };
    const { data, error } = await fetchPayoutDetail(venue.id, payoutId);
    if (error || !data) return { error: describePayoutError(error?.message ?? '') };
    return { detail: data as PayoutDetail };
  }

  if (venue === null) {
    return (
      <>
        <Stack.Screen options={{ title: 'Payouts' }} />
        <EmptyState icon="building.columns.fill" message="No venues are linked to your account yet. Ask Futty to link your venue." />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Payouts' }} />
      <PayoutsView
        state={venue ? state : { status: 'loading' }}
        venueName={venue?.name ?? ''}
        onRetry={reload}
        onStripe={stripe}
        onOpenPayout={openPayout}
      />
    </>
  );
}
