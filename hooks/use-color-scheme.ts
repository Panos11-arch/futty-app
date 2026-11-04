import { useColorScheme as useRNColorScheme } from 'react-native';

/** React Native's scheme can also be 'unspecified' (newer RN versions) or
 *  null — collapse both to 'light' so callers can index light/dark maps. */
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
