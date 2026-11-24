import { fireEvent, render, screen } from '@testing-library/react-native';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { flatStyle, withTheme } from '@/components/ui/test-utils';
import { colors } from '@/constants/futty-theme';

const options = [
  { value: 'everyone', label: 'Pay for everyone' },
  { value: 'each', label: 'Each pays' },
];

describe('SegmentedControl', () => {
  it('marks the selected option and reports a change', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl accessibilityLabel="Who pays" options={options} value="everyone" onChange={onChange} />,
    );
    const selected = screen.getByRole('tab', { name: 'Pay for everyone' });
    const other = screen.getByRole('tab', { name: 'Each pays' });
    expect(selected.props.accessibilityState).toMatchObject({ selected: true });
    expect(other.props.accessibilityState).toMatchObject({ selected: false });
    expect(flatStyle(selected).backgroundColor).toBe(colors.surface);
    expect(flatStyle(screen.getByText('Pay for everyone')).color).toBe(colors.ink);
    expect(flatStyle(screen.getByText('Each pays')).color).toBe(colors.muted);
    expect(flatStyle(other).minHeight).toBeGreaterThanOrEqual(44);

    await fireEvent.press(other);
    expect(onChange).toHaveBeenCalledWith('each');
  });

  it('on a night header: the selected option is a green pill with dark text', async () => {
    await render(
      withTheme(
        <SegmentedControl onDark accessibilityLabel="Rankings" options={options} value="everyone" onChange={() => {}} />,
        { appearance: 'dark' },
      ),
    );
    const { darkPalette } = jest.requireActual<typeof import('@/constants/futty-theme')>('@/constants/futty-theme');
    expect(flatStyle(screen.getByRole('tab', { name: 'Pay for everyone' })).backgroundColor).toBe(darkPalette.green);
    expect(flatStyle(screen.getByText('Pay for everyone')).color).toBe(darkPalette.greenInk);
  });

  it('does not report pressing the option already selected', async () => {
    const onChange = jest.fn();
    await render(<SegmentedControl accessibilityLabel="Who pays" options={options} value="each" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Each pays' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('puts an option’s optional testID on its tab, for end-to-end tests', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentedControl
        accessibilityLabel="Who pays"
        options={[{ ...options[0], testID: 'checkout-who-pay-all' }, options[1]]}
        value="each"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByTestId('checkout-who-pay-all'));
    expect(onChange).toHaveBeenCalledWith('everyone');
  });
});
