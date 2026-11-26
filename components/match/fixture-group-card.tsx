import { Pressable, View } from 'react-native';

import { CompetitionBadge } from '@/components/match/night-header';
import { Card } from '@/components/ui/card';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import { competitionBadge } from '@/lib/match/league-directory';
import { fixtureStatusLabel, type DayFixture, type FixtureGroup } from '@/lib/match/day-fixtures';
import { makeStyles, useTheme } from '@/lib/theme';

function TeamName({ team, onOpenTeam, mine }: { team: DayFixture['home_team']; onOpenTeam: (id: string) => void; mine: boolean }) {
  const styles = useStyles();
  if (!team) {
    return (
      <Text variant="body" tone="inkMuted" numberOfLines={1}>
        TBC
      </Text>
    );
  }
  return (
    <Pressable
      testID={`matches-team-${team.id}`}
      accessibilityRole="link"
      accessibilityLabel={`Open ${team.name}`}
      hitSlop={{ top: space.xs, bottom: space.xs }}
      onPress={() => onOpenTeam(team.id)}
      style={styles.team}>
      <Text variant={mine ? 'headline' : 'body'} numberOfLines={1}>
        {team.name}
      </Text>
    </Pressable>
  );
}

function FixtureRow({
  fixture,
  myTeamIds,
  onOpenFixture,
  onOpenTeam,
}: {
  fixture: DayFixture;
  myTeamIds: Set<string>;
  onOpenFixture: (id: string) => void;
  onOpenTeam: (id: string) => void;
}) {
  const styles = useStyles();
  const status = fixtureStatusLabel(fixture);
  const done = fixture.status === 'completed';
  const home = fixture.home_team?.name ?? 'TBC';
  const away = fixture.away_team?.name ?? 'TBC';
  const score = done && fixture.home_score !== null && fixture.away_score !== null ? `, ${fixture.home_score} ${fixture.away_score}` : '';
  return (
    <Pressable
      testID={`matches-fixture-${fixture.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${status === 'FT' ? 'Full time' : status}, ${home} v ${away}${score}`}
      onPress={() => onOpenFixture(fixture.id)}
      style={({ pressed }) => [styles.fixture, pressed && styles.pressed]}>
      <Text variant="caption" tone="inkMuted" tabular style={styles.status}>
        {status}
      </Text>
      <View style={styles.teams}>
        <TeamName team={fixture.home_team} onOpenTeam={onOpenTeam} mine={!!fixture.home_team && myTeamIds.has(fixture.home_team.id)} />
        <TeamName team={fixture.away_team} onOpenTeam={onOpenTeam} mine={!!fixture.away_team && myTeamIds.has(fixture.away_team.id)} />
      </View>
      {done ? (
        <View style={styles.scores}>
          <Text variant="headline" tabular>
            {fixture.home_score === null ? '–' : String(fixture.home_score)}
          </Text>
          <Text variant="headline" tabular>
            {fixture.away_score === null ? '–' : String(fixture.away_score)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export type FixtureGroupCardProps = {
  group: FixtureGroup;
  myTeamIds: Set<string>;
  onTogglePin: () => void;
  onOpenFixture: (id: string) => void;
  onOpenTeam: (id: string) => void;
};

/** One competition on the MATCHES tab (sofascore-05): badge, name, area and
 *  a star (the same pin as LEAGUES), then its fixtures. */
export function FixtureGroupCard({ group, myTeamIds, onTogglePin, onOpenFixture, onOpenTeam }: FixtureGroupCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Card padded={false} testID={`matches-group-${group.key}`}>
      <View style={styles.header}>
        <CompetitionBadge label={competitionBadge(group.scope, group.format)} />
        <View style={styles.headerText} accessible accessibilityRole="header">
          <Text variant="headline" numberOfLines={1}>
            {group.name}
          </Text>
          <Text variant="caption" tone="inkMuted" numberOfLines={1}>
            {group.area}
          </Text>
        </View>
        <Pressable
          testID={`matches-star-${group.key}`}
          accessibilityRole="button"
          accessibilityLabel={group.pinned ? `Unpin ${group.name}` : `Pin ${group.name}`}
          accessibilityState={{ selected: group.pinned }}
          onPress={onTogglePin}
          style={({ pressed }) => [styles.star, pressed && styles.pressed]}>
          <IconSymbol name="star.fill" size={ICON.regular} color={group.pinned ? colors.ink : colors.inkMuted} />
        </Pressable>
      </View>
      {group.fixtures.map((fixture) => (
        <FixtureRow key={fixture.id} fixture={fixture} myTeamIds={myTeamIds} onOpenFixture={onOpenFixture} onOpenTeam={onOpenTeam} />
      ))}
    </Card>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, paddingRight: space.sm },
  headerText: { flex: 1 },
  star: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  fixture: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: MIN_TOUCH,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  status: { width: space.xxl + space.lg, textAlign: 'center' },
  teams: { flex: 1, gap: space.xs },
  team: { alignSelf: 'flex-start' },
  scores: { alignItems: 'flex-end', gap: space.xs },
  pressed: { opacity: 0.7 },
}));
