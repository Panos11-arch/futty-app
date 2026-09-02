import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { cancelBooking } from '@/lib/booking-actions';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { dateKeyAndTimeToDate, dateKeyToDate, dayLabel } from '@/lib/days';
import { describeFunctionError } from '@/lib/edge-functions';
import { useAuth } from '@/lib/auth';
import { describeSquadError } from '@/lib/squad-errors';
import {
  cancelSquadPost,
  createSquadPost,
  listMyOpenPostsForBooking,
  POSITIONS_NEEDED,
  SKILL_LEVELS,
  type PositionNeeded,
  type SkillLevel,
} from '@/lib/squads';
import { useMyBookings, type MyBooking } from '@/lib/use-my-bookings';
import { useMyTeams } from '@/lib/use-my-teams';
import { useVenues, type Venue } from '@/lib/use-venues';
import { XP_TIERS, type XpTier } from '@/lib/xp-tier';

/** "Need players" / "Need opposition" post a Squad listing tied to this
 *  booking, and can be cancelled again from the same button while this
 *  screen is still mounted. "Whole pitch" is the third, opposite case — you
 *  already have a full lineup (e.g. 10 players for a 5-a-side) and don't
 *  need to advertise for anything, so it's just a local acknowledgement, not
 *  a squad post. */
export function PostSquadNeed({
  booking,
  initialMode = null,
}: {
  booking: MyBooking;
  /** Skips straight past the "Need players / Need opposition / Whole pitch"
   *  choice — used right after the booking wizard (item 3) already
   *  collected that preference, so it isn't asked twice. */
  initialMode?: 'players' | 'opposition' | null;
}) {
  const { user } = useAuth();
  const myTeams = useMyTeams();
  const [mode, setMode] = useState<'players' | 'opposition' | null>(initialMode);
  const [targetCount, setTargetCount] = useState('4');
  const [level, setLevel] = useState<SkillLevel | null>(null);
  const [positionNeeded, setPositionNeeded] = useState<PositionNeeded | null>(null);
  const [levelNeeded, setLevelNeeded] = useState<XpTier | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The post's own id, not just "did we post" — cancelling needs it. Seeded
  // from the database on mount (rather than starting empty every time) so
  // an already-posted "need players/opposition" still shows as posted after
  // navigating away and back, instead of looking like the form forgot it.
  const [postedIds, setPostedIds] = useState<Partial<Record<'players' | 'opposition', string>>>({});
  const [cancellingType, setCancellingType] = useState<'players' | 'opposition' | null>(null);
  const [wholePitch, setWholePitch] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;

    listMyOpenPostsForBooking(booking.id, user.id).then(({ data }) => {
      if (!active || !data) return;
      setPostedIds((prev) => {
        const next = { ...prev };
        for (const row of data) next[row.type as 'players' | 'opposition'] = row.id;
        return next;
      });
    });

    return () => {
      active = false;
    };
  }, [booking.id, user]);

  const captainTeams =
    myTeams.status === 'ready' ? myTeams.teams.filter((t) => t.role === 'captain') : [];

  async function submit(postType: 'players' | 'opposition') {
    setBusy(true);
    setError(null);

    const { data, error: postError } = await createSquadPost({
      venueId: booking.venue_id,
      // .toISOString() carries an explicit UTC offset, unlike a bare
      // "2026-08-01T18:00:00" string — Postgres would otherwise read that in
      // the database's timezone rather than the booking's actual Cyprus
      // local time, throwing off the "2 hours after the match" score-logging
      // gate in submit_friendly_score by however many hours it's off by.
      scheduledAt: dateKeyAndTimeToDate(booking.booking_day, booking.start_time).toISOString(),
      format: booking.format,
      postType,
      venueBookingId: booking.id,
      level: level ?? undefined,
      ...(postType === 'players'
        ? {
            playersNeeded: Number(targetCount) || 1,
            positionNeeded: positionNeeded ?? undefined,
            levelNeeded: levelNeeded ?? undefined,
          }
        : { teamId: teamId ?? undefined, levelNeeded: levelNeeded ?? undefined }),
    });

    setBusy(false);

    if (postError) {
      setError(describeSquadError(postError));
    } else {
      setPostedIds((prev) => ({ ...prev, [postType]: data.id }));
      setMode(null);
    }
  }

  async function cancelPost(postType: 'players' | 'opposition') {
    const postId = postedIds[postType];
    if (!postId) return;

    setCancellingType(postType);
    setError(null);

    const { error: cancelError } = await cancelSquadPost(postId);

    setCancellingType(null);

    if (cancelError) {
      setError(describeSquadError(cancelError));
    } else {
      setPostedIds((prev) => ({ ...prev, [postType]: undefined }));
    }
  }

  if (mode === 'players') {
    return (
      <View style={styles.squadForm}>
        <IconLabel icon="person.2.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
          How many more players do you need?
        </IconLabel>
        <AuthField
          value={targetCount}
          onChangeText={(text) => setTargetCount(text.replace(/\D/g, ''))}
          keyboardType="number-pad"
          editable={!busy}
        />
        <IconLabel icon="star.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
          Skill level (optional)
        </IconLabel>
        <View style={styles.wrapRow}>
          {SKILL_LEVELS.map((lvl) => (
            <Chip
              key={lvl}
              label={lvl}
              selected={level === lvl}
              onPress={() => setLevel(level === lvl ? null : lvl)}
            />
          ))}
        </View>
        <IconLabel icon="sportscourt.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
          Position needed (optional)
        </IconLabel>
        <View style={styles.wrapRow}>
          <Chip label="Any" selected={positionNeeded === null} onPress={() => setPositionNeeded(null)} />
          {POSITIONS_NEEDED.map((position) => (
            <Chip
              key={position}
              label={position}
              selected={positionNeeded === position}
              onPress={() => setPositionNeeded(position)}
            />
          ))}
        </View>
        <IconLabel icon="trophy.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
          Level needed (optional)
        </IconLabel>
        <View style={styles.wrapRow}>
          <Chip label="Any" selected={levelNeeded === null} onPress={() => setLevelNeeded(null)} />
          {XP_TIERS.map((tier) => (
            <Chip
              key={tier}
              label={tier}
              selected={levelNeeded === tier}
              onPress={() => setLevelNeeded(tier)}
            />
          ))}
        </View>
        {error ? <AuthError>{error}</AuthError> : null}
        <View style={styles.confirmRow}>
          <View style={styles.confirmButton}>
            <AuthButton
              label="Post"
              onPress={() => submit('players')}
              disabled={!Number(targetCount)}
              busy={busy}
            />
          </View>
          <View style={styles.confirmButton}>
            <AuthButton label="Cancel" variant="secondary" onPress={() => setMode(null)} disabled={busy} />
          </View>
        </View>
      </View>
    );
  }

  if (mode === 'opposition') {
    return (
      <View style={styles.squadForm}>
        {captainTeams.length === 0 ? (
          <ThemedText style={styles.note}>
            You need to be a team&apos;s captain to post for opposition — register one on the
            League tab.
          </ThemedText>
        ) : (
          <>
            <IconLabel icon="shield.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
              Which of your teams is playing?
            </IconLabel>
            <View style={styles.wrapRow}>
              {captainTeams.map(({ team }) => (
                <Chip
                  key={team.id}
                  label={team.name}
                  selected={teamId === team.id}
                  onPress={() => setTeamId(team.id)}
                />
              ))}
            </View>
            <IconLabel icon="star.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
          Skill level (optional)
        </IconLabel>
            <View style={styles.wrapRow}>
              {SKILL_LEVELS.map((lvl) => (
                <Chip
                  key={lvl}
                  label={lvl}
                  selected={level === lvl}
                  onPress={() => setLevel(level === lvl ? null : lvl)}
                />
              ))}
            </View>
            <IconLabel icon="trophy.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
              Preferred opponent level (optional)
            </IconLabel>
            <View style={styles.wrapRow}>
              <Chip label="Any" selected={levelNeeded === null} onPress={() => setLevelNeeded(null)} />
              {XP_TIERS.map((tier) => (
                <Chip
                  key={tier}
                  label={tier}
                  selected={levelNeeded === tier}
                  onPress={() => setLevelNeeded(tier)}
                />
              ))}
            </View>
          </>
        )}
        {error ? <AuthError>{error}</AuthError> : null}
        <View style={styles.confirmRow}>
          {captainTeams.length > 0 ? (
            <View style={styles.confirmButton}>
              <AuthButton
                label="Post"
                onPress={() => submit('opposition')}
                disabled={!teamId}
                busy={busy}
              />
            </View>
          ) : null}
          <View style={styles.confirmButton}>
            <AuthButton label="Cancel" variant="secondary" onPress={() => setMode(null)} disabled={busy} />
          </View>
        </View>
      </View>
    );
  }

  const needsDisabled = wholePitch;
  const anyPosted = postedIds.players !== undefined || postedIds.opposition !== undefined;
  // Only locked out by an actual post going out — tapping "Whole pitch"
  // itself must stay reversible, or picking it by mistake permanently
  // disables the other two options with no way back.
  const wholePitchDisabled = anyPosted;

  return (
    <View style={styles.wrapRow}>
      {postedIds.players ? (
        <AuthButton
          label="Cancel players post"
          variant="secondary"
          onPress={() => cancelPost('players')}
          busy={cancellingType === 'players'}
          disabled={cancellingType !== null}
        />
      ) : (
        <AuthButton
          label="Need players"
          variant="secondary"
          onPress={() => setMode('players')}
          disabled={needsDisabled}
        />
      )}
      {postedIds.opposition ? (
        <AuthButton
          label="Cancel opposition post"
          variant="secondary"
          onPress={() => cancelPost('opposition')}
          busy={cancellingType === 'opposition'}
          disabled={cancellingType !== null}
        />
      ) : (
        <AuthButton
          label="Need opposition"
          variant="secondary"
          onPress={() => setMode('opposition')}
          disabled={needsDisabled}
        />
      )}
      <AuthButton
        label="Whole pitch"
        icon={wholePitch ? 'checkmark' : undefined}
        variant="secondary"
        onPress={() => setWholePitch((prev) => !prev)}
        disabled={wholePitchDisabled}
      />
    </View>
  );
}

function MyBookingsList({ venues }: { venues: Venue[] }) {
  const myBookings = useMyBookings();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  async function cancel(bookingId: string) {
    setCancellingId(bookingId);
    setError(null);

    const { error: cancelError } = await cancelBooking(bookingId);

    setCancellingId(null);

    if (cancelError) {
      setError(describeBookingErrorMessage(await describeFunctionError(cancelError)));
    } else {
      myBookings.reload();
    }
  }

  return (
    <>
      {myBookings.status === 'loading' ? <ActivityIndicator /> : null}
      {myBookings.status === 'error' ? (
        <ThemedText style={styles.note}>Could not load your bookings: {myBookings.message}</ThemedText>
      ) : null}
      {myBookings.status === 'ready' && myBookings.bookings.length === 0 ? (
        <IconLabel icon="sportscourt.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={12}>
          No upcoming bookings — book a pitch to see it here.
        </IconLabel>
      ) : null}

      {error ? <AuthError>{error}</AuthError> : null}

      {myBookings.status === 'ready'
        ? myBookings.bookings.map((booking) => {
            const venue = venues.find((v) => v.id === booking.venue_id);
            return (
              <ThemedView key={booking.id} style={[styles.venueCard, { borderColor: border }]}>
                <ThemedText type="defaultSemiBold">{venue?.name ?? 'Unknown venue'}</ThemedText>
                <ThemedText style={styles.note}>
                  {venue?.city ? `${venue.city} · ` : ''}
                  {dayLabel(dateKeyToDate(booking.booking_day))} · {booking.start_time.slice(0, 5)}–
                  {booking.end_time.slice(0, 5)} · {booking.format}
                </ThemedText>
                <PostSquadNeed booking={booking} />
                <AuthButton
                  label="Cancel booking"
                  variant="secondary"
                  onPress={() => cancel(booking.id)}
                  busy={cancellingId === booking.id}
                  disabled={cancellingId !== null}
                />
              </ThemedView>
            );
          })
        : null}
    </>
  );
}

export default function MyBookingsScreen() {
  const venuesState = useVenues();
  const venues = venuesState.status === 'ready' ? venuesState.venues : [];

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MyBookingsList venues={venues} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 10,
    padding: 16,
    paddingBottom: 48,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  venueCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmButton: {
    flex: 1,
  },
  squadForm: {
    gap: 8,
  },
});
