// Steps 2 and 3, Goals and Assists (images 08, 10, 11): the pitch drawn top
// down, the caller's side on the bottom half, each player a circle with
// their name and − / + beside it. Both halves are open only when the caller
// logs both sides (a pickup he booked, or he paid for both sides); otherwise
// the other half is locked with its score only. No positions: where a
// circle stands is only a picture.
import { View } from 'react-native';

import { StepButton } from '@/components/match/log-score/step-button';
import { Avatar } from '@/components/ui/avatar';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import {
  assistsCounter,
  assistsLogged,
  changeAssists,
  changeGoals,
  changeOwnGoals,
  goalsCounter,
  goalsLogged,
  LOCKED_LINE,
  otherSide,
  pitchRows,
  playerKit,
  playerName,
  sideLabel,
  sidePlayers,
  type Draft,
  type MatchLog,
  type MatchLogPlayer,
} from '@/lib/match/log-score';
import type { Side } from '@/lib/match/types';
import { makeStyles, useTheme } from '@/lib/theme';

export type PitchMode = 'goals' | 'assists';

export type PitchStepProps = {
  log: MatchLog;
  draft: Draft;
  mode: PitchMode;
  onChange: (draft: Draft) => void;
};

/** The bottom half is the caller's side (side a when he logs both). */
export function pitchSides(log: Pick<MatchLog, 'writableSides'>): { bottom: Side; top: Side } {
  const bottom = log.writableSides.length === 1 ? log.writableSides[0] : 'a';
  return { bottom, top: otherSide(bottom) };
}

/** The step and pitch ids (Goals keeps the scorers editor's old scorers-editor id). */
const IDS = {
  goals: { step: { testID: 'post-match-step-goals' }, pitch: { testID: 'scorers-editor' } },
  assists: { step: { testID: 'post-match-step-assists' }, pitch: { testID: 'log-score-assists-pitch' } },
} as const;

export function PitchStep({ log, draft, mode, onChange }: PitchStepProps) {
  const styles = useStyles();
  const { top, bottom } = pitchSides(log);
  const title = mode === 'goals' ? 'Goals' : 'Assists';
  return (
    <View style={styles.wrap} {...IDS[mode].step}>
      <View style={styles.titleRow}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        <Text variant="headline" tabular numberOfLines={1} style={styles.scoreLine} testID="log-score-score-line">
          {`${sideLabel(log, 'a')} ${draft.score.a} : ${draft.score.b} ${sideLabel(log, 'b')}`}
        </Text>
      </View>
      <View style={styles.counters}>
        <Counter log={log} draft={draft} side={top} mode={mode} />
        <Counter log={log} draft={draft} side={bottom} mode={mode} alignEnd />
      </View>
      <View style={styles.pitch} {...IDS[mode].pitch}>
        <View style={[styles.box, styles.boxTop]} />
        <Half log={log} draft={draft} side={top} mode={mode} onChange={onChange} at="top" />
        <View style={styles.halfway}>
          <View style={styles.circle} />
        </View>
        <Half log={log} draft={draft} side={bottom} mode={mode} onChange={onChange} at="bottom" />
        <View style={[styles.box, styles.boxBottom]} />
      </View>
    </View>
  );
}

function Counter({
  log,
  draft,
  side,
  mode,
  alignEnd = false,
}: {
  log: MatchLog;
  draft: Draft;
  side: Side;
  mode: PitchMode;
  alignEnd?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const label = sideLabel(log, side);
  const open = log.writableSides.includes(side);
  const done = open && mode === 'goals' && goalsLogged(draft, side) === draft.score[side];
  const text = !open ? `${label} locked` : mode === 'goals' ? `${label} ${goalsCounter(draft, side)}` : `${label} ${assistsCounter(draft, side)}`;
  return (
    <View style={[styles.counter, alignEnd && styles.counterEnd]} testID={`log-score-counter-${side}`}>
      <Text variant="callout" tone={done ? 'positive' : 'ink'} tabular numberOfLines={1}>
        {text}
      </Text>
      {done ? <IconSymbol name="checkmark" size={ICON.small} color={colors.positive} /> : null}
    </View>
  );
}

function Half({
  log,
  draft,
  side,
  mode,
  onChange,
  at,
}: PitchStepProps & { side: Side; at: 'top' | 'bottom' }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const label = sideLabel(log, side);

  if (!log.writableSides.includes(side)) {
    const goals = draft.score[side];
    return (
      <View style={[styles.half, styles.locked]} testID={`log-score-locked-${side}`} accessible accessibilityLabel={`${label} locked. ${LOCKED_LINE}`}>
        <IconSymbol name="lock.fill" size={ICON.regular} color={colors.onNight} />
        <Text variant="headline" tone="onNight" style={styles.centre}>
          {mode === 'goals' ? `${label} · ${goals} ${goals === 1 ? 'goal' : 'goals'}` : `${label} · assists locked`}
        </Text>
        <Text variant="callout" tone="onNightMuted" style={styles.centre}>
          {LOCKED_LINE}
        </Text>
      </View>
    );
  }

  const rows = pitchRows(sidePlayers(log, side));
  // The player in front of the goal stands at the edge of the pitch.
  const ordered = at === 'top' ? rows : [...rows].reverse();
  const tally = mode === 'goals' ? draft.goals[side] : draft.assists[side];
  const full = mode === 'goals' ? goalsLogged(draft, side) >= draft.score[side] : assistsLogged(draft, side) >= draft.score[side];
  const change = (p: MatchLogPlayer, delta: 1 | -1) =>
    onChange(mode === 'goals' ? changeGoals(draft, side, p.playerId, delta) : changeAssists(draft, side, p.playerId, delta));

  return (
    <View style={styles.half} testID={`log-score-half-${side}`}>
      {ordered.map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((p) => (
            <PlayerSpot
              key={p.playerId}
              player={p}
              count={tally[p.playerId] ?? 0}
              mode={mode}
              mine={at === 'bottom'}
              canAdd={!full}
              onChange={(delta) => change(p, delta)}
            />
          ))}
        </View>
      ))}
      {mode === 'goals' ? (
        <OwnGoal
          side={side}
          label={label}
          count={draft.ownGoals[side]}
          canAdd={!full}
          onChange={(delta) => onChange(changeOwnGoals(draft, side, delta))}
        />
      ) : null}
      {mode === 'assists' && at === 'bottom' ? <GoalsLine log={log} draft={draft} side={side} /> : null}
    </View>
  );
}

function PlayerSpot({
  player,
  count,
  mode,
  mine,
  canAdd,
  onChange,
}: {
  player: MatchLogPlayer;
  count: number;
  mode: PitchMode;
  mine: boolean;
  canAdd: boolean;
  onChange: (delta: 1 | -1) => void;
}) {
  const styles = useStyles();
  const name = playerName(player);
  const what = mode === 'goals' ? 'goal' : 'assist';
  return (
    <View style={styles.spot} testID={`log-score-player-${player.playerId}`}>
      <View>
        <View style={[styles.ring, mine && styles.ringMine]}>
          <Avatar name={name} kit={playerKit(player)} size={48} />
        </View>
        {count > 0 ? (
          <View
            style={[styles.bubble, mode === 'goals' ? styles.bubbleGoals : styles.bubbleAssists]}
            testID={`log-score-count-${player.playerId}`}>
            <Text variant="caption" tabular style={mode === 'goals' ? styles.bubbleGoalsText : styles.bubbleAssistsText}>
              {String(count)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="callout" tone="onNight" numberOfLines={1} style={styles.name}>
        {name}
      </Text>
      <View style={styles.steppers}>
        <StepButton
          kind="minus"
          look="pitch"
          accessibilityLabel={`${name}: one ${what} fewer`}
          disabled={count === 0}
          onPress={() => onChange(-1)}
          testID={`log-score-${what}-minus-${player.playerId}`}
        />
        <StepButton
          kind="plus"
          look="pitch"
          accessibilityLabel={`${name}: one ${what} more`}
          disabled={!canAdd}
          onPress={() => onChange(1)}
          testID={`log-score-${what}-plus-${player.playerId}`}
        />
      </View>
    </View>
  );
}

function OwnGoal({
  side,
  label,
  count,
  canAdd,
  onChange,
}: {
  side: Side;
  label: string;
  count: number;
  canAdd: boolean;
  onChange: (delta: 1 | -1) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.ownGoal}>
      {count > 0 ? (
        <StepButton
          kind="minus"
          look="pitch"
          accessibilityLabel={`${label}: one own goal fewer`}
          onPress={() => onChange(-1)}
          testID={`log-score-own-goal-minus-${side}`}
        />
      ) : null}
      <Text
        accessibilityRole="button"
        accessibilityLabel={`${label}: add an own goal`}
        accessibilityState={{ disabled: !canAdd }}
        onPress={canAdd ? () => onChange(1) : undefined}
        variant="callout"
        tone="onNight"
        style={[styles.chip, !canAdd && styles.chipDisabled]}
        testID={`log-score-own-goal-${side}`}>
        {count > 0 ? `Own goal ${count}` : '+ Own goal'}
      </Text>
    </View>
  );
}

/** Under the assists: who scored, for reference ("Goals: Panos 2 · Dimitris 1"). */
function GoalsLine({ log, draft, side }: { log: MatchLog; draft: Draft; side: Side }) {
  const styles = useStyles();
  const scorers = sidePlayers(log, side)
    .filter((p) => (draft.goals[side][p.playerId] ?? 0) > 0)
    .map((p) => `${playerName(p)} ${draft.goals[side][p.playerId]}`);
  if (scorers.length === 0) return null;
  return (
    <Text variant="caption" tone="onNight" style={styles.goalsLine} numberOfLines={2} testID="log-score-goals-line">
      {`Goals: ${scorers.join(' · ')}`}
    </Text>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  wrap: { gap: space.md, paddingHorizontal: space.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  scoreLine: { flexShrink: 1, textAlign: 'right' },
  counters: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  counter: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1 },
  counterEnd: { justifyContent: 'flex-end' },
  pitch: { backgroundColor: colors.pitch, borderRadius: radius.card, overflow: 'hidden' },
  box: {
    alignSelf: 'center',
    width: '40%',
    height: space.xxl + space.xl,
    borderColor: colors.pitchLine,
    borderWidth: 2,
    position: 'absolute',
  },
  boxTop: { top: -2 },
  boxBottom: { bottom: -2 },
  halfway: { height: 2, backgroundColor: colors.pitchLine, alignItems: 'center', justifyContent: 'center' },
  circle: {
    width: space.xxl * 3,
    height: space.xxl * 3,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.pitchLine,
    position: 'absolute',
  },
  half: { paddingVertical: space.lg, paddingHorizontal: space.md, gap: space.lg, minHeight: space.xxl * 8 },
  locked: { backgroundColor: colors.night, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  centre: { textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  spot: { alignItems: 'center', gap: space.xs, width: '45%' },
  ring: { borderRadius: radius.pill },
  ringMine: { borderWidth: 2, borderColor: colors.green },
  name: { maxWidth: '100%' },
  steppers: { flexDirection: 'row', gap: space.sm },
  bubble: {
    position: 'absolute',
    top: -space.xs,
    right: -space.sm,
    minWidth: space.xl,
    height: space.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  bubbleGoals: { backgroundColor: colors.ratingTop },
  bubbleGoalsText: { color: colors.onRatingTop },
  bubbleAssists: { backgroundColor: colors.infoLight },
  bubbleAssistsText: { color: colors.info },
  ownGoal: { flexDirection: 'row', alignSelf: 'flex-end', alignItems: 'center', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.onNight,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + space.xs / 2,
    minHeight: MIN_TOUCH,
    textAlignVertical: 'center',
    overflow: 'hidden',
  },
  chipDisabled: { opacity: 0.4 },
  goalsLine: { alignSelf: 'flex-end' },
}));
