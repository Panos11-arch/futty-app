// Home's no-opponent cards (B3; spec 13 "No side B by 24 hours before
// kickoff"): each of the player's half pitches waiting for the 24-hour
// choice, with both buttons. The amounts are my_no_opponent_choices'.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { dayTimeLabel } from '@/components/booking/checkout-view';
import { NoOpponentPanel } from '@/components/booking/no-opponent-panel';
import { space } from '@/constants/futty-theme';
import {
  cancelFree,
  fetchNoOpponentChoices,
  payOtherHalf,
  type NoOpponentChoice,
} from '@/lib/booking-opposition';

export type NoOpponentChoicesListProps = {
  load: () => Promise<NoOpponentChoice[]>;
  /** Each resolves to an error message, or null. */
  onPayWhole: (bookingId: string) => Promise<string | null>;
  onCancelFree: (bookingId: string) => Promise<string | null>;
  /** Bumped by Home when it comes back into view. */
  refreshKey?: number;
};

export function NoOpponentChoicesList({ load, onPayWhole, onCancelFree, refreshKey = 0 }: NoOpponentChoicesListProps) {
  const [choices, setChoices] = useState<NoOpponentChoice[]>([]);
  const request = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const mine = ++request.current;
    try {
      const rows = await loadRef.current();
      if (request.current === mine) setChoices(rows);
    } catch {
      // Home shows nothing rather than an error; the booking shows the choice too.
      if (request.current === mine) setChoices([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  if (choices.length === 0) return null;

  const after = (work: () => Promise<string | null>) => async () => {
    const error = await work();
    if (!error) void reload();
    return error;
  };

  return (
    <View style={styles.list}>
      {choices.map((c) => (
        <NoOpponentPanel
          key={c.booking_id}
          testID={`home-no-opponent-${c.booking_id}`}
          info={c}
          game={[c.venue_name, c.pitch_label, dayTimeLabel(c.booking_day, c.start_time)].filter(Boolean).join(' · ')}
          onPayWhole={after(() => onPayWhole(c.booking_id))}
          onCancelFree={after(() => onCancelFree(c.booking_id))}
        />
      ))}
    </View>
  );
}

/** The cards wired to the server and Stripe's payment sheet, for Home. */
export function NoOpponentChoices() {
  const [refreshKey, setRefreshKey] = useState(0);
  useFocusEffect(useCallback(() => setRefreshKey((k) => k + 1), []));

  const payWhole = async (bookingId: string) => {
    // Loaded on the tap, so Home (and its tests) never load Stripe's native module up front.
    const stripe = await import('@stripe/stripe-react-native');
    const outcome = await payOtherHalf(bookingId, {
      init: (p) => stripe.initPaymentSheet(p),
      present: () => stripe.presentPaymentSheet(),
    });
    return outcome.status === 'error' ? outcome.message : null;
  };

  return (
    <NoOpponentChoicesList
      load={fetchNoOpponentChoices}
      onPayWhole={payWhole}
      onCancelFree={cancelFree}
      refreshKey={refreshKey}
    />
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
});
