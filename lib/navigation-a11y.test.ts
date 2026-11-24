import { tabAccessibilityLabel, tabsBackTitle, VISIBLE_TABS } from '@/lib/navigation-a11y';

// QA 24 November, bugs 6 and 7.
describe('tab labels for VoiceOver and TalkBack', () => {
  it('count only the tabs on the bar (VoiceOver read "1 of 7" with 4 showing)', () => {
    expect(VISIBLE_TABS.map((t) => t.title)).toEqual(['Home', 'Book', 'Play', 'Profile']);
    expect(VISIBLE_TABS.map((t, i) => tabAccessibilityLabel(t.title, i, 'ios'))).toEqual([
      'Home, tab, 1 of 4',
      'Book, tab, 2 of 4',
      'Play, tab, 3 of 4',
      'Profile, tab, 4 of 4',
    ]);
  });

  it('on Android, the tab name alone (no stray comma; TalkBack adds the role)', () => {
    expect(tabAccessibilityLabel('Profile', 3, 'android')).toBe('Profile');
  });
});

describe('the back button names the tab it returns to, never "(tabs)"', () => {
  it.each([
    [undefined, 'Home'],
    ['index', 'Home'],
    ['play', 'Play'],
    ['profile', 'Profile'],
    ['team', 'Play'],
    ['leagues', 'Play'],
    ['community', 'Play'],
    ['book', 'Home'],
  ])('%s → %s', (route, title) => {
    expect(tabsBackTitle(route)).toBe(title);
  });
});
