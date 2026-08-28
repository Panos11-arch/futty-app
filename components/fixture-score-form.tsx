import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
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

  return (
    <View style={styles.scoreForm}>
      <Text style={styles.scoreFormTitle}>
        {fixture.home_team?.name ?? 'Team'} vs {fixture.away_team?.name ?? 'Team'}
      </Text>
      <View style={styles.scoreInputsRow}>
        <AuthField
          value={homeScore}
          onChangeText={setHomeScore}
          placeholder="0"
          keyboardType="number-pad"
          style={styles.scoreInput}
        />
        <Text style={styles.scoreDash}>–</Text>
        <AuthField
          value={awayScore}
          onChangeText={setAwayScore}
          placeholder="0"
          keyboardType="number-pad"
          style={styles.scoreInput}
        />
        <AuthButton
          label="Log score"
          onPress={submit}
          disabled={!homeScore.trim() || !awayScore.trim()}
          busy={busy}
        />
      </View>
      {error ? <AuthError>{error}</AuthError> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  scoreForm: {
    gap: 6,
  },
  scoreFormTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  scoreInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scoreInput: {
    width: 48,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  scoreDash: {
    opacity: 0.6,
  },
});
