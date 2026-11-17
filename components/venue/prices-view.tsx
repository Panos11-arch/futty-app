// Prices (P6e; spec 13 "Venue setup", "Prices and fees"; spec 05 section 12,
// item 3): one row a format with the server's prices, shown unchanged. Tap a
// format, change it, save: two taps. A new price applies to new bookings only.
import { useState } from 'react';

import { Banner, ListRow, SectionHeader } from '@/components/ui';
import { PriceSheet } from '@/components/venue/price-sheet';
import { SetupFrame } from '@/components/venue/setup-parts';
import { useVenueSetup } from '@/lib/use-venue-setup';
import { FORMATS, NEW_PRICES_NOTE, priceSummary, removePriceRule, setPriceRule } from '@/lib/venue-setup';

export function PricesView({ venueId }: { venueId: string }) {
  const { state, write, retry } = useVenueSetup(venueId);
  const [format, setFormat] = useState<string | null>(null);

  return (
    <SetupFrame state={state} retry={retry}>
      {(setup) => (
        <>
          <SectionHeader title="Prices an hour" />
          <Banner tone="info" message={NEW_PRICES_NOTE} />
          {FORMATS.map((f) => {
            const rule = setup.prices.find((r) => r.format === f);
            return (
              <ListRow
                key={f}
                testID={`price-${f}`}
                title={f}
                subtitle={rule ? priceSummary(rule) : 'No price, so it can’t be booked'}
                leading={{ icon: 'creditcard.fill' }}
                chevron
                onPress={() => setFormat(f)}
              />
            );
          })}
          {format !== null ? (
            <PriceSheet
              key={format}
              format={format}
              rule={setup.prices.find((r) => r.format === format)}
              onClose={() => setFormat(null)}
              onSave={(input) => write(setPriceRule(venueId, input))}
              onRemove={() => write(removePriceRule(venueId, format))}
            />
          ) : null}
        </>
      )}
    </SetupFrame>
  );
}
