// "Where do you want to play?" (Playtomic 05): a full-screen picker. Type a
// venue or town (towns of live venues from the server), or pick a recent
// place, or browse every venue. "Around me" comes with S17.
import { useEffect, useState } from 'react';
import { FlatList, Modal, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton, ListRow, SectionHeader, Text } from '@/components/ui';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { radius, space } from '@/constants/futty-theme';
import { filterPlaces, placeLabel, type BookPlace, type PlaceVenue } from '@/lib/booking-search';
import { makeStyles, useTheme } from '@/lib/theme';

export type WherePickerProps = {
  visible: boolean;
  onClose: () => void;
  towns: string[];
  venues: PlaceVenue[];
  recents: BookPlace[];
  onPick: (place: BookPlace) => void;
  onMissingVenue: () => void;
  /** iOS: the picker has finished closing (another modal may open now). */
  onDismissed?: () => void;
};

type Row = { key: string; testID: string; title: string; icon: 'mappin.and.ellipse' | 'sportscourt.fill'; place: BookPlace };

export function WherePicker({
  visible,
  onClose,
  towns,
  venues,
  recents,
  onPick,
  onMissingVenue,
  onDismissed,
}: WherePickerProps) {
  const styles = useStyles();
  const { colors, maxFontSizeMultiplier } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const typing = text.trim().length > 0;
  const matches = filterPlaces(text, towns, venues);
  const rows: Row[] = [
    ...matches.towns.map((town) => ({
      key: `town:${town}`,
      testID: `book-where-town-${town}`,
      title: town,
      icon: 'mappin.and.ellipse' as const,
      place: { kind: 'town' as const, town },
    })),
    ...matches.venues.map((v) => ({
      key: `venue:${v.id}`,
      testID: `book-where-venue-${v.id}`,
      title: v.name,
      icon: 'sportscourt.fill' as const,
      place: { kind: 'venue' as const, venueId: v.id, name: v.name },
    })),
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      onDismiss={onDismissed}>
      <View style={[styles.screen, { paddingTop: insets.top + space.md, paddingBottom: insets.bottom }]}>
        <View style={styles.header}>
          <Text variant="title" accessibilityRole="header" style={styles.title}>
            Where do you want to play?
          </Text>
          <IconButton testID="book-where-close" icon="xmark" accessibilityLabel="Close" onPress={onClose} />
        </View>
        <TextInput
          testID="book-where-input"
          accessibilityLabel="Venue or town"
          placeholder="Venue or town"
          placeholderTextColor={colors.inkMuted}
          maxFontSizeMultiplier={maxFontSizeMultiplier}
          value={text}
          onChangeText={setText}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {typing ? (
          rows.length > 0 ? (
            <FlatList
              data={rows}
              keyExtractor={(r) => r.key}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <ListRow
                  testID={item.testID}
                  title={item.title}
                  leading={{ icon: item.icon }}
                  onPress={() => onPick(item.place)}
                />
              )}
            />
          ) : (
            <View style={styles.none}>
              <Text variant="headline">No venues found</Text>
              <Button
                testID="book-where-missing-venue"
                label="Missing a venue?"
                variant="secondary"
                onPress={onMissingVenue}
              />
            </View>
          )
        ) : (
          <View>
            <ListRow
              testID="book-where-all"
              title="Browse all venues"
              leading={{ icon: 'building.2.fill' }}
              chevron
              onPress={() => onPick({ kind: 'all' })}
            />
            {recents.length > 0 ? (
              <View style={styles.recent}>
                <SectionHeader title="Recent" />
                {recents.map((place, i) => (
                  <ListRow
                    key={placeLabel(place) + i}
                    testID={`book-where-recent-${i}`}
                    title={placeLabel(place)}
                    leading={{ icon: 'clock.fill' }}
                    chevron
                    onPress={() => onPick(place)}
                  />
                ))}
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  screen: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: space.lg, gap: space.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  title: { flex: 1 },
  input: {
    ...type.body,
    minHeight: MIN_TOUCH,
    borderRadius: radius.control,
    backgroundColor: colors.fill,
    paddingHorizontal: space.lg,
    color: colors.ink,
  },
  none: { alignItems: 'flex-start', gap: space.md, paddingTop: space.md },
  recent: { paddingTop: space.lg },
}));
