import { render, screen } from '@testing-library/react-native';

import { StatusPill, type Status } from '@/components/ui/status-pill';
import { flatStyle } from '@/components/ui/test-utils';
import { colors, radius } from '@/constants/futty-theme';

const cases: [Status, string, string, string][] = [
  ['paid', 'Paid', colors.positive, colors.greenSoft],
  ['cash', 'Cash', colors.muted, colors.fill],
  ['unpaid', 'Unpaid', colors.warning, colors.warningLight],
  ['debt', 'Debt', colors.danger, colors.dangerLight],
  ['confirmed', 'Confirmed', colors.positive, colors.greenSoft],
  ['pending', 'Pending', colors.warning, colors.warningLight],
  ['held', 'Held', colors.info, colors.infoLight],
  ['charged', 'Charged', colors.positive, colors.greenSoft],
  ['released', 'Released', colors.muted, colors.fill],
  ['refunded', 'Refunded', colors.muted, colors.fill],
];

describe('StatusPill', () => {
  it.each(cases)('%s reads "%s" in its tone on a pill tinted the same tone', async (status, label, color, fill) => {
    await render(<StatusPill status={status} />);
    expect(flatStyle(screen.getByText(label)).color).toBe(color);
    expect(flatStyle(screen.getByTestId('status-pill'))).toMatchObject({
      backgroundColor: fill,
      borderRadius: radius.pill,
    });
  });
});
