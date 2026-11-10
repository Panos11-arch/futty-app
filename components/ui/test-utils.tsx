// Shared Jest helpers for components/ui tests. Not used by the app.
import {
  StyleSheet,
  unstable_batchedUpdates,
  type ImageStyle,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

type AnyStyle = ViewStyle & TextStyle & ImageStyle;

/** The flattened style of a host element, for asserting on tokens. */
export function flatStyle(element: { props: { style?: unknown } }): AnyStyle {
  return (StyleSheet.flatten(element.props.style as StyleProp<AnyStyle>) ?? {}) as AnyStyle;
}

/**
 * Load heavy modules when the test file loads, not in the first test.
 *
 * babel-preset-expo's lazy imports load a module on first use, which in a
 * component test is the first render, inside the first test's 5 s timeout.
 * On a cold transform cache (every CI run) that first render can cost more
 * than the whole budget: React Native's Modal takes ~10 s to transform and
 * load, expo-image ~3 s, and the first Animated or native view pulls in
 * React Native's renderer (ReactNativeRenderer-dev, over 1 MB, ~5 s).
 * Call this at the top of a test file with the heavy imports; it also loads
 * the renderer. File loading has no timeout.
 */
export function loadWithFile(...modules: unknown[]) {
  modules.forEach((m, i) => {
    if (m == null) throw new Error(`loadWithFile: module ${i} did not load`);
  });
  // A no-op batch makes React Native require its renderer now.
  unstable_batchedUpdates(() => {});
}

/**
 * Stand-in for components/ui/icon-symbol, for jest.mock. The first render of
 * the real native SymbolView pulls in ~110 React Native files, about 5 s on a
 * cold cache, inside whichever test renders an icon first. Icons are
 * decorative (labels live on the buttons), so tests draw a plain View tagged
 * with the icon's name:
 *
 *   jest.mock('@/components/ui/icon-symbol', () =>
 *     jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
 *   );
 */
export function iconSymbolMock() {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { IconSymbol: ({ name }: { name: string }) => <View testID={`icon-${name}`} /> };
}
