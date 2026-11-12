// Entering and answering a new match's result (A2's functions only).
// A captain (the booker in a pickup game) enters the score; the other side
// accepts or rejects it. Deadlines are shown in Cyprus time; the settled
// states use the words in docs/specs/match-record.md section 7 through
// ScoreLine.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ScoreLine } from '@/components/match/score-line';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { formatMatchWhen } from '@/lib/match/format';
import { resultState, submittedScoreLine, toListItem, viewerRole, type ResultMatch } from '@/lib/match/result';
import { describeMatchResultError, STALE_RESULT_ERRORS } from '@/lib/match/result-errors';
import { respondToMatchResult, submitMatchResult } from '@/lib/match/results-api';

export type MatchResultPanelProps = {
  match: ResultMatch;
  viewerId: string | null;
  captainTeamIds: Set<string>;
  /** Called after an answer the server took, or when the match moved on. */
  onChanged: () => void;
  /** Shown as "Open match" (Home links to the match screen). */
  onOpen?: () => void;
  /** For tests; defaults to the current time. */
  now?: number;
};

const SCORE = /^\d{1,2}$/;

export function MatchResultPanel({ match, viewerId, captainTeamIds, onChanged, onOpen, now }: MatchResultPanelProps) {
  const [sideA, setSideA] = useState('');
  const [sideB, setSideB] = useState('');
  const [busy, setBusy] = useState<'submit' | 'accept' | 'reject' | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = viewerRole(match, viewerId, captainTeamIds);
  const state = resultState(match, viewerId, captainTeamIds, now ?? Date.now());
  const deadline = formatMatchWhen(match.match.result_deadline_at);
  const label = (side: 'a' | 'b') => match.sides[side].label;

  async function run(kind: 'submit' | 'accept' | 'reject', call: () => PromiseLike<{ error: { message: string } | null }>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    const { error: callError } = await call();
    setBusy(null);
    if (callError) {
      setError(describeMatchResultError(callError));
      if (STALE_RESULT_ERRORS.has(callError.message)) onChanged();
      return;
    }
    setConfirmReject(false);
    setSideA('');
    setSideB('');
    onChanged();
  }

  const submit = () =>
    run('submit', () => submitMatchResult(match.match.id, Number(sideA), Number(sideB)));
  const answer = (accept: boolean) =>
    run(accept ? 'accept' : 'reject', () => respondToMatchResult(match.match.id, accept));

  let body: React.ReactNode = null;
  switch (state.kind) {
    case 'not_started':
      body = <Note>The score can be entered from kickoff.</Note>;
      break;
    case 'enter_score':
      body = (
        <View style={styles.stack}>
          <Note>Enter the score by {deadline}.</Note>
          <View style={styles.row}>
            <View style={styles.flex}>
              <TextField label={label('a')} value={sideA} onChangeText={setSideA} placeholder="0" keyboardType="number-pad" maxLength={2} />
            </View>
            <View style={styles.flex}>
              <TextField label={label('b')} value={sideB} onChangeText={setSideB} placeholder="0" keyboardType="number-pad" maxLength={2} />
            </View>
          </View>
          <Button
            label="Submit score"
            onPress={submit}
            disabled={!SCORE.test(sideA) || !SCORE.test(sideB)}
            loading={busy === 'submit'}
            fullWidth
          />
        </View>
      );
      break;
    case 'waiting_for_score':
      body = <Note>A captain enters the score by {deadline}.</Note>;
      break;
    case 'answer_score':
      body = (
        <View style={styles.stack}>
          <Text variant="headline" tabular>
            {submittedScoreLine(match, state.submission)}
          </Text>
          <Note>
            {label(state.submission.side)} entered this score. Accept or reject it by {deadline}. If nobody answers by
            then, it stands.
          </Note>
          {confirmReject ? (
            <View style={styles.stack}>
              <Note>Reject this score? The match will be disputed and not in stats.</Note>
              <Button label="Reject score" variant="destructive" onPress={() => answer(false)} loading={busy === 'reject'} fullWidth />
              <Button label="Back" variant="plain" onPress={() => setConfirmReject(false)} disabled={busy !== null} />
            </View>
          ) : (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button label="Accept" onPress={() => answer(true)} loading={busy === 'accept'} fullWidth />
              </View>
              <View style={styles.flex}>
                <Button label="Reject" variant="secondary" onPress={() => setConfirmReject(true)} disabled={busy !== null} fullWidth />
              </View>
            </View>
          )}
        </View>
      );
      break;
    case 'no_side':
      body = (
        <View style={styles.stack}>
          <Text variant="headline" tabular>
            {submittedScoreLine(match, state.submission)}
          </Text>
          <Note>
            Only {label(state.submission.side === 'a' ? 'b' : 'a')} players can accept or reject this score, by {deadline}.
          </Note>
        </View>
      );
      break;
    case 'waiting_for_answer':
      body = (
        <View style={styles.stack}>
          <Text variant="headline" tabular>
            {submittedScoreLine(match, state.submission)}
          </Text>
          <Note>
            Waiting for {label(state.answeringSide)} to accept or reject it. If nobody answers by {deadline}, it stands.
          </Note>
        </View>
      );
      break;
    case 'window_closed':
      body = <Note>The time to enter or answer the result has passed.</Note>;
      break;
    case 'confirmed':
    case 'disputed':
    case 'no_result':
    case 'cancelled':
      break;
  }

  return (
    <View testID="match-result-panel" style={styles.stack}>
      <ScoreLine item={toListItem(match, role.playerSide ?? role.captainSide)} />
      {body}
      {error ? <Banner tone="danger" message={error} /> : null}
      {onOpen ? <Button label="Open match" variant="plain" onPress={onOpen} /> : null}
    </View>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Text variant="callout" tone="inkMuted">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  flex: { flex: 1 },
});
