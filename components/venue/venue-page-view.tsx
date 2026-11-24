// The venue page (S5; docs/specs/15-design.md section 0.6, image
// 03-venue-book-tab): swipeable photos with Back and Share, a card with the
// name, area and amenities and Directions · Website · Call, then three tabs,
// Home | Book | Facilities. On Book a sticky bar shows the choice and
// Continue, which opens Booking v2's payment sheet (the screen owns it).
// Takes every state as props so each can be tested; the screen
// (app/venue/[id].tsx) loads them.
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Card, EmptyState, SkeletonBlock, SkeletonText, Text } from '@/components/ui';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { VenueBookTab, chosenPitch, type VenueBookProps } from '@/components/venue/venue-book-tab';
import { VenueFacilitiesTab } from '@/components/venue/venue-facilities-tab';
import { VenueGallery } from '@/components/venue/venue-gallery';
import { VenueHomeTab, type VenueHomeProps } from '@/components/venue/venue-home-tab';
import { hairline, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { VenuePageState } from '@/lib/use-venue-page';
import { continueLine } from '@/lib/venue-book';
import { phoneUrl, venueCardLine, websiteUrl, type VenueTab } from '@/lib/venue-page';

export type VenuePageViewProps = {
  state: VenuePageState;
  tab: VenueTab;
  onTabChange: (tab: VenueTab) => void;
  onRetry: () => void;
  onBack: () => void;
  onShare: () => void;
  onDirections: () => void;
  /** Website and Call: a web address or a tel: link. */
  onOpenUrl: (url: string) => void;
  home: VenueHomeProps;
  book: VenueBookProps;
};

const TABS: { tab: VenueTab; label: string }[] = [
  { tab: 'home', label: 'Home' },
  { tab: 'book', label: 'Book' },
  { tab: 'facilities', label: 'Facilities' },
];

export function VenuePageView(props: VenuePageViewProps) {
  const styles = useStyles();
  const { state, tab, onTabChange, onOpenUrl, book } = props;
  if (state.status === 'loading') return <VenuePageSkeleton />;
  if (state.status === 'not_found') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="building.2.fill" message="This venue isn't on Futty" action={{ label: 'Go back', onPress: props.onBack }} />
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={[styles.screen, styles.padded]}>
        <Banner tone="danger" message="Could not load this venue." action={{ label: 'Try again', onPress: props.onRetry }} />
      </View>
    );
  }

  const { data, photoUrls } = state;
  const { venue } = data;
  const line = venueCardLine(venue, data.amenities);
  const website = websiteUrl(venue.website);
  const call = phoneUrl(venue.phone);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} testID="venue-page">
        <VenueGallery
          name={venue.name}
          urls={data.photos.map((p) => photoUrls[p.storage_path]).filter(Boolean)}
          onBack={props.onBack}
          onShare={props.onShare}
        />

        <View style={styles.cardWrap}>
          <Card>
            <View style={styles.card}>
              <Text variant="title" accessibilityRole="header">
                {venue.name}
              </Text>
              {line ? (
                <Text variant="callout" tone="inkMuted">
                  {line}
                </Text>
              ) : null}
              <View style={styles.actions}>
                <View style={styles.action}>
                  <Button testID="venue-directions" label="Directions" variant="secondary" size="compact" onPress={props.onDirections} fullWidth />
                </View>
                {website ? (
                  <View style={styles.action}>
                    <Button testID="venue-website" label="Website" variant="secondary" size="compact" onPress={() => onOpenUrl(website)} fullWidth />
                  </View>
                ) : null}
                {call ? (
                  <View style={styles.action}>
                    <Button testID="venue-call" label="Call" variant="secondary" size="compact" onPress={() => onOpenUrl(call)} fullWidth />
                  </View>
                ) : null}
              </View>
            </View>
          </Card>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          {TABS.map((t) => {
            const selected = t.tab === tab;
            return (
              <Pressable
                key={t.tab}
                testID={`venue-tab-${t.tab}`}
                accessibilityRole="tab"
                accessibilityLabel={t.label}
                accessibilityState={{ selected }}
                onPress={() => onTabChange(t.tab)}
                style={[styles.tab, selected && styles.tabSelected]}>
                <Text variant="headline" tone={selected ? 'ink' : 'inkMuted'}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.body}>
          {tab === 'home' ? (
            <VenueHomeTab data={data} photoUrls={photoUrls} home={props.home} onBookTab={() => onTabChange('book')} />
          ) : null}
          {tab === 'book' ? <VenueBookTab book={book} allowsSixOnFive={venue.allows_6v6_on_5s === true} /> : null}
          {tab === 'facilities' ? <VenueFacilitiesTab data={data} photoUrls={photoUrls} /> : null}
        </View>
      </ScrollView>

      {tab === 'book' ? <ContinueBar bookable={data.bookable} book={book} /> : null}
    </View>
  );
}

function ContinueBar({ bookable, book }: { bookable: boolean; book: VenueBookProps }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const pitch = chosenPitch(book);
  const { selection } = book;
  const summary = selection.start && selection.format ? continueLine(selection.day, selection.start, pitch?.label ?? null, selection.format) : null;
  const canContinue = bookable && pitch !== null && !book.debtMessage;
  return (
    <View testID="venue-continue-bar" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      {summary ? (
        <View style={styles.summary}>
          <Text variant="headline" tabular numberOfLines={1}>
            {summary.title}
          </Text>
          <Text variant="callout" tone="inkMuted" numberOfLines={1}>
            {summary.subtitle}
          </Text>
        </View>
      ) : null}
      <View style={summary ? undefined : styles.summary}>
        <Button
          testID="venue-book"
          label={bookable ? 'Continue' : 'Not taking bookings yet'}
          disabled={!canContinue}
          onPress={() => {
            if (canContinue && pitch) book.onContinue(pitch.pitch_ids.join(','));
          }}
          fullWidth={!summary}
        />
      </View>
    </View>
  );
}

function VenuePageSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.screen} testID="venue-page-loading">
      <SkeletonBlock width="100%" height={240} rounded="control" />
      <View style={[styles.padded, styles.skeleton]}>
        <SkeletonText lines={2} variant="title" />
        <SkeletonBlock width="100%" height={MIN_TOUCH} rounded="control" />
        <SkeletonText lines={3} />
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  padded: { padding: space.lg },
  skeleton: { gap: space.lg },
  content: { paddingBottom: space.xxl },
  cardWrap: { marginTop: -space.xxl, paddingHorizontal: space.lg },
  card: { gap: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  action: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: space.lg,
    marginTop: space.lg,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: space.xs - 1,
    borderBottomColor: 'transparent',
  },
  tabSelected: { borderBottomColor: colors.green },
  body: { padding: space.lg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.surface,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  summary: { flex: 1 },
}));
