import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthField } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { space, tabular } from '@/constants/futty-theme';
import { submitFixtureScore, type Fixture } from '@/lib/fixtures';
import { describeLeagueError } from '@/lib/league-errors';

/** Shared by the home screen, the League tab's "Your fixtures" teaser, and
 *  the full upcoming-fixtures list — same submit form wherever
 *  canLogFixtureScore says a captain can log this fixture's result. */
export function FixtureScoreForm({ fixture, onSubmitted }: { fixture: Fixture; onSubmitted: () => void }) {
  const [homeScore, setHomeScore] = useState('');
  const [awayScore, setAwayScore] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!homeScore.trim() || !awayScore.trim() || busy) return;

    setBusy(true);
    setError(null);
    const { error: submitError } = await submitFixtureScore(fixture.id, Number(homeScore), Number(awayScore));
    setBusy(false);

    if (submitError) {
      setError(describeLeagueError(submitError));
    } else {
      setHomeScore('');
      setAwayScore('');
      onSubmitted();
    }
  }

  const homeName = fixture.home_team?.name ?? 'Team';
  const awayName = fixture.away_team?.name ?? 'Team';

  return (
    <View style={styles.form}>
      <Text variant="callout">
        {homeName} vs {awayName}
      </Text>
      <View style={styles.inputsRow}>
        <AuthField
          value={homeScore}
          onChangeText={setHomeScore}
          placeholder="0"
          keyboardType="number-pad"
          accessibilityLabel={`${homeName} score`}
          style={styles.scoreInput}
        />
        <Text variant="body" tone="inkMuted">
          –
        </Text>
        <AuthField
          value={awayScore}
          onChangeText={setAwayScore}
          placeholder="0"
          keyboardType="number-pad"
          accessibilityLabel={`${awayName} score`}
          style={styles.scoreInput}
        />
        <Button
          label="Log score"
          onPress={submit}
          disabled={!homeScore.trim() || !awayScore.trim()}
          loading={busy}
        />
      </View>
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.sm },
  inputsRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  scoreInput: { width: space.xxl + space.lg, textAlign: 'center', paddingHorizontal: space.sm, ...tabular },
});
