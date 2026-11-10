import { render, screen } from '@testing-library/react-native';

import { PriceBreakdown } from '@/components/ui/price-breakdown';
import { flatStyle } from '@/components/ui/test-utils';

describe('PriceBreakdown', () => {
  it('shows 680 cents as €6.80', async () => {
    await render(<PriceBreakdown lines={[{ label: 'Your spot', cents: 680 }]} totalCents={680} />);
    expect(screen.getAllByText('€6.80')).toHaveLength(2);
  });

  it("shows the server's total and sums nothing itself", async () => {
    await render(
      <PriceBreakdown
        lines={[
          { label: 'Pitch', cents: 600 },
          { label: 'Service fee', cents: 80 },
        ]}
        totalCents={999}
      />,
    );
    expect(screen.getByText('Pitch')).toBeTruthy();
    expect(screen.getByText('€6.00')).toBeTruthy();
    expect(screen.getByText('Service fee')).toBeTruthy();
    expect(screen.getByText('€0.80')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('€9.99')).toBeTruthy();
    expect(screen.queryByText('€6.80')).toBeNull();
  });

  it('uses tabular figures and a custom total label', async () => {
    await render(<PriceBreakdown lines={[]} totalCents={1250} totalLabel="You pay now" />);
    expect(screen.getByText('You pay now')).toBeTruthy();
    expect(flatStyle(screen.getByText('€12.50')).fontVariant).toEqual(['tabular-nums']);
  });
});
