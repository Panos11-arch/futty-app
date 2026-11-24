// The five starting questions (A5b; docs/specs/match-record.md decision
// 1f.2): opened once from Home after sign-up, and from Profile while the
// player has no questionnaire level. Skip and Done both go back.
import { router, Stack } from 'expo-router';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StartingLevelForm } from '@/components/match/starting-level-form';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function StartingLevelScreen() {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Your level' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <StartingLevelForm onClose={close} />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg },
}));
