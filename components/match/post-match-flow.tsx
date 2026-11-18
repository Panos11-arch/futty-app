// The post-match flow (A10; docs/specs/match-record.md decision 1j): an intro,
// then one step at a time: the score, goals and assists, the man of the match
// vote and ratings. Each step reuses the match page's own panel, so every
// write goes through the same functions with the same checks. Every step can
// be skipped; Done on the last step goes back to the match.
//
// The steps are worked out once, when the flow opens, so the list doesn't
// shift as the data reloads after each save.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MatchMotm } from '@/components/match/match-motm';
import { MatchRatingsPanel } from '@/components/match/match-ratings';
import { MatchScorers, type RosterState } from '@/components/match/match-scorers';
import { MatchResultPanel } from '@/components/match/result-panel';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import type { MatchRatings } from '@/lib/match/levels';
import { writerSides, type MatchPage } from '@/lib/match/page';
import {
  NOT_OPEN_YET,
  POST_MATCH_INTRO,
  postMatchSteps,
  WAITING_FOR_CAPTAIN,
  type PostMatchStep,
  type PostMatchStepName,
} from '@/lib/match/post-match';
import type { ResultMatch } from '@/lib/match/result';

export type PostMatchFlowProps = {
  match: ResultMatch;
  page: MatchPage | null;
  roster: RosterState | null;
  /** get_match_ratings with names; null before the match is confirmed. */
  ratings: { ratings: MatchRatings; names: Record<string, string> } | null;
  viewerId: string | null;
  captainTeamIds: Set<string>;
  /** After a save, or when the match moved on: reload the match, page, squad and ratings. */
  onChanged: () => void;
  onRetryRoster: () => void;
  /** Skip on the intro, or Done (or Skip) on the last step: back to the match. */
  onDone: () => void;
  now?: number;
};

const TITLES: Record<PostMatchStepName, string> = {
  score: 'The score',
  goals: 'Goals and assists',
  motm: 'Man of the match',
  ratings: 'Player ratings',
};

export function PostMatchFlow(props: PostMatchFlowProps) {
  const { match, page, roster, ratings, viewerId, captainTeamIds, onChanged, onRetryRoster, onDone } = props;
  const now = props.now ?? Date.now();
  const [steps] = useState<PostMatchStep[]>(() =>
    postMatchSteps(
      {
        match,
        page,
        roster: roster?.status === 'ready' ? roster.roster : null,
        ratings: ratings?.ratings ?? null,
        viewerId,
        captainTeamIds,
      },
      now
    )
  );
  const [index, setIndex] = useState<number | null>(null);

  if (steps.length === 0) {
    return (
      <Card>
        <View style={styles.stack} testID="post-match-nothing">
          <EmptyState icon="sportscourt.fill" message="Nothing to add for this match." />
          <Button label="Open match" onPress={onDone} fullWidth testID="post-match-open-match" />
        </View>
      </Card>
    );
  }

  if (index === null) {
    return (
      <Card>
        <View style={styles.stack} testID="post-match-intro">
          <Text variant="title" accessibilityRole="header">
            After the game
          </Text>
          <Text variant="body">{POST_MATCH_INTRO}</Text>
          <Button label="Start" onPress={() => setIndex(0)} fullWidth testID="post-match-start" />
          <Button label="Skip" variant="plain" onPress={onDone} testID="post-match-skip" />
        </View>
      </Card>
    );
  }

  const current = steps[index];
  const last = index === steps.length - 1;
  const next = () => (last ? onDone() : setIndex(index + 1));

  let body: React.ReactNode;
  if (current.state === 'not_open') {
    body = <Note>{NOT_OPEN_YET}</Note>;
  } else if (current.state === 'waiting') {
    body = <Note>{WAITING_FOR_CAPTAIN}</Note>;
  } else if (current.step === 'score') {
    body = (
      <MatchResultPanel match={match} viewerId={viewerId} captainTeamIds={captainTeamIds} onChanged={onChanged} now={now} />
    );
  } else if (current.step === 'goals' && page) {
    body = (
      <MatchScorers
        page={page}
        roster={roster}
        onRetryRoster={onRetryRoster}
        writable={writerSides(match, viewerId, captainTeamIds)}
        onSaved={onChanged}
        now={now}
      />
    );
  } else if (current.step === 'motm' && page) {
    body = (
      <MatchMotm page={page} roster={roster} onRetryRoster={onRetryRoster} viewerId={viewerId} onVoted={onChanged} now={now} />
    );
  } else if (current.step === 'ratings' && ratings) {
    body = (
      <MatchRatingsPanel
        matchId={match.match.id}
        ratings={ratings.ratings}
        names={ratings.names}
        roster={roster}
        onRetryRoster={onRetryRoster}
        viewerId={viewerId}
        onRated={onChanged}
      />
    );
  }

  return (
    <View style={styles.stack} testID={`post-match-step-${current.step}`}>
      <Text variant="callout" tone="inkMuted" tabular>
        {`Step ${index + 1} of ${steps.length}`}
      </Text>
      <Text variant="title" accessibilityRole="header">
        {TITLES[current.step]}
      </Text>
      <Card>{body}</Card>
      {last ? (
        <Button label="Done" onPress={onDone} fullWidth testID="post-match-done" />
      ) : (
        <Button label="Next" onPress={next} fullWidth testID="post-match-next" />
      )}
      <Button label="Skip" variant="plain" onPress={next} testID="post-match-skip" />
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
});
