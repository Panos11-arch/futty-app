// S10A Standings (SofaScore 15): one table per group, A to D, computed on the
// server (points, goal difference, goals scored, head-to-head, then the
// organiser's draw). A green line marks the top two, who reach the
// quarter-finals; my own teams sit on greenSoft. "Rules" opens the server's
// tiebreak line.
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { AdBanner } from '@/components/ads/ad-banner';
import { KitTeamLink } from '@/components/competition/tournament/kit-team-link';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import type { GroupStandings as Group, GroupRow } from '@/lib/match/tournament-api';
import type { useTournamentStandings } from '@/lib/match/use-tournament';
import { makeStyles, useTheme } from '@/lib/theme';

const COLUMNS: { label: string; spoken: string; value: (r: GroupRow) => string }[] = [
  { label: 'P', spoken: 'played', value: (r) => String(r.played) },
  { label: 'W', spoken: 'won', value: (r) => String(r.won) },
  { label: 'D', spoken: 'drawn', value: (r) => String(r.drawn) },
  { label: 'L', spoken: 'lost', value: (r) => String(r.lost) },
  { label: 'Diff', spoken: 'goal difference', value: (r) => (r.goalDiff > 0 ? `+${r.goalDiff}` : String(r.goalDiff)) },
  { label: 'Pts', spoken: 'points', value: (r) => String(r.points) },
];

function rowLabel(r: GroupRow): string {
  return [`${r.pos}`, r.teamName, ...COLUMNS.map((c) => `${c.spoken} ${c.value(r)}`), ...(r.qualifies ? ['Quarter-finals'] : [])].join(', ');
}

function GroupTable({ group, myTeamIds }: { group: Group; myTeamIds: Set<string> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Card testID={`tournament-group-${group.group}`} padded={false}>
      <Text variant="headline" style={styles.tableName} accessibilityRole="header">
        {`Group ${group.group}`}
      </Text>
      <View style={styles.headRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Text variant="caption" tone="inkMuted" style={styles.pos}>
          #
        </Text>
        <Text variant="caption" tone="inkMuted" style={styles.team}>
          Team
        </Text>
        {COLUMNS.map((c) => (
          <Text key={c.label} variant="caption" tone="inkMuted" style={styles.stat}>
            {c.label}
          </Text>
        ))}
      </View>
      {group.rows.map((r) => {
        const mine = myTeamIds.has(r.teamId);
        return (
          <View
            key={r.teamId}
            testID={mine ? 'tournament-standings-row-mine' : 'tournament-standings-row'}
            accessible
            accessibilityLabel={rowLabel(r)}
            style={[styles.row, mine && styles.mine]}>
            <View
              testID={r.qualifies ? 'tournament-standings-qualifies' : undefined}
              style={[styles.zone, r.qualifies ? { backgroundColor: colors.positive } : null]}
            />
            <Text variant="callout" tabular style={styles.pos}>
              {String(r.pos)}
            </Text>
            <View style={styles.team}>
              <KitTeamLink teamId={r.teamId} name={r.teamName} kitColour={r.kitColour} />
            </View>
            {COLUMNS.map((c) => (
              <Text key={c.label} variant="callout" tabular style={[styles.stat, c.label === 'Pts' && styles.pts]}>
                {c.value(r)}
              </Text>
            ))}
          </View>
        );
      })}
      <View style={styles.legend} testID={`tournament-group-${group.group}-legend`}>
        <View style={[styles.legendSwatch, { backgroundColor: colors.positive }]} />
        <Text variant="caption" tone="inkMuted">
          Quarter-finals
        </Text>
      </View>
    </Card>
  );
}

function Rules({ text }: { text: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <Card padded={false}>
      <Pressable
        testID="tournament-standings-rules"
        accessibilityRole="button"
        accessibilityLabel="Rules"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={styles.rulesHead}>
        <Text variant="headline" style={styles.flex}>
          Rules
        </Text>
        <View style={open ? styles.flip : undefined}>
          <IconSymbol name="chevron.down" size={ICON.small} color={colors.ink} />
        </View>
      </Pressable>
      {open ? (
        <Text variant="callout" tone="inkMuted" style={styles.rulesText} testID="tournament-standings-rules-text">
          {text}
        </Text>
      ) : null}
    </Card>
  );
}

export function GroupStandingsTab({
  standings,
  myTeamIds,
  onSeeMatches,
}: {
  standings: ReturnType<typeof useTournamentStandings>;
  myTeamIds: Set<string>;
  onSeeMatches: () => void;
}) {
  const styles = useStyles();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await standings.reload();
    setRefreshing(false);
  };

  const groups = standings.status === 'ready' ? standings.standings.groups.filter((g) => g.rows.length > 0) : [];

  return (
    <ScrollView
      testID="tournament-standings"
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      {standings.status === 'loading' ? (
        <View testID="tournament-standings-skeleton">
          <SkeletonBlock width="100%" height={240} />
        </View>
      ) : null}
      {standings.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the standings." action={{ label: 'Try again', onPress: standings.reload }} />
      ) : null}
      {standings.status === 'ready' && groups.length === 0 ? (
        <EmptyState icon="trophy.fill" message="No groups yet" action={{ label: 'See matches', onPress: onSeeMatches }} />
      ) : null}
      {groups.map((g, i) => (
        <View key={g.group} style={styles.group}>
          <GroupTable group={g} myTeamIds={myTeamIds} />
          {i === 1 ? <AdBanner testID="tournament-standings-ad" /> : null}
        </View>
      ))}
      {standings.status === 'ready' && groups.length > 0 ? <Rules text={standings.standings.rules} /> : null}
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  content: { gap: space.lg, padding: space.lg, paddingBottom: space.xxl },
  group: { gap: space.lg },
  flex: { flex: 1 },
  tableName: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: space.lg },
  mine: { backgroundColor: colors.greenSoft },
  zone: { width: space.xs, alignSelf: 'stretch', marginRight: space.lg - space.xs },
  pos: { width: space.xl },
  team: { flex: 1 },
  stat: { width: space.xl + space.xs, textAlign: 'right' },
  pts: { fontFamily: type.title.fontFamily },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.xs, padding: space.lg },
  legendSwatch: { width: space.md, height: space.xs, borderRadius: radius.pill },
  rulesHead: { flexDirection: 'row', alignItems: 'center', padding: space.lg, minHeight: space.xxl + space.md },
  flip: { transform: [{ rotate: '180deg' }] },
  rulesText: { paddingHorizontal: space.lg, paddingBottom: space.lg },
}));
