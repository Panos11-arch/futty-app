// The venue page's photos (S5; 03-venue-book-tab): swipeable, full width,
// with Back and Share over them; a tap opens them full screen. A venue with
// no photos shows its initials on a dark panel.
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton, Text } from '@/components/ui';
import { initials } from '@/components/ui/avatar';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** The photos' height as a share of the screen's width. */
const HERO_RATIO = 0.62;

export type VenueGalleryProps = {
  name: string;
  urls: string[];
  onBack: () => void;
  onShare: () => void;
  /** The "?" (S13A): opens a new Futty AI chat. */
  onHelp?: () => void;
};

export function VenueGallery({ name, urls, onBack, onShare, onHelp }: VenueGalleryProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState<number | null>(null);
  const size = { width, height: width * HERO_RATIO };

  return (
    <View style={size}>
      {urls.length === 0 ? (
        <View testID="venue-gallery-placeholder" style={[styles.placeholder, size]}>
          <Text variant="display" tone="onNightMuted">
            {initials(name)}
          </Text>
        </View>
      ) : (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} testID="venue-gallery">
          {urls.map((url, i) => (
            <Pressable
              key={url}
              testID="venue-gallery-open"
              accessibilityRole="imagebutton"
              accessibilityLabel={`Photo ${i + 1} of ${urls.length} of ${name}`}
              onPress={() => setOpen(i)}>
              <Image testID="venue-gallery-photo" source={{ uri: url }} contentFit="cover" style={size} />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <View style={[styles.overlay, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <View style={styles.round}>
          <IconButton testID="venue-back" icon="chevron.left" accessibilityLabel="Back" onPress={onBack} />
        </View>
        <View style={styles.right} pointerEvents="box-none">
          {onHelp ? (
            <View style={styles.round}>
              <IconButton testID="venue-ask-ai" icon="questionmark.circle.fill" accessibilityLabel="Ask Futty AI" onPress={onHelp} />
            </View>
          ) : null}
          <View style={styles.round}>
            <IconButton testID="venue-share" icon="square.and.arrow.up" accessibilityLabel="Share" onPress={onShare} />
          </View>
        </View>
      </View>
      {open !== null ? <PhotoViewer urls={urls} name={name} first={open} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

function PhotoViewer({ urls, name, first, onClose }: { urls: string[]; name: string; first: number; onClose: () => void }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View testID="venue-photo-viewer" style={styles.viewer}>
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: width * first, y: 0 }}>
          {urls.map((url, i) => (
            <Image
              key={url}
              source={{ uri: url }}
              contentFit="contain"
              accessibilityLabel={`Photo ${i + 1} of ${urls.length} of ${name}`}
              style={{ width, height }}
            />
          ))}
        </ScrollView>
        <View style={[styles.close, { top: insets.top + space.sm }]}>
          <View style={styles.round}>
            <IconButton icon="xmark" accessibilityLabel="Close" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  placeholder: { backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  right: { flexDirection: 'row', gap: space.sm },
  round: { backgroundColor: colors.surface, borderRadius: radius.pill },
  viewer: { flex: 1, backgroundColor: colors.night },
  close: { position: 'absolute', right: space.lg },
}));
