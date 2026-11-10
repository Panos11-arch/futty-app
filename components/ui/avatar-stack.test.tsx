import { render, screen } from '@testing-library/react-native';

import { AvatarStack } from '@/components/ui/avatar-stack';

const people = ['Andreas G', 'Bella K', 'Chris P', 'Dina M', 'Elias N', 'Fotis O', 'Georgia S'].map((name, i) => ({
  id: String(i),
  name,
}));

describe('AvatarStack', () => {
  it('shows the first four and "+3" for the rest', async () => {
    await render(<AvatarStack people={people} />);
    expect(screen.getByText('AG')).toBeTruthy();
    expect(screen.getByText('DM')).toBeTruthy();
    expect(screen.queryByText('EN')).toBeNull();
    expect(screen.getByText('+3')).toBeTruthy();
    expect(screen.getByLabelText('7 players')).toBeTruthy();
  });

  it('shows everyone and no overflow when they fit', async () => {
    await render(<AvatarStack people={people.slice(0, 3)} max={4} />);
    expect(screen.getByText('CP')).toBeTruthy();
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it('uses the singular for one player', async () => {
    await render(<AvatarStack people={people.slice(0, 1)} />);
    expect(screen.getByLabelText('1 player')).toBeTruthy();
  });
});
