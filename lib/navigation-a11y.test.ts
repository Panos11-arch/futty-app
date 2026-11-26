import { tabAccessibilityLabel, tabsBackTitle, VISIBLE_TABS } from '@/lib/navigation-a11y';

// QA 24 November, bugs 6 and 7; S2's five-item bar (spec 15 section 0.5).
describe('tab labels for VoiceOver and TalkBack', () => {
  it('the bar holds Home, Community, the Card button, Rankings and Profile', () => {
    expect(VISIBLE_TABS.map((t) => t.name)).toEqual(['index', 'community', 'card', 'rankings', 'profile']);
    expect(VISIBLE_TABS.map((t) => t.title)).toEqual(['Home', 'Community', 'My card', 'Rankings', 'Profile']);
  });

  it('count only the items on the bar (never the hidden routes)', () => {
    expect(VISIBLE_TABS.map((t, i) => tabAccessibilityLabel(t.title, i, 'ios'))).toEqual([
      'Home, tab, 1 of 5',
      'Community, tab, 2 of 5',
      'My card, tab, 3 of 5',
      'Rankings, tab, 4 of 5',
      'Profile, tab, 5 of 5',
    ]);
  });

  it('on Android, the tab name alone (no stray comma; TalkBack adds the role)', () => {
    expect(tabAccessibilityLabel('Profile', 4, 'android')).toBe('Profile');
  });
});

describe('the back button names the tab it returns to, never "(tabs)"', () => {
  it.each([
    [undefined, 'Home'],
    ['index', 'Home'],
    ['community', 'Community'],
    ['rankings', 'Rankings'],
    ['profile', 'Profile'],
    ['play', 'Play'],
    ['team', 'Play'],
    ['leagues', 'Leagues'],
    ['book', 'Home'],
  ])('%s → %s', (route, title) => {
    expect(tabsBackTitle(route)).toBe(title);
  });
});
