// S17: the venue on a map, on its page's Home tab (spec 15 section 0.6). A
// still map with one pin; a tap on it opens Directions, as the button does.
// Shown only when the venue has coordinates.
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { radius } from '@/constants/futty-theme';
import { mapRegion, type Coordinates } from '@/lib/venue-location';

/** A wide, short map: enough to see where the venue is. */
const ASPECT = 2;

export function VenueMiniMap({ name, at, onPress }: { name: string; at: Coordinates; onPress: () => void }) {
  return (
    <View style={styles.frame} accessible accessibilityRole="button" accessibilityLabel={`Directions to ${name}`} onAccessibilityTap={onPress}>
      <MapView
        testID="venue-map"
        style={StyleSheet.absoluteFill}
        initialRegion={mapRegion([at])}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        onPress={onPress}>
        <Marker testID="venue-map-pin" coordinate={at} title={name} onPress={onPress} />
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', aspectRatio: ASPECT, borderRadius: radius.card, overflow: 'hidden' },
});
