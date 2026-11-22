import { fireEvent, render, screen } from '@testing-library/react-native';

import { TextField } from '@/components/ui/text-field';
import { flatStyle } from '@/components/ui/test-utils';
import { colors, type } from '@/constants/futty-theme';

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

  // iOS: a lineHeight larger than the font's own pushes single-line text and
  // the placeholder down until they clip (RN's iOS TextInput adds a baseline
  // offset for it). Multiline text still needs the line spacing.
  it('sets no lineHeight on a single-line field, and keeps it on a multiline one', async () => {
    await render(<TextField label="Email" />);
    expect(flatStyle(screen.getByLabelText('Email')).lineHeight).toBeUndefined();
    expect(flatStyle(screen.getByLabelText('Email')).fontSize).toBe(type.body.fontSize);

    await render(<TextField label="Notes" multiline />);
    expect(flatStyle(screen.getByLabelText('Notes')).lineHeight).toBe(type.body.lineHeight);
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
