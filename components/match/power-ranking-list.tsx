// Rankings → Power ranking (image 14; match-record.md decision 1m): every
// listed team in the format, ranked by the server. A row: rank, the change
// since Monday (▲ green, ▼ red), the team badge, its name, the last three
// results and its points (whole numbers). Tapping a row opens its breakdown
// in place: each counted game, the points it won or lost and the expected
// win chance. The badge and name open the team page.
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { EmptyState } from '@/components/ui/empty-state';
import { FormBadge } from '@/components/ui/form-badge';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text, type TextTone } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import {
  breakdownLine,
  expectedLine,
  formatChange,
  formatPoints,
  rankMove,
  spokenResult,
  type PowerRankingGame,
  type PowerRankingRow,
} from '@/lib/match/power-ranking-api';
import { usePowerRanking, usePowerRankingHistory } from '@/lib/match/use-stats';
import { makeStyles } from '@/lib/theme';

const MOVE_TONE: Record<'up' | 'down' | 'none', TextTone> = { up: 'positive', down: 'danger', none: 'inkMuted' };
const CHANGE_TONE = (change: number): TextTone => (change > 0 ? 'positive' : change < 0 ? 'danger' : 'inkMuted');

/** "1, Kato United, up 2, won, won, drew, 1046 points". */
export function rankingRowLabel(row: PowerRankingRow): string {
  return [
    String(row.rank),
    row.team_name,
    rankMove(row.rank_change).spoken,
    ...(row.last_results ?? []).map(spokenResult),
    `${formatPoints(row.points)} points`,
  ].join(', ');
}

const openTeam = (teamId: string) => router.push({ pathname: '/team-profile', params: { teamId } });

function Game({ game }: { game: PowerRankingGame }) {
  const styles = useStyles();
  return (
    <View testID={`power-ranking-game-${game.game_id}`} style={styles.game}>
      <View style={styles.gameText}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`${breakdownLine(game)}. Opens ${game.opponent_name}`}
          onPress={() => openTeam(game.opponent_team_id)}>
          <Text variant="callout">{breakdownLine(game)}</Text>
        </Pressable>
        <Text variant="caption" tone="inkMuted">
          {expectedLine(game.expected)}
        </Text>
      </View>
      <Text variant="headline" tabular tone={CHANGE_TONE(game.change)}>
        {formatChange(game.change)}
      </Text>
    </View>
  );
}

function Breakdown({ teamId, format }: { teamId: string; format: string }) {
  const styles = useStyles();
  const history = usePowerRankingHistory(teamId, format);
  return (
    <View testID={`power-ranking-breakdown-${teamId}`} style={styles.breakdown}>
      {history.status === 'loading' ? <SkeletonText lines={2} /> : null}
      {history.status === 'error' ? (
        <Banner tone="danger" message="Couldn’t load the games." action={{ label: 'Try again', onPress: history.reload }} />
      ) : null}
      {history.status === 'ready' ? history.games.map((g) => <Game key={g.game_id} game={g} />) : null}
    </View>
  );
}

function Row({ row, format, open, onToggle, first, last }: { row: PowerRankingRow; format: string; open: boolean; onToggle: () => void; first: boolean; last: boolean }) {
  const styles = useStyles();
  const move = rankMove(row.rank_change);
  return (
    <View style={[styles.card, first && styles.cardFirst, last && styles.cardLast, !last && styles.divider]}>
      <Pressable
        testID={`power-ranking-row-${row.team_id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={rankingRowLabel(row)}
        accessibilityHint={open ? 'Hides the games' : 'Shows the games'}
        onPress={onToggle}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Text variant="headline" tabular style={styles.rank}>
          {String(row.rank)}
        </Text>
        <Text variant="callout" tabular tone={MOVE_TONE[move.direction]} style={styles.move}>
          {move.label}
        </Text>
        <Pressable
          testID={`power-ranking-team-${row.team_id}`}
          accessibilityRole="link"
          accessibilityLabel={`Open ${row.team_name}`}
          onPress={() => openTeam(row.team_id)}
          style={styles.team}>
          <Avatar name={row.team_name} size={40} />
          <Text variant="body" numberOfLines={2} style={styles.name}>
            {row.team_name}
          </Text>
        </Pressable>
        <View style={styles.form}>
          {(row.last_results ?? []).map((r, i) => (
            <FormBadge key={i} result={r} label={r} accessibilityLabel={spokenResult(r)} />
          ))}
        </View>
        <Text variant="number" tabular style={styles.points}>
          {formatPoints(row.points)}
        </Text>
      </Pressable>
      {open ? <Breakdown teamId={row.team_id} format={format} /> : null}
    </View>
  );
}

export function PowerRankingList({ format, onSeeTeamOfTheWeek }: { format: string; onSeeTeamOfTheWeek: () => void }) {
  const styles = useStyles();
  const ranking = usePowerRanking(format);
  const [openId, setOpenId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await ranking.reload();
    setRefreshing(false);
  };

  if (ranking.status === 'loading') {
    return (
      <View testID="power-ranking-skeleton" style={styles.content}>
        {[0, 1, 2, 3, 4].map((i) => (
          <SkeletonBlock key={i} width="100%" height={64} />
        ))}
      </View>
    );
  }
  if (ranking.status === 'error') {
    return (
      <View style={styles.content}>
        <Banner tone="danger" message="Couldn’t load the ranking." action={{ label: 'Try again', onPress: ranking.reload }} />
      </View>
    );
  }
  const rows = ranking.rows;
  return (
    <FlatList
      testID="power-ranking-list"
      data={rows}
      keyExtractor={(r) => r.team_id}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      ListEmptyComponent={
        <EmptyState icon="trophy.fill" message="No ranked teams yet" action={{ label: 'See Team of the Week', onPress: onSeeTeamOfTheWeek }} />
      }
      renderItem={({ item, index }) => (
        <Row
          row={item}
          format={format}
          open={openId === item.team_id}
          onToggle={() => setOpenId((id) => (id === item.team_id ? null : item.team_id))}
          first={index === 0}
          last={index === rows.length - 1}
        />
      )}
    />
  );
}

const useStyles = makeStyles(({ colors }) => ({
  content: { padding: space.lg, paddingBottom: space.xxl, gap: 0 },
  card: { backgroundColor: colors.surface, borderLeftWidth: hairline, borderRightWidth: hairline, borderColor: colors.border },
  cardFirst: { borderTopWidth: hairline, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  cardLast: { borderBottomWidth: hairline, borderBottomLeftRadius: radius.card, borderBottomRightRadius: radius.card, overflow: 'hidden' },
  divider: { borderBottomWidth: hairline, borderBottomColor: colors.border },
  row: { minHeight: MIN_TOUCH + space.lg, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  pressed: { opacity: 0.7 },
  rank: { minWidth: space.xl },
  move: { minWidth: space.xl + space.sm },
  team: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  name: { flex: 1 },
  form: { flexDirection: 'row', gap: space.xs },
  points: { minWidth: space.xxl + space.lg, textAlign: 'right' },
  breakdown: { backgroundColor: colors.canvas, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md },
  game: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  gameText: { flex: 1, gap: space.xs },
}));
