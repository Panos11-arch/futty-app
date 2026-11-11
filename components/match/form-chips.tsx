// Form guide chips (docs/specs/05-product.md section 3): the last 5 confirmed
// results, newest first. Status colours appear only as text on a small pill
// (15-design.md section 3).
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text, type TextTone } from '@/components/ui/text';
import { colors, radius, space } from '@/constants/futty-theme';
import type { FormResult } from '@/lib/match/types';

const FORM_LENGTH = 5;
/** Matches a pill's height: caption line plus its vertical padding. */
const PILL_HEIGHT = 20;
const PILL_WIDTH = 28;

const looks: Record<FormResult, { label: string; spoken: string; tone: TextTone }> = {
  W: { label: 'W', spoken: 'won', tone: 'success' },
  D: { label: 'D', spoken: 'drew', tone: 'inkMuted' },
  L: { label: 'L', spoken: 'lost', tone: 'danger' },
  L_forfeit: { label: 'L (forfeit)', spoken: 'lost by forfeit', tone: 'danger' },
};

export function formLabel(result: FormResult): string {
  return looks[result].label;
}

export function spokenForm(result: FormResult): string {
  return looks[result].spoken;
}

export function FormChip({ result }: { result: FormResult }) {
  const { label, spoken, tone } = looks[result];
  return (
    <View testID="form-chip" accessible accessibilityLabel={spoken} style={styles.pill}>
      <Text variant="caption" tone={tone}>
        {label}
      </Text>
    </View>
  );
}

export type FormChipsProps = {
  /** Newest first, as playerForm and teamForm return it. */
  form: FormResult[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

export function FormChips({ form, loading = false, error = false, onRetry }: FormChipsProps) {
  if (loading) {
    return (
      <View style={styles.row}>
        {Array.from({ length: FORM_LENGTH }, (_, i) => (
          <SkeletonBlock key={i} width={PILL_WIDTH} height={PILL_HEIGHT} rounded="pill" />
        ))}
      </View>
    );
  }
  if (error) {
    return (
      <View style={styles.row}>
        <Text variant="callout" tone="danger">
          Couldn&apos;t load form
        </Text>
        {onRetry ? <Button label="Try again" variant="plain" onPress={onRetry} /> : null}
      </View>
    );
  }
  if (form.length === 0) {
    return (
      <Text variant="callout" tone="inkMuted">
        No confirmed matches yet
      </Text>
    );
  }
  const shown = form.slice(0, FORM_LENGTH);
  return (
    <View
      accessible
      accessibilityLabel={`Form: ${shown.map(spokenForm).join(', ')}`}
      style={styles.row}>
      {shown.map((result, i) => (
        <FormChip key={i} result={result} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
  pill: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.canvas,
  },
});
