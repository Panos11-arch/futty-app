// Season stats on player and team profiles (A7, match-record.md decision 1g):
// the numbers come from player_season_stats and team_season_stats as they
// are; the app only formats them. "This year" is the calendar year in Cyprus.
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatRating, type PlayerSeasonStats, type TeamSeasonStats } from '@/lib/match/stats-api';

export type SeasonPick = 'year' | 'all';

export type SeasonStatsState<T> = { status: 'loading' } | { status: 'error'; message?: string } | { status: 'ready'; stats: T | null };

type Tile = { label: string; value: string };

function Tiles({ tiles, testID }: { tiles: Tile[]; testID: string }) {
  return (
    <View style={styles.grid} testID={testID}>
      {tiles.map((t) => (
        <Card key={t.label} style={styles.tile}>
          <View style={styles.tileInner} accessible accessibilityLabel={`${t.label} ${t.value}`}>
            <Text variant="headline" tabular>
              {t.value}
            </Text>
            <Text variant="caption" tone="inkMuted">
              {t.label}
            </Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

const pct = (n: number) => `${n}%`;
const record = (won: number, drawn: number, lost: number) => `${won}-${drawn}-${lost}`;

export function playerTiles(s: PlayerSeasonStats): Tile[] {
  return [
    { label: 'Games', value: String(s.appearances) },
    { label: 'Win rate', value: pct(s.win_pct) },
    { label: 'W-D-L', value: record(s.won, s.drawn, s.lost) },
    { label: 'Goals', value: String(s.goals) },
    { label: 'Assists', value: String(s.assists) },
    { label: 'Man of the match', value: String(s.motm) },
    { label: 'Avg rating', value: formatRating(s.average_rating) },
  ];
}

export function teamTiles(s: TeamSeasonStats): Tile[] {
  return [
    { label: 'Played', value: String(s.played) },
    { label: 'Win rate', value: pct(s.win_pct) },
    { label: 'W-D-L', value: record(s.won, s.drawn, s.lost) },
    { label: 'Goals for', value: String(s.goals_for) },
    { label: 'Goals against', value: String(s.goals_against) },
    { label: 'Clean sheets', value: String(s.clean_sheets) },
    { label: 'Best run', value: s.longest_win_run === 1 ? '1 win' : `${s.longest_win_run} wins` },
    { label: 'Avg rating', value: formatRating(s.average_rating) },
  ];
}

/** "Level 3.0 to 3.4 this season"; nothing when the level didn't move. */
export function levelLine(s: PlayerSeasonStats, pick: SeasonPick): string | null {
  if (s.level_start == null || s.level_end == null) return null;
  const when = pick === 'year' ? 'this year' : 'so far';
  return `Level ${Number(s.level_start).toFixed(1)} to ${Number(s.level_end).toFixed(1)} ${when}`;
}

export function SeasonPicker({ value, onChange }: { value: SeasonPick; onChange: (v: SeasonPick) => void }) {
  return (
    <SegmentedControl
      options={[
        { value: 'year', label: 'This year' },
        { value: 'all', label: 'All time' },
      ]}
      value={value}
      onChange={onChange}
      accessibilityLabel="Season"
    />
  );
}

function Shell<T>({
  state,
  onRetry,
  empty,
  children,
}: {
  state: SeasonStatsState<T>;
  onRetry: () => void;
  empty: string;
  children: (stats: T) => ReactNode;
}) {
  if (state.status === 'loading') {
    return (
      <Card>
        <View testID="season-stats-skeleton">
          <SkeletonText lines={3} />
        </View>
      </Card>
    );
  }
  if (state.status === 'error') {
    return <Banner tone="danger" message="Couldn’t load the season stats." action={{ label: 'Try again', onPress: onRetry }} />;
  }
  if (!state.stats) return <EmptyState icon="trophy.fill" message={empty} />;
  return <>{children(state.stats)}</>;
}

export function PlayerSeasonStatsView({
  state,
  pick,
  onRetry,
}: {
  state: SeasonStatsState<PlayerSeasonStats>;
  pick: SeasonPick;
  onRetry: () => void;
}) {
  return (
    <Shell state={state} onRetry={onRetry} empty="No confirmed matches this season yet">
      {(s) => {
        const level = levelLine(s, pick);
        return (
          <View style={styles.stack}>
            <Tiles tiles={playerTiles(s)} testID="player-season-tiles" />
            {level ? (
              <Text variant="callout" tone="inkMuted">
                {level}
              </Text>
            ) : null}
          </View>
        );
      }}
    </Shell>
  );
}

export function TeamSeasonStatsView({
  state,
  onRetry,
}: {
  state: SeasonStatsState<TeamSeasonStats>;
  onRetry: () => void;
}) {
  return (
    <Shell state={state} onRetry={onRetry} empty="No confirmed matches this season yet">
      {(s) => <Tiles tiles={teamTiles(s)} testID="team-season-tiles" />}
    </Shell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: { flexGrow: 1, flexBasis: '30%' },
  tileInner: { alignItems: 'center', gap: space.xs },
});
