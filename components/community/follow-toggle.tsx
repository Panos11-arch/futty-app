import { useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import type { FollowTarget } from '@/lib/community';
import { haptic } from '@/lib/haptics';
import type { useFollows } from '@/lib/use-follows';
import { makeStyles } from '@/lib/theme';

/** The words for a refused follow. The server refuses an adult and a minor
 *  following each other (age_pair_refused). */
export function followErrorLine(error: { message?: string } | null): string | null {
  if (!error) return null;
  return error.message?.includes('age_pair_refused') ? "You can't follow this player." : "Couldn't follow. Try again.";
}

/** Follow / Following for one player or team, from the caller's own follows. */
export function FollowToggle({
  targetType,
  targetId,
  name,
  follows,
  testID,
  compact = false,
}: {
  targetType: FollowTarget;
  targetId: string;
  name: string;
  follows: ReturnType<typeof useFollows>;
  testID?: string;
  compact?: boolean;
}) {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const following = follows.isFollowing(targetType, targetId);

  async function press() {
    if (!following) haptic.tap();
    setBusy(true);
    setError(null);
    const { error: toggleError } = await follows.toggle(targetType, targetId);
    setBusy(false);
    setError(followErrorLine(toggleError));
  }

  return (
    <View style={styles.wrap}>
      <Button
        testID={testID}
        label={following ? 'Following' : 'Follow'}
        variant={following ? 'secondary' : 'primary'}
        size={compact ? 'compact' : 'regular'}
        accessibilityHint={following ? `Stop following ${name}` : `Follow ${name}`}
        onPress={press}
        disabled={busy || follows.status !== 'ready'}
      />
      {error ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.xs },
}));
