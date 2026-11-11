// The venue page (docs/specs/15-design.md section 5): photo gallery, name,
// address with Directions, amenities, pitches, prices, cancellation rules,
// a slot for the weather strip (P11), offers, and a sticky "Book" bar.
// Takes the page state as props so every state can be tested; the screen
// (app/venue/[id].tsx) loads it.
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  IconSymbol,
  ListRow,
  SectionHeader,
  SkeletonBlock,
  SkeletonText,
  StickyActionBar,
  Text,
} from '@/components/ui';
import { initials } from '@/components/ui/avatar';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
import { formatEuros } from '@/lib/money/format';
import type { VenuePageState } from '@/lib/use-venue-page';
import { AMENITIES, cancellationLines, offerWhen, pitchSummary, type VenuePageData } from '@/lib/venue-page';

export type VenuePageViewProps = {
  state: VenuePageState;
  onRetry: () => void;
  onDirections: () => void;
  onBook: () => void;
};

export function VenuePageView({ state, onRetry, onDirections, onBook }: VenuePageViewProps) {
  if (state.status === 'loading') return <VenuePageSkeleton />;
  if (state.status === 'not_found') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="building.2.fill" message="This venue isn't on Futty" />
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={[styles.screen, styles.padded]}>
        <Banner tone="danger" message="Couldn't load this venue." action={{ label: 'Try again', onPress: onRetry }} />
      </View>
    );
  }

  const { data, photoUrls } = state;
  const { venue } = data;
  const area = [venue.address, venue.city].filter(Boolean).join(', ');

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} testID="venue-page">
        <Gallery name={venue.name} urls={data.photos.map((p) => photoUrls[p.storage_path]).filter(Boolean)} />

        <View style={styles.section}>
          <Text variant="title" accessibilityRole="header">
            {venue.name}
          </Text>
          {area ? (
            <Text variant="body" tone="inkMuted">
              {area}
            </Text>
          ) : null}
          <View style={styles.directions}>
            <Button label="Directions" variant="secondary" onPress={onDirections} />
          </View>
        </View>

        {data.amenities.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Amenities" />
            <View style={styles.amenities} testID="venue-amenities">
              {data.amenities.map((a) => {
                const amenity = AMENITIES[a.kind];
                const label = a.kind === 'other' && a.note ? a.note : amenity.label;
                const note = a.kind === 'other' ? null : a.note;
                return (
                  <View
                    key={a.kind}
                    style={styles.amenity}
                    accessible
                    accessibilityLabel={note ? `${label}, ${note}` : label}>
                    <IconSymbol name={amenity.icon} size={24} color={colors.ink} />
                    <Text variant="caption" style={styles.amenityLabel}>
                      {label}
                    </Text>
                    {note ? (
                      <Text variant="caption" tone="inkMuted" style={styles.amenityLabel}>
                        {note}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {data.pitches.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Pitches" />
            <Card padded={false}>
              {data.pitches.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.name}
                  subtitle={[pitchSummary(p), p.formats.join(', '), p.is_open ? null : 'Closed'].filter(Boolean).join(' · ')}
                  testID={`venue-pitch-${p.id}`}
                />
              ))}
            </Card>
          </View>
        ) : null}

        {data.prices.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="Prices" />
            <Card padded={false}>
              {data.prices.map((p) => (
                <ListRow
                  key={p.format}
                  title={p.format}
                  subtitle={priceExtras(p)}
                  trailing={
                    <Text variant="body" tabular>
                      {`${formatEuros(p.hour_cents)} per hour`}
                    </Text>
                  }
                />
              ))}
            </Card>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader title="Cancellation" />
          <Card>
            <View style={styles.rules}>
              {cancellationLines(data.cancellation).map((rule) => (
                <Text key={rule} variant="callout">
                  {rule}
                </Text>
              ))}
            </View>
          </Card>
        </View>

        {/* P11 puts the forecast here (05 Product section 14). */}
        <View testID="weather-strip-slot" />

        {data.offers.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader title="After the game" />
            <View style={styles.offers}>
              {data.offers.map((o) => (
                <Offer key={o.id} offer={o} photoUrl={o.photo_path ? photoUrls[o.photo_path] : undefined} />
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <StickyActionBar
        actionLabel={data.bookable ? 'Book' : 'Not taking bookings yet'}
        onPress={onBook}
        disabled={!data.bookable}
      />
    </View>
  );
}

function priceExtras(p: VenuePageData['prices'][number]): string | undefined {
  const extras = [
    p.peak_hour_cents !== null ? `Peak ${formatEuros(p.peak_hour_cents)}` : null,
    p.weekend_hour_cents !== null ? `Weekend ${formatEuros(p.weekend_hour_cents)}` : null,
  ].filter(Boolean);
  return extras.length > 0 ? extras.join(' · ') : undefined;
}

function Gallery({ name, urls }: { name: string; urls: string[] }) {
  const { width } = useWindowDimensions();
  const photoWidth = width - space.lg * 2;
  const size = { width: photoWidth, height: (photoWidth * 3) / 4 };
  if (urls.length === 0) {
    return (
      <View testID="venue-gallery-placeholder" style={[styles.photo, styles.placeholder, size]}>
        <Text variant="display" tone="inkMuted">
          {initials(name)}
        </Text>
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={photoWidth + space.md}
      decelerationRate="fast"
      contentContainerStyle={styles.gallery}
      testID="venue-gallery">
      {urls.map((url, i) => (
        <Image
          key={url}
          testID="venue-gallery-photo"
          source={{ uri: url }}
          contentFit="cover"
          accessibilityLabel={`Photo ${i + 1} of ${urls.length} of ${name}`}
          style={[styles.photo, size]}
        />
      ))}
    </ScrollView>
  );
}

function Offer({ offer, photoUrl }: { offer: VenuePageData['offers'][number]; photoUrl?: string }) {
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

function VenuePageSkeleton() {
  return (
    <View style={[styles.screen, styles.padded]} testID="venue-page-loading">
      <SkeletonBlock width="100%" height={240} />
      <View style={styles.section}>
        <SkeletonText lines={2} variant="title" />
        <SkeletonBlock width={140} height={44} rounded="control" />
      </View>
      <View style={styles.section}>
        <SkeletonText lines={3} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  padded: { padding: space.lg },
  content: { paddingVertical: space.lg, gap: space.xl },
  section: { paddingHorizontal: space.lg, gap: space.md },
  gallery: { paddingHorizontal: space.lg, gap: space.md },
  photo: { borderRadius: radius.card },
  // Spec 15: a neutral canvas block with the initials; the hairline keeps it visible on the canvas screen.
  placeholder: {
    marginHorizontal: space.lg,
    backgroundColor: colors.canvas,
    borderWidth: hairline,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directions: { alignSelf: 'flex-start' },
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  amenity: { width: 76, alignItems: 'center', gap: space.xs },
  amenityLabel: { textAlign: 'center' },
  rules: { gap: space.sm },
  offers: { gap: space.md },
  offerPhoto: { width: '100%', aspectRatio: 16 / 9, borderTopLeftRadius: radius.card, borderTopRightRadius: radius.card },
  offerBody: { padding: space.lg, gap: space.xs },
  offerTitle: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  flex: { flex: 1 },
});
