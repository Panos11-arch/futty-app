// The booker's "Switch to 6 v 6" / "Switch to 5 v 5" (P12; spec 13
// "Switching after booking"). Shown only when booking_detail says the caller
// can switch now. The first tap shows what the switch means for the
// players' money, with the server's amounts; only the second tap switches.
// The server's refusals are shown in plain words.
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Sheet, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import type { SwitchInfo } from '@/lib/booking-search';
import { switchButtonLabel, switchClosesLabel, switchMoneyWords, switchTarget } from '@/lib/booking-switch';

export type SwitchFormatProps = {
  info: SwitchInfo | null | undefined;
  isBooker: boolean;
  /** The booking is live: not cancelled and not started. */
  live: boolean;
  /** The booker holds a spot in the game. */
  inGame: boolean;
  /** 5 v 5 or 6 v 6 now, for "Keep 5 v 5". */
  playersPerSide: number;
  venueName: string;
  /** The second tap: resolves to null once switched, or the message to show. */
  onSwitch: (to: 5 | 6) => Promise<string | null>;
};

export function SwitchFormat({ info, isBooker, live, inGame, playersPerSide, venueName, onSwitch }: SwitchFormatProps) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards a double tap on Confirm before the first one has re-rendered.
  const busy = useRef(false);

  const to = live && info ? switchTarget(info, isBooker) : null;
  if (to === null || !info) return null;
  const target = to;

  function close() {
    if (busy.current) return;
    setOpen(false);
    setError(null);
  }

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    setSwitching(true);
    setError(null);
    const message = await onSwitch(target);
    busy.current = false;
    setSwitching(false);
    if (message) setError(message);
    else setOpen(false);
  }

  return (
    <View style={styles.section}>
      <Button
        label={switchButtonLabel(target)}
        variant="secondary"
        onPress={() => {
          setError(null);
          setOpen(true);
        }}
        fullWidth
      />
      <Text variant="caption" tone="inkMuted">
        {switchClosesLabel(info)}
      </Text>
      <Sheet
        visible={open}
        onClose={close}
        title={`${switchButtonLabel(target)}?`}
        primaryAction={{ label: `Confirm: switch to ${target} v ${target}`, onPress: confirm, loading: switching }}
        secondaryAction={{ label: `Keep ${playersPerSide} v ${playersPerSide}`, disabled: switching }}>
        {switchMoneyWords(info, venueName, inGame).map((line) => (
          <Text key={line} variant="body">
            {line}
          </Text>
        ))}
        {error ? <Banner tone="danger" message={error} /> : null}
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
});
