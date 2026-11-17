// Small pieces the P6e setup screens share: a row of time chips that
// scrolls sideways, a wrapping row of chips, the confirm step for a change
// that tells players, and the frame every setup view loads into.
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Banner, Button, Chip, SkeletonBlock, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';

export function TimeChips({
  label,
  times,
  value,
  onChange,
  isDisabled,
  testPrefix,
  extra,
}: {
  label: string;
  times: string[];
  value: string | null;
  onChange: (time: string) => void;
  isDisabled?: (time: string) => boolean;
  testPrefix: string;
  /** A chip before the times, such as "Until closing". */
  extra?: ReactNode;
}) {
  return (
    <View style={styles.group}>
      <Text variant="callout">{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {extra}
        {times.map((t) => (
          <Chip
            key={t}
            testID={`${testPrefix}-${t}`}
            label={t === '24:00' ? 'Midnight' : t}
            tabular
            selected={t === value}
            disabled={isDisabled?.(t) ?? false}
            onPress={() => onChange(t)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.wrap}>{children}</View>;
}

/** The second tap for a change that tells players: what will happen, then Yes or Back. */
export function ConfirmStep({
  message,
  confirmLabel,
  busy,
  onConfirm,
  onBack,
}: {
  message: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.group}>
      <Banner tone="warning" message={message} />
      <Button label={confirmLabel} loading={busy} onPress={onConfirm} />
      <Button label="Back" variant="plain" disabled={busy} onPress={onBack} />
    </View>
  );
}

/** What a setup screen has loaded: venue_setup, or venue_media for photos, amenities and menu. */
export type FrameState<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; setup: T };

/** Loading, a load error with Try again, or the view once its data is in. */
export function SetupFrame<T>({
  state,
  retry,
  children,
}: {
  state: FrameState<T>;
  retry: () => void;
  children: (setup: T) => ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {state.status === 'loading' ? <SkeletonBlock width="100%" height={space.xxl * 8} /> : null}
      {state.status === 'error' ? (
        <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: retry }} />
      ) : null}
      {state.status === 'ready' ? children(state.setup) : null}
    </ScrollView>
  );
}

export const setupStyles = StyleSheet.create({
  sheet: { gap: space.md, paddingBottom: space.sm },
});

const styles = StyleSheet.create({
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  group: { gap: space.sm },
  row: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
