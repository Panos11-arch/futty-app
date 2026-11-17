// The Today screen's weather nudge (P11, left out of P6; docs/specs/13-
// payments-bookings.md "Venue condition warning"): booked games whose
// forecast meets an app_rules threshold, while kickoff is at least
// weather_nudge_hours away, so warnings come early enough to use. One tap
// flags conditions for that slot (players are told, normal cancellation rules
// apply). The server picks the slots; this only lists them.
import { StyleSheet, View } from 'react-native';

import { Button, Card, ListRow, SectionHeader } from '@/components/ui';
import { AppleWeatherMark } from '@/components/venue/weather-strip';
import { space } from '@/constants/futty-theme';
import { nudgeTitle, warningWords, type WeatherNudge, type WeatherNudges } from '@/lib/weather';

export type WeatherNudgesListProps = {
  nudges: WeatherNudges | null;
  /** Today in Cyprus, for "Tomorrow" and the like. */
  today: string;
  /** The booking being flagged, if any. */
  busy: string | null;
  onFlag: (slot: WeatherNudge) => void;
};

export function WeatherNudgesList({ nudges, today, busy, onFlag }: WeatherNudgesListProps) {
  if (!nudges || !nudges.attribution || nudges.slots.length === 0) return null;
  return (
    <View style={styles.section} testID="weather-nudges">
      <SectionHeader title="Bad forecast for a booked game" />
      <Card>
        {nudges.slots.map((slot) => (
          <View key={slot.booking_id} testID={`weather-nudge-${slot.booking_id}`}>
            <ListRow
              leading={{ icon: 'exclamationmark.triangle.fill' }}
              title={nudgeTitle(slot, today)}
              subtitle={warningWords(slot.forecast)}
              trailing={
                <Button
                  label="Flag conditions"
                  variant="plain"
                  loading={busy === slot.booking_id}
                  onPress={() => onFlag(slot)}
                  accessibilityHint="Tells everyone booked then that conditions may be unsuitable"
                />
              }
            />
          </View>
        ))}
        <AppleWeatherMark attribution={nudges.attribution} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
});
