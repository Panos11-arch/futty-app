// Test-only: react-native-maps as plain Views, so Jest can render a map,
// find its pins and press them. jest.config.js maps 'react-native-maps' here
// for every test (it has no native module under Jest). The map's region is
// put in its accessibilityHint so a test can read where it looks.
import { createElement, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

type MapProps = { testID?: string; children?: ReactNode; onPress?: () => void; initialRegion?: unknown; region?: unknown };
type MarkerProps = { testID?: string; children?: ReactNode; onPress?: () => void; title?: string; coordinate: unknown };

function MapView({ testID, children, onPress, initialRegion, region }: MapProps) {
  return createElement(
    Pressable,
    { testID, onPress, accessibilityHint: JSON.stringify(region ?? initialRegion ?? null) },
    children,
  );
}

export function Marker({ testID, children, onPress, title }: MarkerProps) {
  return createElement(Pressable, { testID, onPress, accessibilityLabel: title }, children ?? createElement(View));
}

export const PROVIDER_DEFAULT = undefined;
export default MapView;
