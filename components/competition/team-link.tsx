// A team's badge and name; tapping opens the team page.
import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text, type TextTone } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

export const openTeam = (teamId: string) => router.push({ pathname: '/team-profile', params: { teamId } });
export const openPlayer = (profileId: string) => router.push({ pathname: '/player-profile', params: { profileId } });

export function TeamLink({
  teamId,
  name,
  size = 24,
  bold = false,
  tone = 'ink',
  testID,
}: {
  teamId: string;
  name: string;
  size?: number;
  bold?: boolean;
  tone?: TextTone;
  testID?: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={`Open ${name}`}
      onPress={() => openTeam(teamId)}
      style={({ pressed }) => [styles.team, pressed && styles.pressed]}>
      <Avatar name={name} size={size} />
      <Text variant={bold ? 'headline' : 'body'} tone={tone} numberOfLines={1} style={styles.name}>
        {name}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  team: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH, flexShrink: 1 },
  name: { flexShrink: 1 },
  pressed: { opacity: 0.7 },
}));
