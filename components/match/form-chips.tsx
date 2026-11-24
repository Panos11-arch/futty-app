// Form guide chips (docs/specs/05-product.md section 3): the last 5 confirmed
// results, newest first. Each is a FormBadge: the letter always shows, and
// Colour-blind friendly adds a shape per result (15-design.md section 0.4).
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { FormBadge } from '@/components/ui/form-badge';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import type { FormResult } from '@/lib/match/types';

const FORM_LENGTH = 5;
/** Matches a badge's size. */
const PILL_HEIGHT = space.lg + space.sm;
const PILL_WIDTH = space.lg + space.sm;

const looks: Record<FormResult, { label: string; spoken: string }> = {
  W: { label: 'W', spoken: 'won' },
  D: { label: 'D', spoken: 'drew' },
  L: { label: 'L', spoken: 'lost' },
  L_forfeit: { label: 'L (forfeit)', spoken: 'lost by forfeit' },
};

export function formLabel(result: FormResult): string {
  return looks[result].label;
}

export function spokenForm(result: FormResult): string {
  return looks[result].spoken;
}

export function FormChip({ result }: { result: FormResult }) {
  const { label, spoken } = looks[result];
  return <FormBadge testID="form-chip" result={result} label={label} accessibilityLabel={spoken} />;
}

export type FormChipsProps = {
  /** Newest first, as playerForm and teamForm return it. */
  form: FormResult[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
};

export function FormChips({ form, loading = false, error = false, onRetry }: FormChipsProps) {
  const styles = useStyles();
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

const useStyles = makeStyles(() => ({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs },
}));
