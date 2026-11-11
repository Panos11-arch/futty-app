import { fireEvent, render, screen } from '@testing-library/react-native';

import { Banner, type BannerTone } from '@/components/ui/banner';
import { flatStyle } from '@/components/ui/test-utils';
import { colors } from '@/constants/futty-theme';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const tones: [BannerTone, string][] = [
  ['info', colors.ink],
  ['warning', colors.warning],
  ['danger', colors.danger],
];

describe('Banner', () => {
  it.each(tones)('renders %s with its tone in the title, not as a fill', async (tone, color) => {
    await render(<Banner tone={tone} title="Heads up" message="Rain expected at 20:00" />);
    expect(flatStyle(screen.getByText('Heads up')).color).toBe(color);
    expect(screen.getByText('Rain expected at 20:00')).toBeTruthy();
    expect(flatStyle(screen.getByTestId('banner')).backgroundColor).toBe(colors.surface);
  });

  it('runs its optional action', async () => {
    const onPress = jest.fn();
    await render(
      <Banner tone="danger" message="You owe €6.80 to Nicosia Five" action={{ label: 'Pay what I owe', onPress }} />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Pay what I owe' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('has no action button when none is given', async () => {
    await render(<Banner tone="info" message="Booking opens at 09:00" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
