// The venue page's Home tab (S5): opening hours, offers, top players and
// recent results, each hidden when empty. The map and the weather are S17:
// their places stay empty until then.
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { Banner, Card, EmptyState, ListRow, SectionHeader, SkeletonBlock, Text } from '@/components/ui';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { LoadState } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import type { VenueHighlights, VenueResult } from '@/lib/venue-highlights';
import { offerWhen, openingHours, type VenuePageData } from '@/lib/venue-page';

export type VenueHomeProps = {
  highlights: LoadState<VenueHighlights>;
  onRetry: () => void;
  onPlayer: (profileId: string) => void;
  onTeam: (teamId: string) => void;
};

export function VenueHomeTab({
  data,
  photoUrls,
  home,
  onBookTab,
}: {
  data: VenuePageData;
  photoUrls: Record<string, string>;
  home: VenueHomeProps;
  onBookTab: () => void;
}) {
  const styles = useStyles();
  const hours = openingHours(data.hours);
  const { highlights } = home;
  const h = highlights.status === 'ready' ? highlights.data : null;
  const empty =
    hours.length === 0 && data.offers.length === 0 && h !== null && h.topPlayers.length === 0 && h.results.length === 0;

  if (empty) {
    return <EmptyState icon="building.2.fill" message="Nothing here yet." action={{ label: 'Book a time', onPress: onBookTab }} />;
  }

  return (
    <View style={styles.tab}>
      {hours.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Opening hours" />
          <Card padded={false} testID="venue-hours">
            {hours.map((row) => (
              <ListRow key={row.day} title={row.day} trailing={<Text variant="body" tabular>{row.hours}</Text>} />
            ))}
          </Card>
        </View>
      ) : null}

      {data.offers.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="After the game" />
          {data.offers.map((o) => (
            <Offer key={o.id} offer={o} photoUrl={o.photo_path ? photoUrls[o.photo_path] : undefined} />
          ))}
        </View>
      ) : null}

      {highlights.status === 'loading' ? (
        <View testID="venue-highlights-loading" style={styles.section}>
          <SkeletonBlock width="100%" height={space.xxl * 3} />
        </View>
      ) : null}
      {highlights.status === 'error' ? (
        <View testID="venue-highlights-error">
          <Banner tone="danger" message={highlights.message} action={{ label: 'Try again', onPress: home.onRetry }} />
        </View>
      ) : null}

      {h && h.topPlayers.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Top players" />
          <Card padded={false}>
            {h.topPlayers.map((p) => (
              <ListRow
                key={p.profileId}
                testID={`venue-top-player-${p.profileId}`}
                leading={{ avatar: { name: p.name, kit: p.kit } }}
                title={p.name}
                trailing={
                  <Text variant="headline" tabular>
                    {p.rating}
                  </Text>
                }
                onPress={() => home.onPlayer(p.profileId)}
              />
            ))}
          </Card>
        </View>
      ) : null}

      {h && h.results.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Recent results" />
          <Card padded={false}>
            {h.results.map((r) => (
              <ResultRow key={r.matchId} result={r} onTeam={home.onTeam} />
            ))}
          </Card>
        </View>
      ) : null}
    </View>
  );
}

function ResultRow({ result, onTeam }: { result: VenueResult; onTeam: (teamId: string) => void }) {
  const styles = useStyles();
  const [a, b] = result.sides;
  const side = (s: VenueResult['sides'][number], align: 'left' | 'right') => {
    const label = (
      <Text variant="body" numberOfLines={1} style={{ textAlign: align }}>
        {s.label}
      </Text>
    );
    return s.teamId ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={s.label}
        onPress={() => onTeam(s.teamId!)}
        style={styles.team}>
        {label}
      </Pressable>
    ) : (
      <View style={styles.team}>{label}</View>
    );
  };
  return (
    <View testID={`venue-result-${result.matchId}`} style={styles.result}>
      <Text variant="caption" tone="inkMuted">
        {result.day}
      </Text>
      <View style={styles.resultLine}>
        {side(a, 'right')}
        <Text variant="headline" tabular>
          {`${a.score} – ${b.score}`}
        </Text>
        {side(b, 'left')}
      </View>
    </View>
  );
}

function Offer({ offer, photoUrl }: { offer: VenuePageData['offers'][number]; photoUrl?: string }) {
  const styles = useStyles();
  const price = offer.offer_price_cents ?? offer.price_cents;
  const when = offerWhen(offer);
  return (
    <Card padded={false} testID={`venue-offer-${offer.id}`}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} contentFit="cover" accessibilityLabel={offer.name} style={styles.offerPhoto} />
      ) : null}
      <View style={styles.offerBody}>
        <View style={styles.offerTitle}>
          <Text variant="headline" style={styles.flex}>
            {offer.name}
          </Text>
          {price !== null ? (
            <Text variant="body" tabular>
              {formatEuros(price)}
            </Text>
          ) : null}
        </View>
        {offer.offer_text ? <Text variant="callout">{offer.offer_text}</Text> : null}
        {when ? (
          <Text variant="caption" tone="inkMuted">
            {when}
          </Text>
        ) : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  tab: { gap: space.xl },
  section: { gap: space.md },
  result: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.xs },
  resultLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  team: { flex: 1, minHeight: MIN_TOUCH, justifyContent: 'center' },
  offerPhoto: { width: '100%', aspectRatio: 16 / 9, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  offerBody: { padding: space.lg, gap: space.xs },
  offerTitle: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  flex: { flex: 1 },
}));
