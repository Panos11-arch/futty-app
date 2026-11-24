import { Link } from 'expo-router';
import { View } from 'react-native';

import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

export default function ModalScreen() {
  const styles = useStyles();
  return (
    <View style={styles.container}>
      <Text variant="title" accessibilityRole="header">
        This is a modal
      </Text>
      <Link href="/" dismissTo style={styles.link}>
        <Text variant="body" tone="brand">
          Go to home screen
        </Text>
      </Link>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.md,
    backgroundColor: colors.canvas,
  },
  link: {
    minHeight: MIN_TOUCH,
    paddingVertical: space.md,
  },
}));
