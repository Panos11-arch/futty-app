import { fireEvent, render, screen } from '@testing-library/react-native';

import { SegmentedControl } from '@/components/ui/segmented-control';
import { flatStyle } from '@/components/ui/test-utils';
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
    expect(flatStyle(selected).backgroundColor).toBe(colors.brandSoft);
    expect(flatStyle(screen.getByText('Pay for everyone')).color).toBe(colors.brand);
    expect(flatStyle(other).minHeight).toBeGreaterThanOrEqual(44);

    await fireEvent.press(other);
    expect(onChange).toHaveBeenCalledWith('each');
  });

  it('does not report pressing the option already selected', async () => {
    const onChange = jest.fn();
    await render(<SegmentedControl accessibilityLabel="Who pays" options={options} value="each" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Each pays' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
