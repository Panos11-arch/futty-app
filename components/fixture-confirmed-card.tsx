import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';

function TeamBadge({ name }: { name: string }) {
  return (
    <View style={styles.badgeCol}>
      <Avatar name={name} size={space.xxl * 2} />
      <Text variant="headline" numberOfLines={2} style={styles.center}>
        {name}
      </Text>
    </View>
  );
}

/** "Team A vs Team B" (a matched "need opposition" post, or an 'agreed'
 *  league fixture) or a plain booking's venue/format — same screen either
 *  way ("Match found" / Fixture Confirmed). */
export function FixtureConfirmedCard({
  teamAName,
  teamBName,
  bookingFormat,
  venueName,
  whenLabel,
  paymentModeLabel,
}: {
  /** Both set → team-vs-team fixture. Neither set → plain booking, shows
   *  bookingFormat instead. */
  teamAName?: string | null;
  teamBName?: string | null;
  bookingFormat?: string | null;
  venueName?: string | null;
  whenLabel?: string | null;
  /** "Gipedo Pano: loser pays the full pitch" — squad-matched opposition
   *  posts only (see supabase/gipedo-pano-payments.sql); null/undefined for
   *  a normal split-payment match, which gets no extra callout here. */
  paymentModeLabel?: string | null;
}) {
  const isFixture = !!teamAName && !!teamBName;

  return (
    <View style={styles.wrap}>
      {isFixture ? (
        <View style={styles.matchupRow}>
          <TeamBadge name={teamAName!} />
          <Text variant="callout" tone="inkMuted">
            vs
          </Text>
          <TeamBadge name={teamBName!} />
        </View>
      ) : (
        <View style={styles.bookingBlock}>
          <Text variant="title" style={styles.center}>
            Pitch booked
          </Text>
          {bookingFormat ? (
            <Text variant="callout" tone="inkMuted">
              {bookingFormat}
            </Text>
          ) : null}
        </View>
      )}

      {paymentModeLabel ? (
        <View style={styles.paymentModePill}>
          <Text variant="caption">{paymentModeLabel}</Text>
        </View>
      ) : null}

      {venueName || whenLabel ? (
        <View style={styles.details}>
          {venueName ? (
            <View style={styles.detailRow}>
              <IconSymbol name="mappin.and.ellipse" size={ICON.small} color={colors.inkMuted} />
              <Text variant="callout" style={styles.flex}>
                {venueName}
              </Text>
            </View>
          ) : null}
          {whenLabel ? (
            <View style={styles.detailRow}>
              <IconSymbol name="calendar" size={ICON.small} color={colors.inkMuted} />
              <Text variant="callout" tabular style={styles.flex}>
                {whenLabel}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.xl, alignSelf: 'stretch' },
  matchupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  badgeCol: { alignItems: 'center', gap: space.sm, flex: 1 },
  center: { textAlign: 'center' },
  bookingBlock: { alignItems: 'center', gap: space.xs },
  paymentModePill: {
    backgroundColor: colors.canvas,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  details: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
