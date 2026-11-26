// Home's "Games needing players" (image 01): a horizontal row of open games
// that still have spots, from Find a match's data (S6: find_matches, priced by
// the server exactly as B4 prices them). A card opens the same screen Find a
// match opens. Hidden when no game needs players.
import { router } from 'expo-router';
import { FlatList, View } from 'react-native';

import { InlineError } from '@/components/home/inline-error';
import { useReloadOn, useReloadOnRefocus } from '@/components/home/refresh';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { useLoad } from '@/lib/booking-search';
import { cardHref, emptyFilters, fetchMatches, type MatchCard, priceText } from '@/lib/find-match';
import { formatMatchWhen } from '@/lib/match/format';
import { makeStyles } from '@/lib/theme';

/** How many games the row holds; the rest are in Find a match. */
export const GAMES_SHOWN = 10;

/** Players games with a spot left, soonest first. */
export function gamesNeedingPlayers(cards: MatchCard[]): MatchCard[] {
  return cards
    .filter((c) => c.kind === 'players' && c.players_in !== null && c.capacity !== null && c.players_in < c.capacity)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, GAMES_SHOWN);
}

/** "1 spot", "2 spots": the places still free. */
export function spotsLeftText(card: Pick<MatchCard, 'players_in' | 'capacity'>): string {
  const left = (card.capacity ?? 0) - (card.players_in ?? 0);
  return left === 1 ? '1 spot' : `${left} spots`;
}

const openFindMatch = () => router.push({ pathname: '/squads', params: { view: 'players' } });
const loadGames = () => fetchMatches(emptyFilters());

function GameCard({ card }: { card: MatchCard }) {
  const styles = useStyles();
  const when = formatMatchWhen(card.scheduled_at);
  const where = [card.format, card.venue_city ?? card.venue_name].join(' · ');
  const price = priceText(card.priceCents);
  const spots = spotsLeftText(card);
  return (
    <Card
      testID={`home-game-${card.post_id}`}
      style={styles.card}
      onPress={() => router.push(cardHref(card))}
      accessibilityLabel={[when, where, spots, price].filter(Boolean).join(', ')}
    >
      <Text variant="headline" tabular numberOfLines={1}>
        {when}
      </Text>
      <Text variant="callout" tone="inkMuted" numberOfLines={1}>
        {where}
      </Text>
      <View style={styles.footer}>
        <Text variant="callout" tabular>
          {spots}
        </Text>
        {price ? (
          <Text variant="callout" tabular numberOfLines={1} style={styles.price}>
            {price}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

export function GamesNeedingPlayers({ refreshSignal }: { refreshSignal: number }) {
  const styles = useStyles();
  const games = useLoad('home-games', loadGames);

  useReloadOnRefocus(games.reload);
  useReloadOn(refreshSignal, games.reload);

  if (games.state.status === 'loading') {
    return (
      <View testID="home-games-skeleton" style={styles.section}>
        <SkeletonBlock width="60%" height={space.xl} />
        <SkeletonBlock width="100%" height={space.xxl * 3} />
      </View>
    );
  }
  if (games.state.status === 'error') {
    return (
      <View style={styles.section}>
        <SectionHeader title="Games needing players" />
        <InlineError message="Could not load games needing players." onRetry={games.reload} />
      </View>
    );
  }
  const shown = gamesNeedingPlayers(games.state.data);
  if (shown.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="Games needing players" action={{ label: 'See all', onPress: openFindMatch }} />
      <FlatList
        testID="home-games-row"
        horizontal
        data={shown}
        keyExtractor={(card) => card.post_id}
        renderItem={({ item }) => <GameCard card={item} />}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        style={styles.list}
      />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  section: { gap: space.md },
  // Bleeds to the screen edge so the next card peeks in (image 01).
  list: { marginHorizontal: -space.lg },
  row: { paddingHorizontal: space.lg, gap: space.md },
  card: { width: space.xxl * 7, gap: space.xs },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm, marginTop: space.xs },
  price: { flexShrink: 1, textAlign: 'right' },
}));
