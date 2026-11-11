import { fireEvent, render, screen } from '@testing-library/react-native';

import { FormChip, FormChips } from '@/components/match/form-chips';
import { flatStyle } from '@/components/ui/test-utils';
import { colors, radius } from '@/constants/futty-theme';
import { playerForm } from '@/lib/match/form';
import { mockFormEntries, PROFILE } from '@/lib/match/mock';
import type { FormResult } from '@/lib/match/types';

const kinds: [FormResult, string, string][] = [
  ['W', 'W', colors.success],
  ['D', 'D', colors.inkMuted],
  ['L', 'L', colors.danger],
  ['L_forfeit', 'L (forfeit)', colors.danger],
];

describe('FormChip', () => {
  it.each([
    ['W', 'won'],
    ['D', 'drew'],
    ['L', 'lost'],
    ['L_forfeit', 'lost by forfeit'],
  ] as const)('%s is spoken as "%s"', async (result, spoken) => {
    await render(<FormChip result={result} />);
    expect(screen.getByTestId('form-chip').props.accessibilityLabel).toBe(spoken);
    expect(screen.getByLabelText(spoken)).toBeTruthy();
  });

  it.each(kinds)('%s reads "%s" in its colour on a small canvas pill', async (result, label, color) => {
    await render(<FormChip result={result} />);
    expect(flatStyle(screen.getByText(label)).color).toBe(color);
    expect(flatStyle(screen.getByTestId('form-chip'))).toMatchObject({
      backgroundColor: colors.canvas,
      borderRadius: radius.pill,
    });
  });
});

describe('FormChips', () => {
  it('shows each result newest first, with one spoken label', async () => {
    await render(<FormChips form={['W', 'D', 'L', 'L_forfeit']} />);
    expect(screen.getAllByTestId('form-chip')).toHaveLength(4);
    expect(screen.getByLabelText('Form: won, drew, lost, lost by forfeit')).toBeTruthy();
    expect(screen.getAllByText(/^(W|D|L|L \(forfeit\))$/).map((t) => t.props.children)).toEqual([
      'W',
      'D',
      'L',
      'L (forfeit)',
    ]);
  });

  it('shows at most 5', async () => {
    await render(<FormChips form={['W', 'W', 'L', 'D', 'W', 'L']} />);
    expect(screen.getAllByTestId('form-chip')).toHaveLength(5);
    expect(screen.getByLabelText('Form: won, won, lost, drew, won')).toBeTruthy();
  });

  it('renders the mock player form, leaving out the match Sami missed', async () => {
    await render(<FormChips form={playerForm(mockFormEntries, PROFILE.sami)} />);
    expect(screen.getAllByTestId('form-chip')).toHaveLength(1);
    expect(screen.getByText('L (forfeit)')).toBeTruthy();
  });

  it('has an empty state', async () => {
    await render(<FormChips form={[]} />);
    expect(screen.getByText('No confirmed matches yet')).toBeTruthy();
    expect(screen.queryByTestId('form-chip')).toBeNull();
  });

  it('shows pill skeletons while loading', async () => {
    await render(<FormChips form={[]} loading />);
    expect(screen.getAllByTestId('skeleton-block')).toHaveLength(5);
    expect(screen.queryByText('No confirmed matches yet')).toBeNull();
  });

  it('shows an inline error with retry', async () => {
    const onRetry = jest.fn();
    await render(<FormChips form={[]} error onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load form")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
