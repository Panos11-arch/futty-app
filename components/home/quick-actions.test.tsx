import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { QuickActions } from '@/components/home/quick-actions';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

describe('Home quick actions (image 01)', () => {
  beforeEach(() => jest.mocked(router.push).mockClear());

  it('shows the four agreed labels, in order, as buttons', async () => {
    await render(<QuickActions />);
    expect(screen.getAllByRole('button').map((b) => b.props.accessibilityLabel)).toEqual([
      'Book a pitch',
      'Find a match',
      'Leagues',
      'Join an event',
    ]);
  });

  it.each([
    ['tab-book', '/book'],
    ['home-action-find-match', { pathname: '/squads', params: { view: 'players' } }],
    ['home-action-leagues', '/leagues'],
    // S10B: Join an event opens Leagues until the events list exists.
    // S10B: Join an event opens the Events list.
    ['home-action-event', '/events'],
  ])('%s opens its screen once, with a light haptic', async (testID, href) => {
    jest.mocked(Haptics.impactAsync).mockClear();
    await render(<QuickActions />);
    await fireEvent.press(screen.getByTestId(testID));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith(href);
    expect(Haptics.impactAsync).toHaveBeenCalled();
  });
});
