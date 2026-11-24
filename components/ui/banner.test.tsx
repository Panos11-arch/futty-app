import { fireEvent, render, screen } from '@testing-library/react-native';

import { Banner, type BannerTone } from '@/components/ui/banner';
import { flatStyle, withTheme } from '@/components/ui/test-utils';
import { colors, darkPalette } from '@/constants/futty-theme';

jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const tones: [BannerTone, string, string][] = [
  ['info', colors.info, colors.infoLight],
  ['warning', colors.warning, colors.warningLight],
  ['danger', colors.danger, colors.dangerLight],
];

describe('Banner', () => {
  it.each(tones)('renders %s as a tinted panel with its tone in the title and border', async (tone, color, fill) => {
    await render(<Banner tone={tone} title="Heads up" message="Rain expected at 20:00" />);
    expect(flatStyle(screen.getByText('Heads up')).color).toBe(color);
    expect(flatStyle(screen.getByText('Rain expected at 20:00')).color).toBe(colors.ink);
    expect(flatStyle(screen.getByTestId('banner'))).toMatchObject({ backgroundColor: fill, borderColor: color });
  });

  it('uses the dark tints in dark mode', async () => {
    await render(withTheme(<Banner tone="warning" title="Heads up" message="Rain" />, { appearance: 'dark' }));
    expect(flatStyle(screen.getByTestId('banner')).backgroundColor).toBe(darkPalette.warningLight);
    expect(flatStyle(screen.getByText('Heads up')).color).toBe(darkPalette.warning);
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
