// Scorers and assists on the match page (match-record.md 4.6, 5.3, decision
// 1e.1 and 1e.6). Everyone who can see the page sees them; a side's captain
// (the booker for both sides of a pickup) enters their side's goals while
// scorersOpenUntil is in the future. Save stays off until the goals add up to
// the score. set_match_goals checks it all again.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SectionError } from '@/components/match/page-section';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatMatchWhen } from '@/lib/match/format';
import {
  goalsReady,
  OWN_GOAL_OR_UNKNOWN,
  playerName,
  scorersOpen,
  sideOf,
  sidePlayers,
  type MatchPage,
  type RosterPlayer,
} from '@/lib/match/page';
import { setMatchGoals } from '@/lib/match/page-api';
import { describeMatchPageError, STALE_PAGE_ERRORS } from '@/lib/match/page-errors';
import type { Side } from '@/lib/match/types';
import type { Loadable } from '@/lib/match/use-match-result';

export type RosterState = Loadable<{ roster: RosterPlayer[] }>;

export type MatchScorersProps = {
  page: MatchPage;
  /** The squad; null for someone outside the match (never an editor). */
  roster: RosterState | null;
  onRetryRoster: () => void;
  /** The sides the viewer may write (writerSides). */
  writable: Side[];
  onSaved: () => void;
  now?: number;
};

/** undefined: no choice made yet; null: own goal or unknown. */
type DraftGoal = { scorer: string | null | undefined; assist: string | null };

const OWN = 'own';

function draftFor(page: MatchPage, side: Side): DraftGoal[] {
  return page.goals
    .filter((g) => g.side === side)
    .map((g) => ({ scorer: g.scorer?.playerId ?? null, assist: g.assist?.playerId ?? null }));
}

export function MatchScorers({ page, roster, onRetryRoster, writable, onSaved, now = Date.now() }: MatchScorersProps) {
  const [editing, setEditing] = useState(false);
  const [side, setSide] = useState<Side>(writable[0] ?? 'a');
  const [draft, setDraft] = useState<DraftGoal[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = writable.length > 0 && scorersOpen(page, now);

  const startEditing = (s: Side) => {
    setSide(s);
    setDraft(draftFor(page, s));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error: saveError } = await setMatchGoals(
      page.matchId,
      draft.map((g) => ({ scorerPlayerId: g.scorer ?? null, assistPlayerId: g.scorer ? g.assist : null })),
      writable.length > 1 ? side : undefined
    );
    setSaving(false);
    if (saveError) {
      setError(describeMatchPageError(saveError));
      if (STALE_PAGE_ERRORS.has(saveError.message)) onSaved();
      return;
    }
    setEditing(false);
    onSaved();
  };

  if (editing) {
    const score = sideOf(page, side).score;
    const update = (i: number, goal: Partial<DraftGoal>) =>
      setDraft((d) => d.map((g, j) => (j === i ? { ...g, ...goal } : g)));
    let squad: React.ReactNode;
    if (!roster || roster.status === 'loading') {
      squad = (
        <View testID="scorers-roster-skeleton">
          <SkeletonText lines={3} />
        </View>
      );
    } else if (roster.status === 'error') {
      squad = <SectionError message="Could not load the squad." onRetry={onRetryRoster} />;
    } else {
      const players = sidePlayers(roster.roster, side);
      squad = (
        <View style={styles.stack}>
          {draft.map((goal, i) => (
            <View key={i} style={styles.goal} testID={`goal-${i}`}>
              <View style={styles.goalHeader}>
                <Text variant="headline">{`Goal ${i + 1}`}</Text>
                <Button label="Remove goal" variant="plain" onPress={() => setDraft((d) => d.filter((_, j) => j !== i))} />
              </View>
              <Text variant="callout" tone="inkMuted">
                Scorer
              </Text>
              <View style={styles.chips}>
                {players.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    selected={goal.scorer === p.id}
                    onPress={() => update(i, { scorer: p.id, assist: goal.assist === p.id ? null : goal.assist })}
                    testID={`scorer-${i}-${p.id}`}
                  />
                ))}
                <Chip
                  label={OWN_GOAL_OR_UNKNOWN}
                  selected={goal.scorer === null}
                  onPress={() => update(i, { scorer: null, assist: null })}
                  testID={`scorer-${i}-${OWN}`}
                />
              </View>
              {goal.scorer ? (
                <>
                  <Text variant="callout" tone="inkMuted">
                    Assist
                  </Text>
                  <View style={styles.chips}>
                    <Chip label="No assist" selected={goal.assist === null} onPress={() => update(i, { assist: null })} />
                    {players
                      .filter((p) => p.id !== goal.scorer)
                      .map((p) => (
                        <Chip
                          key={p.id}
                          label={p.name}
                          selected={goal.assist === p.id}
                          onPress={() => update(i, { assist: p.id })}
                          testID={`assist-${i}-${p.id}`}
                        />
                      ))}
                  </View>
                </>
              ) : null}
            </View>
          ))}
          <Button
            label="Add goal"
            testID="add-goal"
            variant="secondary"
            disabled={score === null || draft.length >= score}
            onPress={() => setDraft((d) => [...d, { scorer: undefined, assist: null }])}
          />
        </View>
      );
    }

    return (
      <View style={styles.stack} testID="scorers-editor">
        {writable.length > 1 ? (
          <SegmentedControl
            accessibilityLabel="Which side's scorers"
            options={writable.map((s) => ({ value: s, label: sideOf(page, s).label }))}
            value={side}
            onChange={(s) => {
              setSide(s);
              setDraft(draftFor(page, s));
              setError(null);
            }}
          />
        ) : null}
        <Text variant="callout" tone="inkMuted" tabular>
          {`${draft.length} of ${score ?? 0} goals added. The number of goals must match the score.`}
        </Text>
        {squad}
        {error ? <Banner tone="danger" message={error} /> : null}
        <Button
          label="Save scorers"
          onPress={save}
          loading={saving}
          disabled={!goalsReady(draft, score) || roster?.status !== 'ready'}
          fullWidth
          testID="save-scorers"
        />
        <Button label="Cancel" variant="plain" onPress={() => setEditing(false)} />
      </View>
    );
  }

  return (
    <View style={styles.stack} testID="scorers">
      {(['a', 'b'] as const).map((s) => {
        const { label, score } = sideOf(page, s);
        const goals = page.goals.filter((g) => g.side === s);
        return (
          <View key={s} style={styles.side}>
            <Text variant="headline" tabular>{`${label} ${score ?? ''}`.trim()}</Text>
            {goals.length > 0 ? (
              goals.map((g, i) => (
                <Text key={i} variant="body">
                  {g.assist ? `${playerName(g.scorer)} · assist ${playerName(g.assist)}` : playerName(g.scorer)}
                </Text>
              ))
            ) : (
              <Text variant="callout" tone="inkMuted">
                {score === 0 ? 'No goals' : 'No scorers added yet'}
              </Text>
            )}
            {canEdit && writable.includes(s) && score !== 0 ? (
              <Button
                label={goals.length > 0 ? `Edit ${label} scorers` : `Add ${label} scorers`}
                variant="secondary"
                onPress={() => startEditing(s)}
              />
            ) : null}
          </View>
        );
      })}
      {canEdit && page.scorersOpenUntil ? (
        <Text variant="caption" tone="inkMuted" tabular>
          {`Scorers can be added until ${formatMatchWhen(page.scorersOpenUntil)}.`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  side: { gap: space.xs },
  goal: { gap: space.sm },
  goalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
