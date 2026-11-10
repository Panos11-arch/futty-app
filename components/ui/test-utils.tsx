// Shared Jest helpers for components/ui tests. Not used by the app.
import { StyleSheet, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

type AnyStyle = ViewStyle & TextStyle & ImageStyle;

/** The flattened style of a host element, for asserting on tokens. */
export function flatStyle(element: { props: { style?: unknown } }): AnyStyle {
  return (StyleSheet.flatten(element.props.style as StyleProp<AnyStyle>) ?? {}) as AnyStyle;
}
