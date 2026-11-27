// S10A: one tournament match in a list (SofaScore 12, 13): the Cyprus day
// and its status (the kick-off time, FT, or AP after penalties), both teams
// with their kit badges, the score, and the shootout ("AP 4–3") when there
// was one. The row opens the match once it has one.
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { KitTeamLink } from '@/components/competition/tournament/kit-team-link';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import {
  fixtureDateLabel,
  fixtureStatusLabel,
  shootoutText,
  type TournamentFixture,
} from '@/lib/match/tournament-api';
import { makeStyles } from '@/lib/theme';

const scoreText = (n: number | null) => (n == null ? '' : String(n));

export function FixtureRow({ fixture, first }: { fixture: TournamentFixture; first: boolean }) {
  const styles = useStyles();
  const done = fixture.status === 'completed';
  const homeWon = done && fixture.winnerTeamId != null && fixture.winnerTeamId === fixture.homeTeamId;
  const awayWon = done && fixture.winnerTeamId != null && fixture.winnerTeamId === fixture.awayTeamId;
  const shootout = shootoutText(fixture);
  const home = fixture.homeTeamName ?? 'To be decided';
  const away = fixture.awayTeamName ?? 'To be decided';
  const open = fixture.matchId ? () => router.push({ pathname: '/match/[id]', params: { id: fixture.matchId! } }) : undefined;
  const label = [
    fixtureDateLabel(fixture),
    fixtureStatusLabel(fixture),
    `${home} ${scoreText(fixture.homeScore)}`,
    `${away} ${scoreText(fixture.awayScore)}`,
    shootout ?? '',
  ]
    .filter((s) => s.trim())
    .join(', ');
  return (
    <Pressable
      testID={`tournament-match-${fixture.fixtureId}`}
      accessibilityRole={open ? 'button' : undefined}
      accessibilityLabel={open ? `${label}. Open the match` : label}
      disabled={!open}
      onPress={open}
      style={({ pressed }) => [styles.row, !first && styles.divider, pressed && styles.pressed]}>
      <View style={styles.when}>
        <Text variant="caption" tone="inkMuted" tabular>
          {fixtureDateLabel(fixture)}
        </Text>
        <Text variant="caption" tone="inkMuted">
          {fixtureStatusLabel(fixture)}
        </Text>
      </View>
      <View style={styles.teams}>
        <View style={styles.side}>
          <KitTeamLink
            teamId={fixture.homeTeamId}
            name={home}
            kitColour={fixture.homeKitColour}
            bold={homeWon}
            tone={awayWon ? 'inkMuted' : 'ink'}
          />
          <Text variant="headline" tabular tone={awayWon ? 'inkMuted' : 'ink'}>
            {scoreText(fixture.homeScore)}
          </Text>
        </View>
        <View style={styles.side}>
          <KitTeamLink
            teamId={fixture.awayTeamId}
            name={away}
            kitColour={fixture.awayKitColour}
            bold={awayWon}
            tone={homeWon ? 'inkMuted' : 'ink'}
          />
          <Text variant="headline" tabular tone={homeWon ? 'inkMuted' : 'ink'}>
            {scoreText(fixture.awayScore)}
          </Text>
        </View>
        {shootout ? (
          <Text variant="caption" tone="inkMuted" tabular testID={`tournament-match-pens-${fixture.fixtureId}`}>
            {shootout}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  divider: { borderTopWidth: hairline, borderTopColor: colors.border },
  pressed: { opacity: 0.7 },
  when: { width: space.xxl * 2, gap: space.xs },
  teams: { flex: 1 },
  side: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
}));
