import { router } from 'expo-router';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/**
 * The Rankings tab (S2): a placeholder until S15 builds Team of the Week and
 * Power ranking here (images 14, 15). One line and one button: Team of the
 * Week (app/match/team-of-the-week.tsx) stays one tap away.
 */
export default function RankingsScreen() {
  const styles = useStyles();
  return (
    <View testID="rankings-screen" style={styles.screen}>
      <Text variant="body" tone="inkMuted" style={styles.line}>
        Coming soon
      </Text>
      <Button
        testID="rankings-totw"
        label="See Team of the Week"
        variant="secondary"
        onPress={() => router.push('/match/team-of-the-week')}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.canvas,
  },
  line: { textAlign: 'center' },
}));
