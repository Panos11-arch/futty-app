// The venue page's Facilities tab (S5): amenities, the pitches (each format
// named once) and the food and drink menu (P6e; S5A restyles it as cards).
import { Image } from 'expo-image';
import { View } from 'react-native';

import { Card, EmptyState, IconSymbol, ListRow, SectionHeader, Text } from '@/components/ui';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';
import { offerPrices } from '@/lib/post-match-offers';
import { AMENITIES, groupMenu, pitchLine, type VenuePageData } from '@/lib/venue-page';

export function VenueFacilitiesTab({ data, photoUrls }: { data: VenuePageData; photoUrls: Record<string, string> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const menu = data.menu ?? [];
  if (data.amenities.length === 0 && data.pitches.length === 0 && menu.length === 0) {
    return <EmptyState icon="checkmark.circle.fill" message="No facilities listed yet." />;
  }
  return (
    <View style={styles.tab}>
      {data.amenities.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title="Amenities" />
          <View style={styles.amenities} testID="venue-amenities">
            {data.amenities.map((a) => {
              const amenity = AMENITIES[a.kind];
              const label = a.kind === 'other' && a.note ? a.note : amenity.label;
              const note = a.kind === 'other' ? null : a.note;
              return (
                <View key={a.kind} style={styles.amenity} accessible accessibilityLabel={note ? `${label}, ${note}` : label}>
                  <IconSymbol name={amenity.icon} size={24} color={colors.ink} />
                  <Text variant="caption" style={styles.center}>
                    {label}
                  </Text>
                  {note ? (
                    <Text variant="caption" tone="inkMuted" style={styles.center}>
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
              <ListRow key={p.id} title={p.name} subtitle={pitchLine(p)} testID={`venue-pitch-${p.id}`} />
            ))}
          </Card>
        </View>
      ) : null}

      {menu.length > 0 ? (
        <View style={styles.section} testID="venue-menu">
          <SectionHeader title="Food and drink" />
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
        </View>
      ) : null}
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
  amenities: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  amenity: { width: 76, alignItems: 'center', gap: space.xs },
  center: { textAlign: 'center' },
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
