/**
 * Themed styles: the one pattern for styles that use colours or type.
 *
 *   const useStyles = makeStyles(({ colors, type }) => ({
 *     card: { backgroundColor: colors.surface },
 *     title: { ...type.headline, color: colors.ink },
 *   }));
 *
 *   function Thing() {
 *     const styles = useStyles();
 *     ...
 *   }
 *
 * The sheet is built once per theme and reused, so switching Appearance or
 * text size restyles every screen without rebuilding styles on each render.
 */
import { StyleSheet } from 'react-native';

import type { Theme } from '@/lib/theme/build-theme';
import { useTheme } from '@/lib/theme/theme-provider';

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (theme: Theme) => T & StyleSheet.NamedStyles<any>,
): () => T {
  const cache = new WeakMap<Theme, T>();
  return function useStyles(): T {
    const theme = useTheme();
    let styles = cache.get(theme);
    if (!styles) {
      styles = StyleSheet.create(factory(theme));
      cache.set(theme, styles);
    }
    return styles;
  };
}
