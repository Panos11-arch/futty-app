// The five starting questions (docs/specs/match-record.md decision 1f.2;
// 05-product section 4.1), one per step. Finishing sends the five answers to
// set_starting_level, which works out the level; skipping sends nothing, and
// the server gives a provisional default the first time it is needed.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { ListRow } from '@/components/ui/list-row';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { describeLevelError } from '@/lib/match/level-errors';
import { formatLevel, STARTING_QUESTIONS, type StartingAnswers } from '@/lib/match/levels';
import { setStartingLevel } from '@/lib/match/levels-api';

export type StartingLevelFormProps = {
  /** Skip, or Done after the level is shown. */
  onClose: () => void;
};

type Draft = Partial<StartingAnswers>;

export function StartingLevelForm({ onClose }: StartingLevelFormProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Draft>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ level: number } | null>(null);

  if (result) {
    return (
      <View style={styles.stack} testID="starting-level-done">
        <Text variant="title">Your starting level</Text>
        <Text variant="display" tabular testID="starting-level-value">
          {formatLevel(result.level)}
        </Text>
        <Text variant="body" tone="inkMuted">
          It stays provisional until you have played 5 competitive matches, and moves after each one.
        </Text>
        <Button label="Done" onPress={onClose} fullWidth testID="starting-level-close" />
      </View>
    );
  }

  const question = STARTING_QUESTIONS[step];
  const last = step === STARTING_QUESTIONS.length - 1;
  const value = answers[question.key];
  const choose = (v: string) => setAnswers((a) => ({ ...a, [question.key]: v }));

  const finish = async () => {
    const complete = STARTING_QUESTIONS.every((q) => answers[q.key] !== undefined);
    if (!complete) return;
    setSending(true);
    setError(null);
    const { data, error: sendError } = await setStartingLevel(answers as StartingAnswers);
    setSending(false);
    if (sendError) {
      setError(describeLevelError(sendError));
      return;
    }
    setResult({ level: Number((data as { level: number | string } | null)?.level ?? 0) });
  };

  return (
    <View style={styles.stack} testID="starting-level-form">
      <Text variant="callout" tone="inkMuted" tabular testID="starting-level-step">
        {`Step ${step + 1} of ${STARTING_QUESTIONS.length}`}
      </Text>
      <Text variant="title" accessibilityRole="header">
        {question.question}
      </Text>

      {question.key === 'selfRating' ? (
        <View style={styles.chips}>
          {question.options.map((o) => (
            <Chip
              key={o.value}
              label={o.label}
              selected={value === o.value}
              onPress={() => choose(o.value)}
              tabular
              testID={`answer-${o.value}`}
            />
          ))}
        </View>
      ) : (
        <View>
          {question.options.map((o) => (
            <ListRow
              key={o.value}
              title={o.label}
              onPress={() => choose(o.value)}
              trailing={
                value === o.value ? (
                  <Text variant="callout" tone="brand">
                    Picked
                  </Text>
                ) : undefined
              }
              accessibilityLabel={value === o.value ? `${o.label}, picked` : o.label}
              testID={`answer-${o.value}`}
            />
          ))}
        </View>
      )}

      {error ? <Banner tone="danger" message={error} /> : null}

      <Button
        label={last ? 'See my level' : 'Next'}
        onPress={last ? finish : () => setStep(step + 1)}
        disabled={value === undefined}
        loading={sending}
        fullWidth
        testID="starting-level-next"
      />
      {step > 0 ? (
        <Button label="Back" variant="secondary" onPress={() => setStep(step - 1)} fullWidth testID="starting-level-back" />
      ) : null}
      <Button label="Skip for now" variant="plain" onPress={onClose} fullWidth testID="starting-level-skip" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
