import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';

function TeamBadge({ name }: { name: string }) {
  const initial = name[0]?.toUpperCase() ?? '?';
  return (
    <View style={styles.badgeCol}>
      <View style={styles.badge}>
        <ThemedText style={styles.badgeText}>{initial}</ThemedText>
      </View>
      <ThemedText style={styles.teamName} numberOfLines={2}>
        {name}
      </ThemedText>
    </View>
  );
}

/** "Team A vs Team B" (a matched "need opposition" post, or an 'agreed'
 *  league fixture) or a plain booking's venue/format — same celebratory
 *  screen either way ("Match Found" / Fixture Confirmed). */
export function FixtureConfirmedCard({
  teamAName,
  teamBName,
  bookingFormat,
  venueName,
  whenLabel,
}: {
  /** Both set → team-vs-team fixture. Neither set → plain booking, shows
   *  bookingFormat instead. */
  teamAName?: string | null;
  teamBName?: string | null;
  bookingFormat?: string | null;
  venueName?: string | null;
  whenLabel?: string | null;
}) {
  const isFixture = !!teamAName && !!teamBName;

  return (
    <View style={styles.wrap}>
      <ThemedText style={styles.ball}>⚽</ThemedText>

      {isFixture ? (
        <View style={styles.matchupRow}>
          <TeamBadge name={teamAName!} />
          <View style={styles.vsBadge}>
            <ThemedText style={styles.vsText}>VS</ThemedText>
          </View>
          <TeamBadge name={teamBName!} />
        </View>
      ) : (
        <View style={styles.bookingBlock}>
          <ThemedText style={styles.bookingTitle}>Pitch booked!</ThemedText>
          {bookingFormat ? <ThemedText style={styles.bookingFormat}>{bookingFormat}</ThemedText> : null}
        </View>
      )}

      {venueName || whenLabel ? (
        <View style={styles.pill}>
          {venueName ? (
            <View style={styles.pillRow}>
              <IconSymbol name="mappin.and.ellipse" size={13} color={FuttyColors.stone700} />
              <ThemedText style={styles.pillText}>{venueName}</ThemedText>
            </View>
          ) : null}
          {venueName && whenLabel ? <View style={styles.pillDivider} /> : null}
          {whenLabel ? (
            <View style={styles.pillRow}>
              <IconSymbol name="calendar" size={13} color={FuttyColors.stone700} />
              <ThemedText style={styles.pillText}>{whenLabel}</ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 18,
  },
  ball: {
    fontSize: 40,
  },
  matchupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  badgeCol: {
    alignItems: 'center',
    gap: 8,
    width: 110,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: FuttyColors.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: FuttyColors.amber400,
  },
  badgeText: {
    fontFamily: FuttyFonts.display,
    fontSize: 26,
    color: FuttyColors.emerald950,
  },
  teamName: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 14,
    color: FuttyColors.white,
    textAlign: 'center',
  },
  vsBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: FuttyColors.amber400,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vsText: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 13,
    color: FuttyColors.emerald950,
  },
  bookingBlock: {
    alignItems: 'center',
    gap: 4,
  },
  bookingTitle: {
    fontFamily: FuttyFonts.display,
    fontSize: 24,
    color: FuttyColors.white,
  },
  bookingFormat: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 14,
    color: FuttyColors.amber400,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillDivider: {
    width: 1,
    height: 14,
    backgroundColor: FuttyColors.stone200,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: FuttyColors.stone900,
  },
});
