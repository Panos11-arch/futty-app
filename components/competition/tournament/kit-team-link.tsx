// S10A: a tournament team's kit badge (its colour and initials) and name;
// tapping opens the team page. Before a knockout team is known, its source
// ("A1", "Winner QF1") shows instead, and nothing opens.
import { Pressable, View } from 'react-native';

import { openTeam } from '@/components/competition/team-link';
import { TeamBadge } from '@/components/match/team-badge';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text, type TextTone } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

export function KitTeamLink({
  teamId,
  name,
  kitColour,
  size = 24,
  bold = false,
  tone = 'ink',
  testID,
}: {
  teamId: string | null;
  name: string;
  kitColour: string | null;
  size?: number;
  bold?: boolean;
  tone?: TextTone;
  testID?: string;
}) {
  const styles = useStyles();
  if (!teamId) {
    return (
      <View style={styles.team} testID={testID}>
        <Text variant="body" tone="inkMuted" numberOfLines={1} style={styles.name}>
          {name}
        </Text>
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={`Open ${name}`}
      onPress={() => openTeam(teamId)}
      style={({ pressed }) => [styles.team, pressed && styles.pressed]}>
      <TeamBadge name={name} kitColour={kitColour} size={size} />
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
