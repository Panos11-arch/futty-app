import { fireEvent, render, screen } from '@testing-library/react-native';

import { SectionHeader } from '@/components/ui/section-header';

describe('SectionHeader', () => {
  it('renders a header', async () => {
    await render(<SectionHeader title="Venues nearby" />);
    expect(screen.getByRole('header', { name: 'Venues nearby' })).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders an optional action', async () => {
    const onPress = jest.fn();
    await render(<SectionHeader title="Venues nearby" action={{ label: 'See all', onPress }} />);
    await fireEvent.press(screen.getByRole('button', { name: 'See all' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
