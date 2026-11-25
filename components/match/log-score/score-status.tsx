// Two captains (decided 22 November): after logging, the caller waits for
// the other captain, or their scores differ and he can change his (up to 3
// tries; the first matching pair confirms the match).
//
// "Message <captain>" (follow-up to S13): below Change score, the chat
// between the current captains of the two teams of this match, even outside
// a league. Only for a game between two teams; the server decides the rest.
import { View } from 'react-native';

import { MessageCaptainButton } from '@/components/match/log-score/message-captain-button';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { sideLabel, triesLeft, type MatchLog, type Score } from '@/lib/match/log-score';
import { makeStyles } from '@/lib/theme';

export const MISMATCH_LINE = "Scores don't match. Check with their captain.";
export const WAITING_LINE = "Their captain hasn't logged the score yet.";

function ScoreRow({ log, title, score, testID }: { log: MatchLog; title: string; score: Score; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row} testID={testID}>
      <Text variant="callout" tone="inkMuted">
        {title}
      </Text>
      <Text variant="headline" tabular>{`${sideLabel(log, 'a')} ${score.a} : ${score.b} ${sideLabel(log, 'b')}`}</Text>
    </View>
  );
}

export function ScoreMismatch({ log, onChange }: { log: MatchLog; onChange: () => void }) {
  const styles = useStyles();
  const left = triesLeft(log);
  return (
    <View style={styles.wrap} testID="log-score-mismatch">
      <Text variant="display" accessibilityRole="header">
        Scores differ
      </Text>
      <Card>
        <View style={styles.rows}>
          {log.myEntry ? <ScoreRow log={log} title="Your score" score={log.myEntry} testID="log-score-mine" /> : null}
          {log.theirEntry ? <ScoreRow log={log} title="Their captain" score={log.theirEntry} testID="log-score-theirs" /> : null}
        </View>
      </Card>
      <Text variant="callout" tone="danger" accessibilityRole="alert">
        {MISMATCH_LINE}
      </Text>
      <Text variant="callout" tone="inkMuted" tabular testID="log-score-tries">
        {left === 1 ? '1 try left' : `${left} tries left`}
      </Text>
      <View style={styles.actions}>
        <Button label="Change score" onPress={onChange} fullWidth testID="log-score-change" />
        {bothTeams(log) ? <MessageCaptainButton matchId={log.matchId} /> : null}
      </View>
    </View>
  );
}

/** A game between two teams: each side has one. */
function bothTeams(log: MatchLog): boolean {
  return log.sides.length === 2 && log.sides.every((s) => !!s.teamId);
}

export function ScoreWaiting({ log, onChange, onOpenMatch }: { log: MatchLog; onChange: () => void; onOpenMatch: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.wrap} testID="log-score-waiting">
      <Text variant="display" accessibilityRole="header">
        Score logged
      </Text>
      {log.myEntry ? (
        <Card>
          <ScoreRow log={log} title="Your score" score={log.myEntry} testID="log-score-mine" />
        </Card>
      ) : null}
      <Text variant="callout" tone="inkMuted">
        {WAITING_LINE}
      </Text>
      <View style={styles.actions}>
        <Button label="Open match" onPress={onOpenMatch} fullWidth testID="post-match-open-match" />
        <Button label="Change score" variant="secondary" onPress={onChange} fullWidth testID="log-score-change" />
      </View>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.lg, padding: space.lg },
  rows: { gap: space.md },
  row: { gap: space.xs },
  actions: { gap: space.sm },
}));
