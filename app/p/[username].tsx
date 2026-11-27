// S20: futty.app/p/<username> (the S19 card's QR and Share link; S16 opens
// it in the app) and Scan both land here: the player's sheet over the
// canvas. Closing it goes back, or Home when the link opened the app.
//
// Not listed in app/_layout.tsx: like check-in.tsx, the route works on its
// own, and guards a signed-out player itself.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { ProfileSheet } from '@/components/friends/profile-sheet';
import { Button, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { SCAN_HREF } from '@/lib/friends';
import { makeStyles } from '@/lib/theme';
import { USERNAME_PATTERN } from '@/lib/username';

function done() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function PlayerLinkScreen() {
  const styles = useStyles();
  const { username = '' } = useLocalSearchParams<{ username?: string }>();
  const { user } = useAuth();
  const valid = USERNAME_PATTERN.test(username);

  return (
    <View style={styles.screen} testID="player-link-screen">
      <Stack.Screen options={{ headerShown: false }} />
      {!user ? (
        <View style={styles.stack}>
          <Text>Sign in to see this player.</Text>
          <Button testID="player-link-sign-in" label="Sign in" onPress={() => router.replace('/sign-in')} />
        </View>
      ) : (
        <ProfileSheet
          visible
          who={valid ? { username } : { username: '' }}
          onClose={done}
          onScanAgain={() => router.replace(SCAN_HREF)}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas, justifyContent: 'center' },
  stack: { gap: space.md, padding: space.lg },
}));
