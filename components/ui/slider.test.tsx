import { fireEvent, render, screen } from '@testing-library/react-native';

import { formBadgeShape } from '@/components/ui/form-badge';
import { snap, Slider, valueAt } from '@/components/ui/slider';

describe('snap and valueAt', () => {
  it.each([
    [1.04, 1],
    [1.06, 1.1],
    [1.55, 1.6],
    [2.4, 2],
    [0.2, 1],
  ])('snaps %s to %s within 1 to 2 by 0.1', (value, expected) => {
    expect(snap(value, 1, 2, 0.1)).toBe(expected);
  });

  it('maps a finger position on the track to a value', () => {
    expect(valueAt(0, 300, 1, 2, 0.1)).toBe(1);
    expect(valueAt(150, 300, 1, 2, 0.1)).toBe(1.5);
    expect(valueAt(300, 300, 1, 2, 0.1)).toBe(2);
    expect(valueAt(-40, 300, 1, 2, 0.1)).toBe(1);
    expect(valueAt(999, 300, 1, 2, 0.1)).toBe(2);
    expect(valueAt(10, 0, 1, 2, 0.1)).toBe(1);
  });
});

describe('Slider', () => {
  const props = { min: 1, max: 2, step: 0.1, accessibilityLabel: 'Text size', formatValue: (v: number) => `${Math.round(v * 100)}%` };

  it('is adjustable for screen readers, with its value spoken', async () => {
    await render(<Slider {...props} value={1.5} onChange={() => {}} testID="slider" />);
    const slider = screen.getByTestId('slider');
    expect(slider.props.accessibilityRole).toBe('adjustable');
    expect(slider.props.accessibilityValue).toEqual({ min: 1, max: 2, now: 1.5, text: '150%' });
  });

  it('steps up and down with the accessibility actions, and stops at the ends', async () => {
    const onChange = jest.fn();
    const view = await render(<Slider {...props} value={1.5} onChange={onChange} testID="slider" />);
    await fireEvent(screen.getByTestId('slider'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenLastCalledWith(1.6);
    await fireEvent(screen.getByTestId('slider'), 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(onChange).toHaveBeenLastCalledWith(1.4);

    onChange.mockClear();
    await view.rerender(<Slider {...props} value={2} onChange={onChange} testID="slider" />);
    await fireEvent(screen.getByTestId('slider'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is at least 44 tall to touch', async () => {
    await render(<Slider {...props} value={1} onChange={() => {}} testID="slider" />);
    expect(screen.getByTestId('slider').props.style.minHeight).toBeGreaterThanOrEqual(44);
  });
});

describe('formBadgeShape (colour-blind friendly results)', () => {
  it('draws every result as a circle by default', () => {
    expect(['W', 'D', 'L'].map((r) => formBadgeShape(r as 'W', false))).toEqual(['circle', 'circle', 'circle']);
  });

  it('gives each result its own shape in colour-blind mode', () => {
    expect(formBadgeShape('W', true)).toBe('circle');
    expect(formBadgeShape('D', true)).toBe('square');
    expect(formBadgeShape('L', true)).toBe('diamond');
  });

  it('keeps the forfeit pill, which spells out its result', () => {
    expect(formBadgeShape('L_forfeit', true)).toBe('pill');
    expect(formBadgeShape('L_forfeit', false)).toBe('pill');
  });
});
