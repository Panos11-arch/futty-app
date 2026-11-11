import { render, screen } from '@testing-library/react-native';

import { StatusPill, type Status } from '@/components/ui/status-pill';
import { flatStyle } from '@/components/ui/test-utils';
import { colors, radius } from '@/constants/futty-theme';

const cases: [Status, string, string][] = [
  ['paid', 'Paid', colors.success],
  ['cash', 'Cash', colors.inkMuted],
  ['unpaid', 'Unpaid', colors.warning],
  ['debt', 'Debt', colors.danger],
  ['confirmed', 'Confirmed', colors.success],
  ['pending', 'Pending', colors.warning],
  ['held', 'Held', colors.inkMuted],
  ['charged', 'Charged', colors.success],
  ['released', 'Released', colors.inkMuted],
  ['refunded', 'Refunded', colors.inkMuted],
];

describe('StatusPill', () => {
  it.each(cases)('%s reads "%s" in its tone on a small canvas pill', async (status, label, color) => {
    await render(<StatusPill status={status} />);
    expect(flatStyle(screen.getByText(label)).color).toBe(color);
    expect(flatStyle(screen.getByTestId('status-pill'))).toMatchObject({
      backgroundColor: colors.canvas,
      borderRadius: radius.pill,
    });
  });
});
