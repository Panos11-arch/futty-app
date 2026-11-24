// The venue page's Facilities tab (S5, S5A): Food & drink as photo cards
// (photo, name, price; an offer price with the normal one struck through and
// "After game" for post-match offers), with See all opening the whole menu by
// category; then the pitches, each format named once. The amenities are
// icons under the page's card, on every tab. Each part is hidden when the
// venue hasn't entered it.
import { Image } from 'expo-image';
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { Button, Card, EmptyState, ListRow, SectionHeader, Sheet, Text } from '@/components/ui';
import { FoodCards } from '@/components/venue/venue-extras';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { offerPrices } from '@/lib/post-match-offers';
import { foodCard } from '@/lib/venue-extras';
import { groupMenu, pitchLine, type VenuePageData } from '@/lib/venue-page';

/** How many food and drink cards the tab shows before See all. */
const FOOD_CARDS = 6;
/** How much of the screen the full menu may fill before it scrolls. */
const MENU_SHARE = 0.6;

export function VenueFacilitiesTab({ data, photoUrls }: { data: VenuePageData; photoUrls: Record<string, string> }) {
  const styles = useStyles();
  const { height } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = data.menu ?? [];
  if (data.pitches.length === 0 && menu.length === 0) {
    return <EmptyState icon="checkmark.circle.fill" message="No facilities listed yet." />;
  }
  const cards = menu
    .slice(0, FOOD_CARDS)
    .map((item) => foodCard(item, item.photo_path ? (photoUrls[item.photo_path] ?? null) : null));

  return (
    <View style={styles.tab}>
      {menu.length > 0 ? (
        <View style={styles.section} testID="venue-menu">
          <View style={styles.header}>
            <Text variant="headline" accessibilityRole="header" style={styles.flex}>
              Food & drink
            </Text>
            <Button testID="venue-menu-see-all" label="See all" variant="plain" size="compact" onPress={() => setMenuOpen(true)} />
          </View>
          <FoodCards testID="venue-food" cards={cards} />
        </View>
      ) : null}

      {data.pitches.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Pitches" />
          <Card padded={false}>
            {data.pitches.map((p) => (
              <ListRow key={p.id} title={p.name} subtitle={pitchLine(p)} testID={`venue-pitch-${p.id}`} />
            ))}
          </Card>
        </View>
      ) : null}

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Food & drink">
        <ScrollView style={{ maxHeight: height * MENU_SHARE }} contentContainerStyle={styles.menu}>
          {groupMenu(menu).map((group) => (
            <View key={group.title ?? 'items'} style={styles.menuGroup}>
              {group.title ? (
                <Text variant="headline" accessibilityRole="header">
                  {group.title}
                </Text>
              ) : null}
              <Card padded={false}>
                {group.items.map((item) => (
                  <MenuRow key={item.id} item={item} photoUrl={item.photo_path ? photoUrls[item.photo_path] : undefined} />
                ))}
              </Card>
            </View>
          ))}
        </ScrollView>
      </Sheet>
    </View>
  );
}

/** One food or drink item: the offer price with the normal price struck
 *  through when both exist and differ (as A8 shows offers); both from the server. */
function MenuRow({ item, photoUrl }: { item: VenuePageData['menu'][number]; photoUrl?: string }) {
  const styles = useStyles();
  const prices = offerPrices(item);
  const details = [item.description, item.dietary_tags?.length ? item.dietary_tags.join(' · ') : null].filter(Boolean);
  return (
    <View style={styles.menuRow} testID={`venue-menu-${item.id}`}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} contentFit="cover" accessibilityLabel={item.name} style={styles.menuPhoto} />
      ) : null}
      <View style={styles.flex}>
        <Text variant="body">{item.name}</Text>
        {item.offer_text ? <Text variant="callout">{item.offer_text}</Text> : null}
        {details.map((line) => (
          <Text key={line} variant="caption" tone="inkMuted">
            {line}
          </Text>
        ))}
      </View>
      {prices.now ? (
        <View style={styles.menuPrices}>
          {prices.was ? (
            <Text variant="callout" tone="inkMuted" tabular style={styles.struck} accessibilityLabel={`was ${prices.was}`}>
              {prices.was}
            </Text>
          ) : null}
          <Text variant="body" tabular>
            {prices.now}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  tab: { gap: space.xl },
  section: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  menu: { gap: space.md, paddingBottom: space.md },
  menuGroup: { gap: space.sm },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  menuPhoto: { width: space.xxl * 2, height: space.xxl * 2, borderRadius: radius.control },
  menuPrices: { alignItems: 'flex-end' },
  struck: { textDecorationLine: 'line-through' },
  flex: { flex: 1 },
}));
