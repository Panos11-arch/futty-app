import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { FixtureConfirmedCard } from '@/components/fixture-confirmed-card';
import { PitchBackground } from '@/components/pitch-background';
import { PopupModal } from '@/components/popup-modal';
import { ThemedText } from '@/components/themed-text';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { formatFixtureWhen, getFixture } from '@/lib/fixtures';
import { supabase } from '@/lib/supabase';

type CardState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      teamAName: string | null;
      teamBName: string | null;
      bookingFormat: string | null;
      venueName: string | null;
      whenLabel: string | null;
    };

/** "Match Found" — shown for a matched "need opposition" squad post
 *  (kind=squad), an 'agreed' league fixture (kind=league), or a plain
 *  booking (kind=booking, no opponent). Reached from a notification tap
 *  (app/notifications.tsx), right after booking/joining completes, or a
 *  direct link elsewhere; all render through the same PopupModal shell as
 *  every other popup (items 1 & 2). */
export default function FixtureConfirmedScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const [state, setState] = useState<CardState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    async function load() {
      if (!id) {
        setState({ status: 'error', message: 'Missing booking.' });
        return;
      }

      if (kind === 'league') {
        const { data, error } = await getFixture(id);
        if (!active) return;
        if (error || !data) {
          setState({ status: 'error', message: error?.message ?? 'Fixture not found.' });
          return;
        }
        setState({
          status: 'ready',
          teamAName: data.home_team?.name ?? 'Home team',
          teamBName: data.away_team?.name ?? 'Away team',
          bookingFormat: null,
          venueName: data.venue ? `${data.venue.name} · ${data.venue.city}` : null,
          whenLabel: formatFixtureWhen(data),
        });
        return;
      }

      if (kind === 'booking') {
        const { data: booking, error: bookingError } = await supabase
          .from('venue_bookings')
          .select('venue_id, booking_day, start_time, format')
          .eq('id', id)
          .maybeSingle();

        if (!active) return;

        if (bookingError || !booking) {
          setState({ status: 'error', message: bookingError?.message ?? 'Booking not found.' });
          return;
        }

        const { data: venue } = await supabase
          .from('venues')
          .select('name, city')
          .eq('id', booking.venue_id)
          .maybeSingle();

        if (!active) return;

        const when = new Date(`${booking.booking_day}T${booking.start_time}`);

        setState({
          status: 'ready',
          teamAName: null,
          teamBName: null,
          bookingFormat: booking.format,
          venueName: venue ? `${venue.name} · ${venue.city}` : null,
          whenLabel: `${when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
        });
        return;
      }

      // kind === 'squad' — a "need opposition" post that's been matched.
      const { data: post, error: postError } = await supabase
        .from('squad_posts')
        .select('team_id, matched_team_id, venue_id, scheduled_at, format')
        .eq('id', id)
        .maybeSingle();

      if (!active) return;

      if (postError || !post || !post.team_id || !post.matched_team_id) {
        setState({ status: 'error', message: postError?.message ?? 'Fixture not found.' });
        return;
      }

      const [{ data: teams }, { data: venue }] = await Promise.all([
        supabase.from('teams').select('id, name').in('id', [post.team_id, post.matched_team_id]),
        post.venue_id
          ? supabase.from('venues').select('name, city').eq('id', post.venue_id).maybeSingle()
          : Promise.resolve({ data: null as { name: string; city: string } | null }),
      ]);

      if (!active) return;

      const teamName = (teamId: string) => teams?.find((t) => t.id === teamId)?.name ?? 'Team';
      const when = new Date(post.scheduled_at);

      setState({
        status: 'ready',
        teamAName: teamName(post.team_id),
        teamBName: teamName(post.matched_team_id),
        bookingFormat: null,
        venueName: venue ? `${venue.name} · ${venue.city}` : null,
        whenLabel: `${when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
      });
    }

    load();
    return () => {
      active = false;
    };
  }, [kind, id]);

  return (
    <PopupModal
      visible
      onClose={() => router.back()}
      title="Match Found"
      backgroundImage={<PitchBackground />}
      dark
      footer={
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/my-bookings')}
          style={styles.viewBookingButton}>
          <ThemedText style={styles.viewBookingButtonText}>View booking</ThemedText>
        </Pressable>
      }>
      <View style={styles.center}>
        {state.status === 'loading' ? <ActivityIndicator color="#fff" /> : null}
        {state.status === 'error' ? <ThemedText style={styles.errorText}>{state.message}</ThemedText> : null}
        {state.status === 'ready' ? (
          <FixtureConfirmedCard
            teamAName={state.teamAName}
            teamBName={state.teamBName}
            bookingFormat={state.bookingFormat}
            venueName={state.venueName}
            whenLabel={state.whenLabel}
          />
        ) : null}
      </View>
    </PopupModal>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: {
    color: FuttyColors.white,
  },
  viewBookingButton: {
    height: 50,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FuttyColors.amber400,
  },
  viewBookingButtonText: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 16,
    color: FuttyColors.stone900,
  },
});
