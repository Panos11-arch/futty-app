// "Check the score" (levels like Playtomic, decided by Panos 25 November;
// docs/specs/match-record.md decision 1l item 11), on Home and on the match
// page. Players who played on the side the booker isn't on accept or reject
// his score; the first answer settles it and no answer in 24 hours counts as
// accepted. The server decides who sees it (canAnswer) and checks again.
import { useState } from 'react';
import { View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { describeMatchResultError } from '@/lib/match/result-errors';
import { checkCountdown, scoreCheckLine, showScoreCheck, type ScoreToCheck } from '@/lib/match/score-check';
import { respondToMatchScore } from '@/lib/match/score-check-api';
import { makeStyles } from '@/lib/theme';

export type CheckScoreCardProps = {
  score: ScoreToCheck;
  /** From get_match_page's scoreCheck; Home's cards can always be answered. */
  canAnswer?: boolean;
  /** After an answer (or a refusal): reload what shows the card. */
  onAnswered: () => void;
  now?: number;
};

export function CheckScoreCard({ score, canAnswer = true, onAnswered, now = Date.now() }: CheckScoreCardProps) {
  const styles = useStyles();
  const [sending, setSending] = useState<'accept' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!showScoreCheck({ state: 'pending', canAnswer, checkUntil: score.checkUntil }, now)) return null;

  const answer = async (accept: boolean) => {
    if (sending) return;
    setSending(accept ? 'accept' : 'reject');
    setError(null);
    const { error: answerError } = await respondToMatchScore(score.matchId, accept);
    setSending(null);
    if (answerError) setError(describeMatchResultError(answerError));
    onAnswered();
  };

  const line = scoreCheckLine(score);
  return (
    <Card testID={`check-score-card-${score.matchId}`}>
      <View style={styles.stack}>
        <Text variant="headline">Check the score</Text>
        <Text variant="callout">{line}</Text>
        <Text variant="caption" tone="inkMuted" testID={`check-score-countdown-${score.matchId}`}>
          {checkCountdown(score.checkUntil, now)}
        </Text>
        <View style={styles.row}>
          <Button
            label="Accept"
            size="compact"
            onPress={() => answer(true)}
            loading={sending === 'accept'}
            disabled={sending !== null}
            accessibilityHint={line}
            testID={`check-score-accept-${score.matchId}`}
          />
          <Button
            label="Reject"
            size="compact"
            variant="secondary"
            onPress={() => answer(false)}
            loading={sending === 'reject'}
            disabled={sending !== null}
            accessibilityHint={line}
            testID={`check-score-reject-${score.matchId}`}
          />
        </View>
        {error ? <Banner tone="danger" message={error} /> : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  stack: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.md },
}));
