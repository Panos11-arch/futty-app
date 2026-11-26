// Home's "Featured event" (image 01): a dark card for the next event in
// sign-up, with Join. Until S10B an event is a league in sign-up
// (lib/featured-event.ts); leagues have no photo or price, so neither shows.
// Hidden while loading, on an error and when there is none: it is never an
// empty card.
import { router } from 'expo-router';
import { View } from 'react-native';

import { useReloadOn } from '@/components/home/refresh';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { cyprusWallTime } from '@/lib/calendar/cyprus-time';
import { type FeaturedEvent as Event, featuredEventRoute } from '@/lib/featured-event';
import { formatMatchDate } from '@/lib/match/format';
import { makeStyles } from '@/lib/theme';
import { useFeaturedEvent } from '@/lib/use-featured-event';

const KIND_LABEL: Record<Event['kind'], string> = { league: 'League · Sign-up open' };

/** "5-a-side · Sat 5 Dec": the format and the Cyprus start day. */
export function featuredEventLine(event: Event): string {
  return `${event.format} · ${formatMatchDate(cyprusWallTime(event.startDate, '12:00').toISOString())}`;
}

export function FeaturedEvent({ refreshSignal }: { refreshSignal: number }) {
  const styles = useStyles();
  const featured = useFeaturedEvent();

  useReloadOn(refreshSignal, featured.reload);

  if (featured.status !== 'ready' || !featured.event) return null;
  const event = featured.event;
  const join = () => router.push(featuredEventRoute(event));

  return (
    <View style={styles.section}>
      <SectionHeader title="Featured event" />
      <Card testID="home-featured-event" tone="night" style={styles.card}>
        <Text variant="caption" style={styles.kind}>
          {KIND_LABEL[event.kind]}
        </Text>
        <Text variant="title" tone="onNight">
          {event.name}
        </Text>
        <Text variant="callout" tone="onNightMuted" tabular>
          {featuredEventLine(event)}
        </Text>
        <View style={styles.action}>
          <Button testID="home-featured-join" label="Join" size="compact" onPress={join} accessibilityHint={event.name} />
        </View>
      </Card>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  section: { gap: space.md },
  card: { gap: space.sm },
  // Green text only on night (spec 15 section 0.2).
  kind: { color: colors.green },
  action: { flexDirection: 'row', marginTop: space.sm },
}));
