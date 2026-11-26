// What screen readers hear for the tab bar and the back button (QA 24
// November, bugs 6 and 7). Hidden routes (play, team, leagues) live in the
// tab navigator without a place on the bar, so they're never counted.
import type { Platform } from 'react-native';

/** The items on the bar, in order (S2, docs/specs/15-design.md section 0.5).
 *  "card" is the Card button in the middle: not a route, it opens a sheet. */
export const VISIBLE_TABS = [
  { name: 'index', title: 'Home' },
  { name: 'community', title: 'Community' },
  { name: 'card', title: 'My card' },
  { name: 'rankings', title: 'Rankings' },
  { name: 'profile', title: 'Profile' },
] as const;

export type BarItemName = (typeof VISIBLE_TABS)[number]['name'];

/** VoiceOver: "Home, tab, 1 of 5", counting only the items on the bar (by
 *  default the hidden routes were counted). TalkBack: the name alone, as it
 *  adds the role itself (by default it read ", Profile"). */
export function tabAccessibilityLabel(title: string, index: number, os: typeof Platform.OS): string {
  return os === 'ios' ? `${title}, tab, ${index + 1} of ${VISIBLE_TABS.length}` : title;
}

/** The title of the tabs screen as a pushed screen's back button reads it:
 *  the tab it goes back to, never the route group's name "(tabs)". The
 *  hidden team route redirects to Play; leagues is its own screen (S9). */
export function tabsBackTitle(focusedRoute: string | undefined): string {
  if (focusedRoute === 'play' || focusedRoute === 'team') return 'Play';
  if (focusedRoute === 'leagues') return 'Leagues';
  if (focusedRoute === 'community') return 'Community';
  if (focusedRoute === 'rankings') return 'Rankings';
  if (focusedRoute === 'profile') return 'Profile';
  return 'Home';
}
