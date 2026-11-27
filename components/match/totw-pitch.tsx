// A Team of the Week on a pitch (images 13 and 15; match-record.md decision
// 1k): the format's shape with the keeper at the bottom, then defence,
// midfield and strikers at the top. Each player: avatar, name, rating badge
// (the top-rating colour for the Player of the week) and goals and assists.
// A slot with no eligible player says so. Names are exactly as the server
// gives them (a minor's first name only). Shared: Rankings uses it now; the
// S10 competition page uses it for the league Team of the Week and Team of
// the tournament on Overview.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import {
  formatRating,
  lineup,
  SLOT_LABELS,
  statLine,
  type LineupSlot,
  type TeamOfTheWeekPlayer,
  type TeamShape,
  type TeamSlot,
} from '@/lib/match/stats-api';
import { makeStyles } from '@/lib/theme';

export const NO_ELIGIBLE_PLAYER = 'No eligible player';

/** Top of the pitch to the bottom: strikers, midfield, defence, keeper. */
const ROWS: TeamSlot[] = ['fwd', 'mid', 'def', 'gk'];
const AVATAR = 48;

export type TotwPitchProps = {
  players: TeamOfTheWeekPlayer[];
  shape: TeamShape;
  /** Defaults to opening the player's profile. */
  onPressPlayer?: (player: TeamOfTheWeekPlayer) => void;
  testID?: string;
};

const openProfile = (p: TeamOfTheWeekPlayer) =>
  router.push({ pathname: '/player-profile', params: { profileId: p.profile_id } });

/** "Panos, Striker, rating 8.9, 4 G · 1 A, Player of the week". */
export function pitchPlayerLabel(p: TeamOfTheWeekPlayer): string {
  return [p.name, SLOT_LABELS[p.slot], `rating ${formatRating(p.average_rating)}`, statLine(p), p.player_of_the_week ? 'Player of the week' : '']
    .filter(Boolean)
    .join(', ');
}

function Spot({ slot, onPress }: { slot: LineupSlot & { index: number }; onPress: (p: TeamOfTheWeekPlayer) => void }) {
  const styles = useStyles();
  const p = slot.player;
  if (!p) {
    return (
      <View
        testID={`totw-pitch-empty-${slot.slot}-${slot.index}`}
        accessible
        accessibilityLabel={`${SLOT_LABELS[slot.slot]}: ${NO_ELIGIBLE_PLAYER}`}
        style={styles.spot}>
        <View style={[styles.ring, styles.emptyRing]} />
        <Text variant="caption" tone="onNightMuted" style={styles.centre} numberOfLines={2}>
          {NO_ELIGIBLE_PLAYER}
        </Text>
      </View>
    );
  }
  const line = statLine(p);
  return (
    <Pressable
      testID={`totw-pitch-player-${p.profile_id}`}
      accessibilityRole="button"
      accessibilityLabel={pitchPlayerLabel(p)}
      onPress={() => onPress(p)}
      style={({ pressed }) => [styles.spot, pressed && styles.pressed]}>
      <View style={[styles.ring, p.player_of_the_week && styles.ringTop]}>
        <Avatar name={p.name} kit={p.kit} size={AVATAR} />
      </View>
      <Text variant="callout" tone="onNight" style={styles.centre} numberOfLines={1}>
        {p.name}
      </Text>
      <View style={[styles.rating, p.player_of_the_week && styles.ratingTop]}>
        <Text variant="caption" tabular style={p.player_of_the_week ? styles.onRatingTop : styles.onRating}>
          {formatRating(p.average_rating)}
        </Text>
      </View>
      {line ? (
        <Text variant="caption" tone="onNightMuted" style={styles.centre} numberOfLines={1}>
          {line}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function TotwPitch({ players, shape, onPressPlayer = openProfile, testID = 'totw-pitch' }: TotwPitchProps) {
  const styles = useStyles();
  const slots = lineup(players, shape);
  const rows = ROWS.map((row) =>
    slots
      .map((s, i) => ({ ...s, index: i }))
      .filter((s) => s.slot === row)
      .map((s, i) => ({ ...s, index: i })),
  ).filter((r) => r.length > 0);
  return (
    <View testID={testID} style={styles.pitch}>
      <View style={[styles.box, styles.boxTop]} />
      <View style={styles.halfway} />
      <View style={[styles.box, styles.boxBottom]} />
      {rows.map((row) => (
        <View key={row[0].slot} testID={`totw-pitch-row-${row[0].slot}`} style={styles.row}>
          {row.map((s) => (
            <Spot key={`${s.slot}-${s.index}`} slot={s} onPress={onPressPlayer} />
          ))}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  pitch: {
    backgroundColor: colors.pitch,
    borderRadius: radius.card,
    overflow: 'hidden',
    paddingVertical: space.xl,
    paddingHorizontal: space.sm,
    gap: space.xl,
  },
  box: {
    position: 'absolute',
    left: '28%',
    right: '28%',
    height: 64,
    borderColor: colors.pitchLine,
    borderWidth: 2,
  },
  boxTop: { top: -2 },
  boxBottom: { bottom: -2 },
  halfway: { position: 'absolute', left: 0, right: 0, top: '50%', height: 2, backgroundColor: colors.pitchLine },
  row: { flexDirection: 'row', justifyContent: 'space-evenly', alignItems: 'flex-start' },
  spot: { flex: 1, maxWidth: 120, minHeight: MIN_TOUCH, alignItems: 'center', gap: space.xs },
  pressed: { opacity: 0.7 },
  ring: {
    width: AVATAR + 6,
    height: AVATAR + 6,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  ringTop: { borderColor: colors.ratingTop },
  emptyRing: { borderColor: colors.pitchLine, borderWidth: hairline * 3, backgroundColor: colors.pitch },
  centre: { textAlign: 'center' },
  rating: { backgroundColor: colors.brand, borderRadius: radius.chip, paddingHorizontal: space.sm },
  ratingTop: { backgroundColor: colors.ratingTop },
  onRating: { color: colors.onBrand },
  onRatingTop: { color: colors.onRatingTop },
}));
