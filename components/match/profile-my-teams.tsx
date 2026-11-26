// S8 Profile tab, "My teams" (image 19; spec 15 section 0.9: Play's Teams
// moves here). Each row opens the team page. "New team" opens the league
// sign-up, which is where a team is created today. Team Power waits for
// S14b, so the row shows the player's role and the team's area.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { teamSubtitle } from '@/lib/match/profile-summary-api';
import { makeStyles } from '@/lib/theme';
import type { MyTeam } from '@/lib/use-my-teams';

export type MyTeamsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; teams: MyTeam[] };

const NEW_TEAM_ROUTE = '/leagues';
const newTeam = () => router.push(NEW_TEAM_ROUTE);

export function ProfileMyTeams({ state, onRetry }: { state: MyTeamsState; onRetry: () => void }) {
  const styles = useStyles();
  const empty = state.status === 'ready' && state.teams.length === 0;

  return (
    <Card style={styles.card} testID="profile-teams">
      <View style={styles.header}>
        <Text variant="headline" accessibilityRole="header">
          My teams
        </Text>
        {!empty ? (
          <Pressable
            testID="profile-new-team"
            accessibilityRole="button"
            accessibilityLabel="New team"
            onPress={newTeam}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
            <Text variant="callout" tone="inkMuted">
              + New team
            </Text>
          </Pressable>
        ) : null}
      </View>

      {state.status === 'loading' ? (
        <View testID="profile-teams-skeleton">
          <SkeletonText lines={2} />
        </View>
      ) : state.status === 'error' ? (
        <Banner tone="danger" message="Your teams couldn’t load." action={{ label: 'Try again', onPress: onRetry }} />
      ) : empty ? (
        <View style={styles.empty}>
          <Text variant="callout" tone="inkMuted">
            No team yet
          </Text>
          <Button label="New team" variant="secondary" onPress={newTeam} testID="profile-new-team" />
        </View>
      ) : (
        state.teams.map(({ team, role }) => {
          const subtitle = teamSubtitle(role, team.city);
          return (
            <ListRow
              key={team.id}
              testID="profile-team-row"
              title={team.name}
              subtitle={subtitle || undefined}
              leading={{ avatar: { name: team.name } }}
              chevron
              accessibilityLabel={subtitle ? `${team.name}, ${subtitle}` : team.name}
              onPress={() => router.push({ pathname: '/team-profile', params: { teamId: team.id } })}
            />
          );
        })
      )}
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: space.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerAction: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  empty: { gap: space.md, alignItems: 'flex-start' },
  pressed: { opacity: 0.8 },
}));
