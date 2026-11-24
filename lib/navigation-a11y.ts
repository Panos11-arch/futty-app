// What screen readers hear for the tab bar and the back button (QA 24
// November, bugs 6 and 7). Hidden routes (team, leagues, community) live in
// the tab navigator only to redirect old links, so they're never counted.
import type { Platform } from 'react-native';

/** The tabs on the bar, in order (docs/specs/15-design.md section 4). */
export const VISIBLE_TABS = [
  { name: 'index', title: 'Home' },
  { name: 'book', title: 'Book' },
  { name: 'play', title: 'Play' },
  { name: 'profile', title: 'Profile' },
] as const;

/** VoiceOver: "Home, tab, 1 of 4", counting only the tabs on the bar (by
 *  default the hidden routes were counted: "1 of 7"). TalkBack: the name
 *  alone, as it adds the role itself (by default it read ", Profile"). */
export function tabAccessibilityLabel(title: string, index: number, os: typeof Platform.OS): string {
  return os === 'ios' ? `${title}, tab, ${index + 1} of ${VISIBLE_TABS.length}` : title;
}

/** The title of the tabs screen as a pushed screen's back button reads it:
 *  the tab it goes back to, never the route group's name "(tabs)". The
 *  hidden routes redirect to Play; Book opens a pushed screen over Home. */
export function tabsBackTitle(focusedRoute: string | undefined): string {
  if (focusedRoute === 'play' || focusedRoute === 'team' || focusedRoute === 'leagues' || focusedRoute === 'community') {
    return 'Play';
  }
  if (focusedRoute === 'profile') return 'Profile';
  return 'Home';
}
