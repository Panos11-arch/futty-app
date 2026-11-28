// S10A, after Score in a drawn knockout tournament game (decision 1o): the
// penalty shootout, 3 each then sudden death, entered like the score. Both
// captains must enter the same shootout; the server checks it can happen.
import { View } from 'react-native';

import { StepButton } from '@/components/match/log-score/step-button';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { SIDES, sideLabel, type MatchLog, type Score } from '@/lib/match/log-score';
import { makeStyles } from '@/lib/theme';

export function ShootoutStep({ log, pens, onChange }: { log: MatchLog; pens: Score; onChange: (p: Score) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.wrap} testID="post-match-step-shootout">
      <Text variant="display" accessibilityRole="header" style={styles.centre}>
        Penalties
      </Text>
      <View style={styles.row}>
        {SIDES.map((side, i) => (
          <View key={side} style={styles.rowPart}>
            {i === 1 ? (
              <Text variant="title" tone="inkMuted" accessible={false}>
                :
              </Text>
            ) : null}
            <View style={styles.side}>
              <View style={styles.stepper}>
                <StepButton
                  kind="minus"
                  accessibilityLabel={`${sideLabel(log, side)} one penalty fewer`}
                  disabled={pens[side] === 0}
                  onPress={() => onChange({ ...pens, [side]: Math.max(0, pens[side] - 1) })}
                  testID={`log-shootout-${side}-minus`}
                />
                <Text
                  variant="display"
                  tabular
                  style={styles.number}
                  testID={`log-shootout-${side}-value`}
                  accessibilityLabel={`${sideLabel(log, side)} ${pens[side]} penalties`}>
                  {String(pens[side])}
                </Text>
                <StepButton
                  kind="plus"
                  accessibilityLabel={`${sideLabel(log, side)} one penalty more`}
                  onPress={() => onChange({ ...pens, [side]: pens[side] + 1 })}
                  testID={`log-shootout-${side}-plus`}
                />
              </View>
              <Text variant="headline" numberOfLines={2} style={styles.centre}>
                {sideLabel(log, side)}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.xxl, paddingVertical: space.xl },
  centre: { textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  rowPart: { flex: 1, flexDirection: 'row', alignItems: 'flex-start' },
  side: { flex: 1, alignItems: 'center', gap: space.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  number: { minWidth: space.xxl + space.md, textAlign: 'center' },
}));
