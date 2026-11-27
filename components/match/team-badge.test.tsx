// S20A: the team badge: the kit colour with the team's initials, or the neutral avatar.
import { render, screen } from '@testing-library/react-native';

import { TeamBadge } from '@/components/match/team-badge';
import { flatStyle } from '@/components/ui/test-utils';
import { kitColours } from '@/constants/futty-theme';

describe('TeamBadge', () => {
  it('fills the circle with the kit colour and writes the initials in its label colour', async () => {
    await render(<TeamBadge name="Kato United" kitColour="kitSky" size={56} />);
    const badge = screen.getByTestId('team-badge');
    expect(badge.props.accessibilityLabel).toBe('Kato United');
    expect(flatStyle(badge).backgroundColor).toBe(kitColours.kitSky.shirt);
    expect(flatStyle(badge).width).toBe(56);
    const initials = screen.getByText('KU');
    expect(flatStyle(initials).color).toBe(kitColours.kitSky.label);
  });

  it('outlines a white kit so it shows on the canvas', async () => {
    await render(<TeamBadge name="Whites" kitColour="kitWhite" />);
    expect(flatStyle(screen.getByTestId('team-badge')).borderWidth).toBeGreaterThan(0);
  });

  it('a red kit has no outline', async () => {
    await render(<TeamBadge name="Reds" kitColour="kitRed" />);
    expect(flatStyle(screen.getByTestId('team-badge')).borderWidth).toBeUndefined();
  });

  it.each([null, undefined, 'kitPink'])('no known kit (%s): the neutral avatar with initials', async (kit) => {
    await render(<TeamBadge name="Old Team" kitColour={kit} />);
    expect(screen.queryByTestId('team-badge')).toBeNull();
    expect(screen.getByLabelText('Old Team')).toBeTruthy();
    expect(screen.getByText('OT')).toBeTruthy();
  });
});
