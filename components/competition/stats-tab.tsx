// Stats (free; SofaScore 18-20): PLAYERS | TEAMS | PERFORMANCES. Each card
// shows a category's top 3 with "See all" (the whole list in a sheet) and a
// dismissable one-line info. No position chips: positions are not recorded.
// Players blocked either way are left out by the server.
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { AdBanner } from '@/components/ads/ad-banner';
import { InfoLine } from '@/components/competition/info-line';
import { openPlayer, openTeam } from '@/components/competition/team-link';
import { RatingBadge } from '@/components/match/rating-badge';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { competitionPlayerLook, type StatRow, type StatsTab as Tab } from '@/lib/match/competition-api';
import { useCompetitionStats } from '@/lib/match/use-competition';
import { makeStyles } from '@/lib/theme';

export const STAT_CARDS: Record<Tab, Record<string, { title: string; info: string }>> = {
  players: {
    rating: { title: 'Average rating', info: 'Average match rating this season.' },
    goals: { title: 'Goals', info: 'Goals scored this season.' },
    assists: { title: 'Assists', info: 'Assists this season.' },
    motm: { title: 'Man of the match', info: 'Man of the match awards this season.' },
    clean_sheets: { title: 'Clean sheets', info: 'Matches without conceding this season.' },
  },
  teams: {
    rating: { title: 'Average rating', info: 'Average player rating per match.' },
    goals_scored: { title: 'Goals scored', info: 'Goals scored this season.' },
    goals_conceded: { title: 'Goals conceded', info: 'Fewest goals conceded first.' },
    clean_sheets: { title: 'Clean sheets', info: 'Matches without conceding this season.' },
  },
  performances: {
    rating: { title: 'Best rating', info: 'Highest rating in one match.' },
    goals: { title: 'Most goals', info: 'Most goals in one match.' },
    assists: { title: 'Most assists', info: 'Most assists in one match.' },
  },
};

const TABS: { value: Tab; label: string; testID: string }[] = [
  { value: 'players', label: 'PLAYERS', testID: 'competition-stats-players' },
  { value: 'teams', label: 'TEAMS', testID: 'competition-stats-teams' },
  { value: 'performances', label: 'PERFORMANCES', testID: 'competition-stats-performances' },
];

function StatValue({ category, value }: { category: string; value: number }) {
  if (category === 'rating') return <RatingBadge rating={value} />;
  return (
    <Text variant="headline" tabular>
      {String(value)}
    </Text>
  );
}

function StatLine({ tab, category, row }: { tab: Tab; category: string; row: StatRow }) {
  const styles = useStyles();
  const isTeam = tab === 'teams';
  const name = isTeam ? row.teamName ?? '' : row.name ?? '';
  const open = isTeam ? () => row.teamId && openTeam(row.teamId) : () => row.profileId && openPlayer(row.profileId);
  const sub =
    tab === 'performances'
      ? `${row.homeTeamName} ${row.homeScore ?? ''}-${row.awayScore ?? ''} ${row.awayTeamName}`
      : tab === 'players'
        ? row.teamName ?? null
        : null;
  return (
    <View style={styles.line} testID={`competition-stat-${category}-${isTeam ? row.teamId : row.profileId}`}>
      <Pressable accessibilityRole="link" accessibilityLabel={`Open ${name}`} onPress={open} style={styles.who}>
        <Avatar name={name} kit={isTeam ? null : competitionPlayerLook(row)} size={40} />
        <View style={styles.flex}>
          <Text variant="body" numberOfLines={1}>
            {name}
          </Text>
          {sub ? (
            <Text variant="caption" tone="inkMuted" numberOfLines={1}>
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {tab === 'performances' && row.matchId ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Open the match, ${sub}`}
          onPress={() => router.push({ pathname: '/match/[id]', params: { id: row.matchId! } })}
          style={styles.value}>
          <StatValue category={category} value={row.value} />
        </Pressable>
      ) : (
        <View style={styles.value}>
          <StatValue category={category} value={row.value} />
        </View>
      )}
    </View>
  );
}

function SeeAllSheet({ seasonId, tab, category, onClose }: { seasonId: string; tab: Tab; category: string; onClose: () => void }) {
  const styles = useStyles();
  const all = useCompetitionStats(seasonId, tab, category, 100);
  const rows = all.status === 'ready' ? all.categories.find((c) => c.category === category)?.rows ?? [] : [];
  return (
    <Sheet visible onClose={onClose} title={STAT_CARDS[tab][category]?.title ?? ''}>
      {all.status === 'loading' ? <SkeletonText lines={4} /> : null}
      {all.status === 'error' ? <Banner tone="danger" message="Couldn’t load the list." action={{ label: 'Try again', onPress: all.reload }} /> : null}
      <ScrollView style={styles.sheetList} testID="competition-stats-all">
        {rows.map((r, i) => (
          <StatLine key={`${r.profileId ?? r.teamId}-${r.matchId ?? i}`} tab={tab} category={category} row={r} />
        ))}
      </ScrollView>
    </Sheet>
  );
}

export function StatsTab({ seasonId, onSeeMatches }: { seasonId: string; onSeeMatches: () => void }) {
  const styles = useStyles();
  const [tab, setTab] = useState<Tab>('players');
  const [seeAll, setSeeAll] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const stats = useCompetitionStats(seasonId, tab);
  const cards = stats.status === 'ready' ? stats.categories.filter((c) => c.rows.length > 0 && STAT_CARDS[tab][c.category]) : [];

  const refresh = async () => {
    setRefreshing(true);
    await stats.reload();
    setRefreshing(false);
  };

  const header = <SegmentedControl options={TABS} value={tab} onChange={setTab} accessibilityLabel="Stats" />;

  return (
    <View style={styles.screen}>
      {stats.status === 'loading' ? (
        <View testID="competition-stats-skeleton" style={styles.content}>
          {header}
          <SkeletonBlock width="100%" height={200} />
          <SkeletonBlock width="100%" height={200} />
        </View>
      ) : stats.status === 'error' ? (
        <View style={styles.content}>
          {header}
          <Banner tone="danger" message="Couldn’t load the stats." action={{ label: 'Try again', onPress: stats.reload }} />
        </View>
      ) : (
        <FlatList
          testID="competition-stats"
          data={cards}
          keyExtractor={(c) => c.category}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState icon="trophy.fill" message="No stats yet" action={{ label: 'See matches', onPress: onSeeMatches }} />}
          // G4a: the banner ad under the cards (none on Premium Plus).
          ListFooterComponent={cards.length > 0 ? <AdBanner testID="competition-stats-ad" /> : null}
          renderItem={({ item }) => {
            const look = STAT_CARDS[tab][item.category];
            return (
              <Card testID={`competition-stats-card-${item.category}`}>
                <View style={styles.cardHead}>
                  <Text variant="headline" style={styles.flex}>
                    {look.title}
                  </Text>
                  <Button
                    label="See all"
                    variant="plain"
                    size="compact"
                    onPress={() => setSeeAll(item.category)}
                    testID={`competition-stats-see-all-${item.category}`}
                  />
                </View>
                {item.rows.slice(0, 3).map((r, i) => (
                  <StatLine key={`${r.profileId ?? r.teamId}-${r.matchId ?? i}`} tab={tab} category={item.category} row={r} />
                ))}
                <InfoLine key={`${tab}-${item.category}`} text={look.info} testID={`competition-stats-info-${item.category}`} />
              </Card>
            );
          }}
        />
      )}
      {seeAll ? <SeeAllSheet seasonId={seasonId} tab={tab} category={seeAll} onClose={() => setSeeAll(null)} /> : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  screen: { flex: 1 },
  content: { gap: space.lg, padding: space.lg, paddingBottom: space.xxl },
  flex: { flex: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  who: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  value: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  sheetList: { maxHeight: space.xxl * 12 },
}));
