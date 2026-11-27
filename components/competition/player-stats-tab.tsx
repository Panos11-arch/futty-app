// Player stats (Premium; SofaScore 16): chips Summary | Attack | Defence, a
// table sorted by any column (tap its heading), and a team filter. No
// position filters: positions are not recorded. The server refuses anyone
// without Premium (premium_required, profiles.is_premium); they see
// SofaScore-PRO's card instead: a faded placeholder table (no real data),
// "Rank players by any stat" and "Get Premium".
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { DropdownButton } from '@/components/competition/dropdown-button';
import { OptionSheet } from '@/components/competition/option-sheet';
import { openPlayer } from '@/components/competition/team-link';
import type { SeasonTeam } from '@/components/competition/matches-tab';
import { RatingBadge } from '@/components/match/rating-badge';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { competitionPlayerLook, sortPlayerStats, type PlayerStatKey, type PlayerStatRow } from '@/lib/match/competition-api';
import { useCompetitionPlayerStats } from '@/lib/match/use-competition';
import { makeStyles } from '@/lib/theme';

type Group = 'summary' | 'attack' | 'defence';

export type StatColumn = { key: PlayerStatKey; label: string; spoken: string };

export const PLAYER_STAT_GROUPS: Record<Group, { label: string; columns: StatColumn[] }> = {
  summary: {
    label: 'Summary',
    columns: [
      { key: 'rating', label: 'Rtg', spoken: 'Rating' },
      { key: 'matches', label: 'MP', spoken: 'Matches' },
      { key: 'goals', label: 'G', spoken: 'Goals' },
      { key: 'assists', label: 'A', spoken: 'Assists' },
    ],
  },
  attack: {
    label: 'Attack',
    columns: [
      { key: 'goals', label: 'G', spoken: 'Goals' },
      { key: 'assists', label: 'A', spoken: 'Assists' },
      { key: 'motm', label: 'MOTM', spoken: 'Man of the match' },
    ],
  },
  defence: {
    label: 'Defence',
    columns: [
      { key: 'cleanSheets', label: 'CS', spoken: 'Clean sheets' },
      { key: 'goalsConcededPerMatch', label: 'GC', spoken: 'Goals conceded per match' },
    ],
  },
};

const GROUPS: Group[] = ['summary', 'attack', 'defence'];

function cell(row: PlayerStatRow, key: PlayerStatKey): string {
  const v = row[key];
  if (v == null) return '–';
  return key === 'goalsConcededPerMatch' ? Number(v).toFixed(2) : String(v);
}

/** The PRO card for anyone without Premium: no real rows are ever drawn. */
export function PremiumCard() {
  const styles = useStyles();
  return (
    <View testID="competition-player-stats-premium" style={styles.content}>
      <View style={styles.faded} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.fakeRow}>
            <SkeletonBlock width={space.xxl} height={space.xxl} rounded="pill" />
            <SkeletonBlock width="40%" height={space.md} />
            <SkeletonBlock width={space.xxl} height={space.lg} />
          </View>
        ))}
      </View>
      <Card>
        <Text variant="title">Rank players by any stat</Text>
        <Button label="Get Premium" onPress={() => router.push('/account/premium')} fullWidth testID="competition-get-premium" />
      </Card>
    </View>
  );
}

export function PlayerStatsTab({ seasonId, teams }: { seasonId: string; teams: SeasonTeam[] }) {
  const styles = useStyles();
  const [group, setGroup] = useState<Group>('summary');
  const [sortKey, setSortKey] = useState<PlayerStatKey>('rating');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const stats = useCompetitionPlayerStats(seasonId, teamId);
  const columns = PLAYER_STAT_GROUPS[group].columns;
  const activeSort = columns.some((c) => c.key === sortKey) ? sortKey : columns[0].key;
  const rows = useMemo(() => (stats.status === 'ready' ? sortPlayerStats(stats.rows, activeSort) : []), [stats, activeSort]);

  if (stats.status === 'ready' && stats.premium) return <PremiumCard />;

  const refresh = async () => {
    setRefreshing(true);
    await stats.reload();
    setRefreshing(false);
  };

  const teamName = teams.find((t) => t.id === teamId)?.name ?? 'All teams';

  const header = (
    <View style={styles.header}>
      <View style={styles.chips}>
        {GROUPS.map((g) => (
          <Chip key={g} label={PLAYER_STAT_GROUPS[g].label} selected={group === g} onPress={() => setGroup(g)} testID={`competition-player-stats-${g}`} />
        ))}
      </View>
      <DropdownButton bordered label={teamName} accessibilityLabel={`${teamName}. Filter by team`} onPress={() => setPicking(true)} testID="competition-player-stats-team" />
      <View style={styles.headRow}>
        <Text variant="caption" tone="inkMuted" style={styles.player}>
          Player
        </Text>
        {columns.map((c) => {
          const active = c.key === activeSort;
          return (
            <Pressable
              key={c.key}
              testID={`competition-player-stats-sort-${c.key}`}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${c.spoken}`}
              accessibilityState={{ selected: active }}
              onPress={() => setSortKey(c.key)}
              style={styles.sortHead}>
              <Text variant="caption" tone={active ? 'ink' : 'inkMuted'} style={active ? styles.activeHead : undefined}>
                {active ? `${c.label} ▾` : c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      {stats.status === 'loading' ? (
        <View testID="competition-player-stats-skeleton" style={styles.content}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} width="100%" height={56} />
          ))}
        </View>
      ) : stats.status === 'error' ? (
        <View style={styles.content}>
          <Banner tone="danger" message="Couldn’t load the player stats." action={{ label: 'Try again', onPress: stats.reload }} />
        </View>
      ) : (
        <FlatList
          testID="competition-player-stats"
          data={rows}
          keyExtractor={(r) => r.profileId}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            <EmptyState
              icon="person.2.fill"
              message="No player stats yet"
              action={teamId ? { label: 'Show all teams', onPress: () => setTeamId(null) } : undefined}
            />
          }
          renderItem={({ item, index }) => (
            <View style={[styles.row, index > 0 && styles.divider]} testID={`competition-player-stats-row-${item.profileId}`}>
              <Text variant="callout" tone="inkMuted" tabular style={styles.rank}>
                {String(index + 1)}
              </Text>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={`Open ${item.name}`}
                onPress={() => openPlayer(item.profileId)}
                style={styles.player}>
                <Avatar name={item.name} kit={competitionPlayerLook(item)} size={32} />
                <View style={styles.flex}>
                  <Text variant="callout" numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.teamName ? (
                    <Text variant="caption" tone="inkMuted" numberOfLines={1}>
                      {item.teamName}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
              {columns.map((c) =>
                c.key === 'rating' && item.rating != null ? (
                  <View key={c.key} style={styles.stat}>
                    <RatingBadge rating={item.rating} />
                  </View>
                ) : (
                  <Text key={c.key} variant="callout" tabular style={styles.stat} accessibilityLabel={`${c.spoken} ${cell(item, c.key)}`}>
                    {cell(item, c.key)}
                  </Text>
                ),
              )}
            </View>
          )}
        />
      )}
      <OptionSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Team"
        options={[{ key: 'all', label: 'All teams' }, ...teams.map((t) => ({ key: t.id, label: t.name }))]}
        selectedKey={teamId ?? 'all'}
        onSelect={(key) => setTeamId(key === 'all' ? null : key)}
        search
        testID="competition-player-stats-teams"
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  screen: { flex: 1 },
  content: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  flex: { flex: 1 },
  header: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.xl },
  sortHead: { minWidth: space.xxl + space.sm, minHeight: MIN_TOUCH, alignItems: 'flex-end', justifyContent: 'center' },
  activeHead: { fontFamily: type.headline.fontFamily },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH + space.sm, backgroundColor: colors.surface, paddingHorizontal: space.sm, borderRadius: radius.control },
  divider: { borderTopWidth: hairline, borderTopColor: colors.border },
  rank: { minWidth: space.lg },
  player: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  stat: { minWidth: space.xxl + space.sm, alignItems: 'flex-end', textAlign: 'right' },
  faded: { opacity: 0.35, gap: space.md },
  fakeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
}));
