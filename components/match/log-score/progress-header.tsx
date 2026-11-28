// The progress bar at the top of the logging screens: 0% on Score, 33% on
// Goals, 66% on Assists, 100% on Review (decided 22 November).
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { LOG_STEPS, STEP_PROGRESS, STEP_TITLES, type LogStep } from '@/lib/match/log-score';
import { makeStyles } from '@/lib/theme';

export function ProgressHeader({ step }: { step: LogStep }) {
  const styles = useStyles();
  const progress = STEP_PROGRESS[step];
  // The shootout (S10A) is part of Score.
  const label = step === 'shootout' ? 'score' : step;
  return (
    <View style={styles.wrap} testID="log-score-progress">
      <View
        style={styles.track}
        testID="log-score-progress-bar"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={STEP_TITLES[step]}
        accessibilityValue={{ min: 0, max: 100, now: progress }}>
        {/* At 0% a dot still shows where it starts, as in image 07. */}
        <View testID="log-score-progress-fill" style={[styles.fill, { width: `${progress}%` }, progress === 0 && styles.dot]} />
      </View>
      <View style={styles.labels}>
        {LOG_STEPS.map((s) => (
          <Text key={s} variant="callout" tone={s === label ? 'ink' : 'inkMuted'} style={s === label ? styles.current : undefined}>
            {STEP_TITLES[s]}
          </Text>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  wrap: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm },
  track: { height: space.sm + space.xs / 2, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.positive },
  dot: { width: space.md },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  current: { fontWeight: '600' },
}));
