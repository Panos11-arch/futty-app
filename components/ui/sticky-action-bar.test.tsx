import { fireEvent, render, screen } from '@testing-library/react-native';

import { StickyActionBar } from '@/components/ui/sticky-action-bar';
import { flatStyle } from '@/components/ui/test-utils';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));

describe('StickyActionBar', () => {
  it('shows the total and fires the primary action', async () => {
    const onPress = jest.fn();
    await render(<StickyActionBar totalCents={680} actionLabel="Pay €6.80" onPress={onPress} />);
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('€6.80')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay €6.80' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('works without a total and respects loading', async () => {
    const onPress = jest.fn();
    await render(<StickyActionBar actionLabel="Book" loading onPress={onPress} />);
    expect(screen.queryByText('Total')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Book' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('pads for the home indicator', async () => {
    await render(<StickyActionBar actionLabel="Book" onPress={() => {}} />);
    // The mock reports a 34 pt bottom inset, like an iPhone home indicator.
    expect(flatStyle(screen.getByTestId('sticky-action-bar')).paddingBottom).toBe(34);
  });
});
