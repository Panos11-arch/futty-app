// Opening hours (P6e; spec 13 "Venue setup"; spec 05 section 12, item 3):
// the week, one row a day. Tap a day, change it, save: two taps.
import { useState } from 'react';

import { ListRow, SectionHeader, Text } from '@/components/ui';
import { DayHoursSheet } from '@/components/venue/day-hours-sheet';
import { SetupFrame } from '@/components/venue/setup-parts';
import { useVenueSetup } from '@/lib/use-venue-setup';
import { hoursLabel, setVenueHours, WEEKDAYS } from '@/lib/venue-setup';

export function HoursView({ venueId }: { venueId: string }) {
  const { state, write, retry } = useVenueSetup(venueId);
  const [day, setDay] = useState<number | null>(null);

  return (
    <SetupFrame state={state} retry={retry}>
      {(setup) => (
        <>
          <SectionHeader title="Opening hours" />
          <Text variant="callout" tone="inkMuted">
            Players can book only inside these hours. Games already booked always stay on.
          </Text>
          {WEEKDAYS.map((d) => (
            <ListRow
              key={d.weekday}
              testID={`hours-day-${d.weekday}`}
              title={d.long}
              subtitle={hoursLabel(setup.hours.find((h) => h.weekday === d.weekday))}
              leading={{ icon: 'clock.fill' }}
              chevron
              onPress={() => setDay(d.weekday)}
            />
          ))}
          {day !== null ? (
            <DayHoursSheet
              key={day}
              weekday={day}
              week={setup.hours}
              onClose={() => setDay(null)}
              onSave={(week) => write(setVenueHours(venueId, week))}
            />
          ) : null}
        </>
      )}
    </SetupFrame>
  );
}
