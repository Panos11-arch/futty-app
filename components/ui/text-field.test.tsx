import { fireEvent, render, screen } from '@testing-library/react-native';

import { TextField } from '@/components/ui/text-field';
import { flatStyle } from '@/components/ui/test-utils';
import { colors } from '@/constants/futty-theme';

describe('TextField', () => {
  it('shows its label and helper and passes typing through', async () => {
    const onChangeText = jest.fn();
    await render(<TextField label="Team name" helper="Shown to other players" onChangeText={onChangeText} />);
    expect(screen.getByText('Team name')).toBeTruthy();
    expect(screen.getByText('Shown to other players')).toBeTruthy();
    const input = screen.getByLabelText('Team name');
    await fireEvent.changeText(input, 'Larnaca Lions');
    expect(onChangeText).toHaveBeenCalledWith('Larnaca Lions');
    expect(flatStyle(input).borderColor).toBe(colors.border);
    expect(flatStyle(input).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('shows an error in place of the helper', async () => {
    await render(<TextField label="Email" helper="We never share it" error="Enter a valid email" />);
    expect(screen.queryByText('We never share it')).toBeNull();
    expect(flatStyle(screen.getByText('Enter a valid email')).color).toBe(colors.danger);
    const input = screen.getByLabelText('Email');
    expect(flatStyle(input).borderColor).toBe(colors.danger);
    expect(input.props.accessibilityHint).toBe('Enter a valid email');
  });
});
