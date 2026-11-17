// Closures (P6e; spec 13 "Venue setup"; spec 05 section 12, item 2): every
// closure that hasn't ended, each removed with one tap (its days take new
// bookings again), and Add closure.
import { useState } from 'react';

import { Banner, Button, EmptyState, IconButton, ListRow, SectionHeader } from '@/components/ui';
import { ClosureSheet } from '@/components/venue/closure-sheet';
import { SetupFrame } from '@/components/venue/setup-parts';
import { useVenueSetup } from '@/lib/use-venue-setup';
import { addVenueClosure, closureLabel, removeVenueClosure } from '@/lib/venue-setup';
import { cyprusToday } from '@/lib/venue-today';

export function ClosuresView({ venueId }: { venueId: string }) {
  const { state, write, retry } = useVenueSetup(venueId);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function remove(id: string) {
    setBusy(id);
    setNotice(null);
    const refusal = await write(removeVenueClosure(id));
    setBusy(null);
    if (refusal) setNotice(refusal);
  }

  return (
    <SetupFrame state={state} retry={retry}>
      {(setup) => (
        <>
          <SectionHeader title="Closures" />
          <Button label="Add closure" onPress={() => setAdding(true)} />
          {notice ? <Banner tone="danger" message={notice} /> : null}
          {setup.closures.length === 0 ? (
            <EmptyState icon="calendar" message="No closures coming up. Add one for holidays or works." />
          ) : null}
          {setup.closures.map((c) => {
            const label = closureLabel(c);
            return (
              <ListRow
                key={c.id}
                title={label}
                subtitle={c.reason ?? undefined}
                leading={{ icon: 'calendar' }}
                trailing={
                  <IconButton
                    icon="trash.fill"
                    tone="danger"
                    accessibilityLabel={`Remove closure ${label}`}
                    disabled={busy === c.id}
                    onPress={() => remove(c.id)}
                  />
                }
              />
            );
          })}
          {adding ? (
            <ClosureSheet
              today={cyprusToday()}
              onClose={() => setAdding(false)}
              onAdd={(input) => write(addVenueClosure({ venueId, ...input }))}
            />
          ) : null}
        </>
      )}
    </SetupFrame>
  );
}
