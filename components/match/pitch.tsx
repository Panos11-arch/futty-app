// A drawn pitch with a formation's positions (05-product section 5). The
// pitch is neutral (surface and border); brand only marks the state the
// captain is acting on (15: brand is for actions and selected states, never
// decoration). Each position is a 44-point button with a spoken label.
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';

import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';
import { pitchLayout, positionLabel } from '@/lib/match/page';

export type PitchSlot = { key: string; name: string | null };

export type PitchProps = {
  formation: string;
  /** Name in each position; a missing or null name is an empty position. */
  names: Record<string, string | null>;
  /** Positions can be tapped. */
  editable?: boolean;
  /** A player is picked and waiting to be placed: empty positions are highlighted. */
  placing?: boolean;
  onPressPosition?: (key: string) => void;
  testID?: string;
};

const NEED_PLAYERS = 'Need players';
const MARKER_WIDTH = 88;
const MARKER_HEIGHT = 44;
const LINE = 0.6;

export function Pitch({ formation, names, editable = false, placing = false, onPressPosition, testID }: PitchProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const spots = pitchLayout(formation);
  return (
    <View style={styles.pitch} testID={testID}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 140" preserveAspectRatio="none">
        <Rect x={1} y={1} width={98} height={138} fill={colors.surface} stroke={colors.border} strokeWidth={LINE} />
        <Line x1={1} y1={70} x2={99} y2={70} stroke={colors.border} strokeWidth={LINE} />
        <Circle cx={50} cy={70} r={12} fill="none" stroke={colors.border} strokeWidth={LINE} />
        <Circle cx={50} cy={70} r={0.9} fill={colors.border} />
        <Rect x={25} y={1} width={50} height={18} fill="none" stroke={colors.border} strokeWidth={LINE} />
        <Rect x={25} y={121} width={50} height={18} fill="none" stroke={colors.border} strokeWidth={LINE} />
      </Svg>
      {spots.map(({ key, x, y }) => {
        const name = names[key] ?? null;
        const label = `${positionLabel(key)}: ${name ?? NEED_PLAYERS}`;
        const highlight = editable && placing && name === null;
        return (
          <Pressable
            key={key}
            testID={`position-${key}`}
            accessibilityLabel={label}
            accessibilityRole={editable ? 'button' : undefined}
            disabled={!editable}
            onPress={() => onPressPosition?.(key)}
            style={[
              styles.marker,
              { left: `${x * 100}%`, top: `${y * 100}%` },
              highlight && styles.markerPlacing,
            ]}
          >
            <Text variant="caption" tone={name ? 'ink' : 'inkMuted'} numberOfLines={2} style={styles.name}>
              {name ?? NEED_PLAYERS}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  pitch: { width: '100%', aspectRatio: 100 / 140, borderRadius: radius.control, overflow: 'hidden' },
  marker: {
    position: 'absolute',
    width: MARKER_WIDTH,
    minHeight: MARKER_HEIGHT,
    marginLeft: -MARKER_WIDTH / 2,
    marginTop: -MARKER_HEIGHT / 2,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: hairline,
    borderRadius: radius.control,
  },
  markerPlacing: { backgroundColor: colors.brandSoft, borderColor: colors.brand },
  name: { textAlign: 'center' },
}));
