// Head-to-head between two named teams (05 section 3, match-record.md
// section 7 and decision 1c.7): played, won, drawn, lost, goals and the last
// 3 meetings, exactly as the head_to_head view gives them, from the
// viewer's team's side. A forfeit is a win or a loss with no goals.
import { StyleSheet, View } from 'react-native';

import { FormChip, spokenForm } from '@/components/match/form-chips';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatMatchDate } from '@/lib/match/format';
import type { HeadToHeadMeeting, HeadToHeadRow } from '@/lib/match/types';
import { useHeadToHead } from '@/lib/match/use-profile-matches';

const DASH = '–';

export type HeadToHeadState =
  | { status: 'loading' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; record: HeadToHeadRow | null };

export type HeadToHeadProps = {
  state: HeadToHeadState;
  teamName: string;
  opponentName: string;
  onRetry: () => void;
};

function Stat({ label, value, testID }: { label: string; value: number | string; testID: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label} ${value}`}>
      <Text testID={testID} variant="headline" tabular>
        {String(value)}
      </Text>
      <Text variant="caption" tone="inkMuted">
        {label}
      </Text>
    </View>
  );
}

function Meeting({ meeting }: { meeting: HeadToHeadMeeting }) {
  const forfeit = meeting.goalsFor === null || meeting.goalsAgainst === null;
  const score = forfeit ? 'Forfeit' : `${meeting.goalsFor} ${DASH} ${meeting.goalsAgainst}`;
  const date = formatMatchDate(meeting.kickoffAt);
  return (
    <View
      testID="h2h-meeting"
      style={styles.meeting}
      accessible
      accessibilityLabel={`${date}, ${spokenForm(meeting.result)}, ${score}`}>
      <FormChip result={meeting.result} />
      <Text variant="body" tabular style={styles.meetingScore}>
        {score}
      </Text>
      <Text variant="caption" tone="inkMuted" tabular>
        {date}
      </Text>
    </View>
  );
}

export function HeadToHead({ state, teamName, opponentName, onRetry }: HeadToHeadProps) {
  if (state.status === 'loading') {
    return (
      <Card>
        <View testID="h2h-skeleton">
          <SkeletonText lines={3} />
        </View>
      </Card>
    );
  }
  if (state.status === 'error') {
    return <Banner tone="danger" message="Couldn’t load the head-to-head." action={{ label: 'Try again', onPress: onRetry }} />;
  }
  const r = state.record;
  if (!r || r.played === 0) {
    return <EmptyState icon="sportscourt.fill" message={`${teamName} haven’t played ${opponentName} yet`} />;
  }
  return (
    <Card>
      <View testID="head-to-head" style={styles.wrap}>
        <Text variant="callout" tone="inkMuted">
          {`${teamName} v ${opponentName}`}
        </Text>
        <View style={styles.stats}>
          <Stat label="Played" value={r.played} testID="h2h-played" />
          <Stat label="Won" value={r.won} testID="h2h-won" />
          <Stat label="Drawn" value={r.drawn} testID="h2h-drawn" />
          <Stat label="Lost" value={r.lost} testID="h2h-lost" />
          <Stat label="Goals" value={`${r.goals_for} ${DASH} ${r.goals_against}`} testID="h2h-goals" />
        </View>
        {r.last_3.length > 0 ? (
          <View style={styles.last}>
            <Text variant="caption" tone="inkMuted">
              Last {r.last_3.length === 1 ? 'meeting' : `${r.last_3.length} meetings`}
            </Text>
            {r.last_3.map((m) => (
              <Meeting key={m.matchId} meeting={m} />
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

/** HeadToHead loading its own data, for a screen that knows the two teams. */
export function TeamHeadToHead({
  teamId,
  opponentTeamId,
  teamName,
  opponentName,
}: {
  teamId: string;
  opponentTeamId: string;
  teamName: string;
  opponentName: string;
}) {
  const h2h = useHeadToHead(teamId, opponentTeamId);
  return <HeadToHead state={h2h} teamName={teamName} opponentName={opponentName} onRetry={h2h.reload} />;
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  stat: { alignItems: 'center', gap: 2 },
  last: { gap: space.sm },
  meeting: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  meetingScore: { flex: 1 },
});
