// S10A admin: one fixture. Its kick-off (a Cyprus day and time; the match
// length is the tournament's), and its result: enter one that was never
// logged, decide a disputed one, or correct one. A level knockout score needs
// the penalty shootout (3 each, then sudden death); the server checks it.
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { StepButton } from '@/components/match/log-score/step-button';
import { Button } from '@/components/ui/button';
import { SectionHeader } from '@/components/ui/section-header';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { adminSetFixtureTime, adminSetResult, type TournamentFixture } from '@/lib/match/tournament-api';
import { describeTournamentError } from '@/lib/match/tournament-errors';
import { cyprusDayTime, cyprusInstant } from '@/lib/match/tournament-form';
import { makeStyles } from '@/lib/theme';

type Pair = { home: number; away: number };

function Stepper({ label, value, onChange, testID }: { label: string; value: number; onChange: (n: number) => void; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.side}>
      <View style={styles.stepper}>
        <StepButton kind="minus" accessibilityLabel={`${label} one fewer`} disabled={value === 0} onPress={() => onChange(Math.max(0, value - 1))} testID={`${testID}-minus`} />
        <Text variant="display" tabular style={styles.number} testID={`${testID}-value`} accessibilityLabel={`${label} ${value}`}>
          {String(value)}
        </Text>
        <StepButton kind="plus" accessibilityLabel={`${label} one more`} onPress={() => onChange(value + 1)} testID={`${testID}-plus`} />
      </View>
      <Text variant="callout" numberOfLines={2} style={styles.centre}>
        {label}
      </Text>
    </View>
  );
}

export function AdminFixtureSheet({
  fixture,
  onClose,
  onDone,
}: {
  /** null: closed. */
  fixture: TournamentFixture | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [score, setScore] = useState<Pair>({ home: 0, away: 0 });
  const [pens, setPens] = useState<Pair>({ home: 0, away: 0 });
  const [busy, setBusy] = useState<'time' | 'result' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fixture) return;
    const when = fixture.kickoffAt ? cyprusDayTime(fixture.kickoffAt) : null;
    setDay(when?.day ?? '');
    setTime(when?.time ?? '');
    setScore({ home: fixture.homeScore ?? 0, away: fixture.awayScore ?? 0 });
    setPens({ home: fixture.homePens ?? 0, away: fixture.awayPens ?? 0 });
    setError(null);
  }, [fixture]);

  if (!fixture) return <Sheet visible={false} onClose={onClose} title="Match" />;

  const home = fixture.homeTeamName ?? 'Home';
  const away = fixture.awayTeamName ?? 'Away';
  const teamsKnown = !!fixture.homeTeamId && !!fixture.awayTeamId;
  const shootout = fixture.stage !== 'group' && score.home === score.away;

  async function run(kind: 'time' | 'result', call: () => Promise<{ error: { message: string } | null }>) {
    setBusy(kind);
    setError(null);
    const { error: callError } = await call();
    setBusy(null);
    if (callError) {
      haptic.error();
      setError(describeTournamentError(callError));
      return;
    }
    haptic.success();
    onDone();
    onClose();
  }

  const saveTime = () => {
    const at = cyprusInstant(day, time);
    if (!at) {
      haptic.error();
      setError(describeTournamentError({ message: 'invalid_kickoff' }));
      return;
    }
    void run('time', () => adminSetFixtureTime(fixture.fixtureId, at));
  };

  const saveResult = () =>
    void run('result', () => adminSetResult(fixture.fixtureId, score.home, score.away, shootout ? pens : null));

  return (
    <Sheet visible onClose={onClose} title={`${home} v ${away}`}>
      <View style={styles.body} testID="admin-fixture-sheet">
        <SectionHeader title="Kick-off" />
        <TextField testID="admin-fixture-day" label="Day" placeholder="YYYY-MM-DD" value={day} onChangeText={setDay} />
        <TextField testID="admin-fixture-time" label="Time" placeholder="HH:MM" value={time} onChangeText={setTime} />
        <Button label="Set time" variant="secondary" onPress={saveTime} loading={busy === 'time'} fullWidth testID="admin-fixture-set-time" />
        {teamsKnown ? (
          <>
            <SectionHeader title="Result" />
            <View style={styles.row}>
              <Stepper label={home} value={score.home} onChange={(n) => setScore((s) => ({ ...s, home: n }))} testID="admin-fixture-home" />
              <Stepper label={away} value={score.away} onChange={(n) => setScore((s) => ({ ...s, away: n }))} testID="admin-fixture-away" />
            </View>
            {shootout ? (
              <>
                <SectionHeader title="Penalties" />
                <View style={styles.row}>
                  <Stepper label={home} value={pens.home} onChange={(n) => setPens((p) => ({ ...p, home: n }))} testID="admin-fixture-home-pens" />
                  <Stepper label={away} value={pens.away} onChange={(n) => setPens((p) => ({ ...p, away: n }))} testID="admin-fixture-away-pens" />
                </View>
              </>
            ) : null}
            <Button label="Save result" onPress={saveResult} loading={busy === 'result'} fullWidth testID="admin-fixture-save-result" />
          </>
        ) : null}
        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="admin-fixture-error">
            {error}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  body: { gap: space.md },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  side: { flex: 1, alignItems: 'center', gap: space.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  number: { minWidth: space.xxl, textAlign: 'center' },
  centre: { textAlign: 'center' },
}));
