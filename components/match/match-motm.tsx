// Man of the match on the match page (match-record.md 4.7, 5.3, decisions
// 1b.2, 1e.2, 1e.3). While voting is open a checked-in player picks one
// other checked-in player and votes once; the page then says who they voted
// for. The result appears only once voting closes: every tied leader, with
// their vote count. Nobody ever sees who voted for whom.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SectionError } from '@/components/match/page-section';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatMatchWhen } from '@/lib/match/format';
import { motmView, playerName, type MatchPage } from '@/lib/match/page';
import { castMotmVote } from '@/lib/match/page-api';
import { describeMatchPageError, STALE_PAGE_ERRORS } from '@/lib/match/page-errors';
import type { RosterState } from '@/components/match/match-scorers';

export type MatchMotmProps = {
  page: MatchPage;
  roster: RosterState | null;
  onRetryRoster: () => void;
  viewerId: string | null;
  onVoted: () => void;
  now?: number;
};

const votesText = (n: number) => (n === 1 ? '1 vote' : `${n} votes`);

export function MatchMotm({ page, roster, onRetryRoster, viewerId, onVoted, now = Date.now() }: MatchMotmProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Members wait for the squad to know whether they can vote; strangers never can.
  if (roster && roster.status === 'loading' && page.motmOpen && !page.myVote) {
    return (
      <View testID="motm-roster-skeleton">
        <SkeletonText lines={3} />
      </View>
    );
  }
  if (roster && roster.status === 'error' && page.motmOpen && !page.myVote) {
    return <SectionError message="Could not load the squad." onRetry={onRetryRoster} />;
  }

  const view = motmView(page, roster?.status === 'ready' ? roster.roster : null, viewerId, now);

  switch (view.kind) {
    case 'none':
      return null;

    case 'closed':
      if (view.winners.length === 0) return <EmptyState icon="star.fill" message="No votes were cast." />;
      return (
        <View style={styles.stack} testID="motm-result">
          {view.winners.length > 1 ? (
            <Text variant="callout" tone="inkMuted">
              Shared between {view.winners.length} players
            </Text>
          ) : null}
          {view.winners.map((w) => (
            <ListRow
              key={w.playerId}
              title={playerName(w)}
              leading={{ avatar: { name: playerName(w) } }}
              trailing={
                <Text variant="callout" tone="inkMuted" tabular>
                  {votesText(w.votes)}
                </Text>
              }
            />
          ))}
        </View>
      );

    case 'voted':
      return (
        <View style={styles.stack}>
          <Text variant="headline">{view.name ? `You voted for ${view.name}` : 'You voted'}</Text>
          <Text variant="callout" tone="inkMuted" tabular>
            {`The man of the match is shown when voting closes, ${formatMatchWhen(view.closesAt)}.`}
          </Text>
        </View>
      );

    case 'open':
      return (
        <Text variant="callout" tone="inkMuted" tabular>
          {`Voting is open until ${formatMatchWhen(view.closesAt)}. Players who checked in vote.`}
        </Text>
      );

    case 'vote': {
      const nominee = view.nominees.find((p) => p.id === picked) ?? null;
      const vote = async () => {
        if (!nominee) return;
        setSending(true);
        setError(null);
        const { error: voteError } = await castMotmVote(page.matchId, nominee.id);
        setSending(false);
        if (voteError) {
          setError(describeMatchPageError(voteError));
          if (STALE_PAGE_ERRORS.has(voteError.message)) onVoted();
          return;
        }
        onVoted();
      };
      if (view.nominees.length === 0) {
        return <EmptyState icon="star.fill" message="Nobody else has checked in yet." />;
      }
      return (
        <View style={styles.stack} testID="motm-vote">
          <Text variant="callout" tone="inkMuted" tabular>
            {`Pick one player. You can vote once, until ${formatMatchWhen(view.closesAt)}.`}
          </Text>
          <View>
            {view.nominees.map((p) => (
              <ListRow
                key={p.id}
                title={p.name}
                leading={{ avatar: { name: p.name } }}
                trailing={
                  picked === p.id ? (
                    <Text variant="callout" tone="brand">
                      Picked
                    </Text>
                  ) : undefined
                }
                onPress={() => setPicked(p.id)}
                accessibilityLabel={picked === p.id ? `${p.name}, picked` : p.name}
                testID={`nominee-${p.id}`}
              />
            ))}
          </View>
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            label={nominee ? `Vote for ${nominee.name}` : 'Pick a player'}
            onPress={vote}
            disabled={!nominee}
            loading={sending}
            fullWidth
            testID="cast-vote"
          />
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
