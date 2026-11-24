// Logging after the game (S13B, images 07–11), by the captain only: Score →
// Goals → Assists → Review, with Back and Continue and a progress bar. Two
// captains: after logging he waits for the other captain, or the scores
// differ and he changes his. In a correction (24 hours after the result)
// the score is fixed: Goals → Assists → Review.
//
// The progress bar stays fixed at the top and the buttons at the bottom;
// only the step itself scrolls.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PitchStep } from '@/components/match/log-score/pitch-step';
import { ProgressHeader } from '@/components/match/log-score/progress-header';
import { ReviewStep } from '@/components/match/log-score/review-step';
import { ScoreStep } from '@/components/match/log-score/score-step';
import { ScoreMismatch, ScoreWaiting } from '@/components/match/log-score/score-status';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { hairline, space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import {
  assistsValid,
  draftFrom,
  goalsComplete,
  needsStats,
  scoresDiffer,
  stepsFor,
  toStatsPayload,
  waitingForOther,
  type Draft,
  type MatchLog,
} from '@/lib/match/log-score';
import { logMatchResult, setMatchStats, type LogResult } from '@/lib/match/log-score-api';
import { describeMatchResultError, STALE_RESULT_ERRORS } from '@/lib/match/result-errors';
import { makeStyles } from '@/lib/theme';

export type LogScoreFlowProps = {
  log: MatchLog;
  /** After Confirm: what the server decided ('corrected' after a correction). */
  onLogged: (status: LogResult['status'] | 'corrected') => void;
  /** Back on the first step. */
  onExit: () => void;
  onOpenMatch: () => void;
  /** The match moved on (a stale error): reload it. */
  onStale: () => void;
};

type Phase = 'mismatch' | 'waiting' | 'steps';

/** Continue, and Confirm (a correction keeps the scorers editor's old save-scorers id). */
const ACTION_IDS = {
  next: { testID: 'post-match-next' },
  confirm: { testID: 'post-match-done' },
  correct: { testID: 'save-scorers' },
} as const;

export function LogScoreFlow({ log, onLogged, onExit, onOpenMatch, onStale }: LogScoreFlowProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>(() =>
    scoresDiffer(log) ? 'mismatch' : waitingForOther(log) ? 'waiting' : 'steps'
  );
  const [draft, setDraft] = useState<Draft>(() => draftFrom(log));
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase === 'mismatch') return <ScoreMismatch log={log} onChange={() => setPhase('steps')} />;
  if (phase === 'waiting') return <ScoreWaiting log={log} onChange={() => setPhase('steps')} onOpenMatch={onOpenMatch} />;

  const steps = stepsFor(log, draft);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const sides = log.writableSides;
  const canContinue =
    step === 'goals' ? goalsComplete(draft, sides) : step === 'assists' ? assistsValid(draft, sides) : true;

  const back = () => {
    setError(null);
    if (index > 0) setIndex(index - 1);
    else if (scoresDiffer(log)) setPhase('mismatch');
    else if (waitingForOther(log)) setPhase('waiting');
    else onExit();
  };

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const stats = needsStats(log, draft) ? toStatsPayload(draft, sides) : {};
    if (log.canCorrect) {
      const { error: saveError } = await setMatchStats(log.matchId, stats);
      setSaving(false);
      if (saveError) return fail(saveError);
      haptic.success();
      onLogged('corrected');
      return;
    }
    const { result, error: logError } = await logMatchResult(log.matchId, draft.score, stats);
    setSaving(false);
    if (logError || !result) return fail(logError ?? { message: 'unknown' });
    if (result.status === 'confirmed') haptic.success();
    onLogged(result.status);
  };

  function fail(e: { message: string }) {
    haptic.error();
    setError(describeMatchResultError(e));
    if (STALE_RESULT_ERRORS.has(e.message)) onStale();
  }

  const next = () => {
    setError(null);
    if (last) void confirm();
    else setIndex(index + 1);
  };

  let body: React.ReactNode;
  if (step === 'score') body = <ScoreStep log={log} draft={draft} onChange={setDraft} />;
  else if (step === 'goals') body = <PitchStep log={log} draft={draft} mode="goals" onChange={setDraft} />;
  else if (step === 'assists') body = <PitchStep log={log} draft={draft} mode="assists" onChange={setDraft} />;
  else body = <ReviewStep log={log} draft={draft} />;

  return (
    <View style={styles.flex} testID="log-score-flow">
      <ProgressHeader step={step} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.body}>
        {body}
        {error ? (
          <View style={styles.error}>
            <Banner tone="danger" message={error} />
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
        <View style={styles.half}>
          <Button label="Back" variant="secondary" onPress={back} fullWidth testID="log-score-back" />
        </View>
        <View style={styles.half}>
          <Button
            label={last ? 'Confirm' : 'Continue'}
            onPress={next}
            disabled={!canContinue}
            loading={saving}
            fullWidth
            {...ACTION_IDS[last ? (log.canCorrect ? 'correct' : 'confirm') : 'next']}
          />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1 },
  body: { paddingBottom: space.xl },
  error: { paddingHorizontal: space.lg, paddingTop: space.md },
  bar: {
    flexDirection: 'row',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    backgroundColor: colors.canvas,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  half: { flex: 1 },
}));
