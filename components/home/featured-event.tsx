// Home's "Featured event" (image 01): a dark card for the event
// lib/featured-event.ts picks. A tournament (S10B) shows its team count,
// format and entry fee (the server's cents, shown only), with "Coming soon"
// until sign-up opens and "Join" after; a league shows its format and start
// day, with Join. Both go through featuredEventRoute. Hidden while loading,
// on an error and when there is none: it is never an empty card.
import { router } from 'expo-router';
import { View } from 'react-native';

import { useReloadOn } from '@/components/home/refresh';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { cyprusWallTime } from '@/lib/calendar/cyprus-time';
import { type FeaturedEvent as Event, featuredEventRoute } from '@/lib/featured-event';
import { formatMatchDate } from '@/lib/match/format';
import { entryFeeAmount } from '@/lib/match/tournament-api';
import { makeStyles } from '@/lib/theme';
import { useFeaturedEvent } from '@/lib/use-featured-event';

function kindLabel(event: Event): string {
  if (event.kind === 'league') return 'League · Sign-up open';
  return event.comingSoon ? 'Tournament · Coming soon' : 'Tournament · Sign-up open';
}

/** A league: "5-a-side · Sat 5 Dec", the format and the Cyprus start day.
 *  A tournament: "16 teams · 5-a-side · €12 per player", without the fee
 *  when there is none. */
export function featuredEventLine(event: Event): string {
  if (event.kind === 'tournament') {
    const parts = [`${event.maxTeams} teams`, event.format];
    if (event.entryFeeCents > 0) parts.push(entryFeeAmount(event.entryFeeCents));
    return parts.join(' · ');
  }
  return `${event.format} · ${formatMatchDate(cyprusWallTime(event.startDate, '12:00').toISOString())}`;
}

export function FeaturedEvent({ refreshSignal }: { refreshSignal: number }) {
  const styles = useStyles();
  const featured = useFeaturedEvent();

  useReloadOn(refreshSignal, featured.reload);

  if (featured.status !== 'ready' || !featured.event) return null;
  const event = featured.event;
  const open = () => router.push(featuredEventRoute(event));
  const comingSoon = event.kind === 'tournament' && event.comingSoon;

  return (
    <View style={styles.section}>
      <SectionHeader title="Featured event" />
      <Card testID="home-featured-event" tone="night" style={styles.card}>
        <Text variant="caption" style={styles.kind}>
          {kindLabel(event)}
        </Text>
        <Text variant="title" tone="onNight">
          {event.name}
        </Text>
        <Text variant="callout" tone="onNightMuted" tabular>
          {featuredEventLine(event)}
        </Text>
        <View style={styles.action}>
          {comingSoon ? (
            // Image 01: an outline on night, not the green main action.
            <View style={styles.outline}>
              <Button
                testID="home-featured-coming-soon"
                label="Coming soon"
                variant="dark"
                size="compact"
                onPress={open}
                accessibilityHint={event.name}
              />
            </View>
          ) : (
            <Button testID="home-featured-join" label="Join" size="compact" onPress={open} accessibilityHint={event.name} />
          )}
        </View>
      </Card>
    </View>
  );
}

const useStyles = makeStyles(({ colors, hairline }) => ({
  section: { gap: space.md },
  card: { gap: space.sm },
  // Green text only on night (spec 15 section 0.2).
  kind: { color: colors.green },
  action: { flexDirection: 'row', marginTop: space.sm },
  outline: { borderWidth: hairline * 2, borderColor: colors.onNightMuted, borderRadius: radius.chip },
}));
