// Balance teams on the match page (docs/specs/match-record.md decision
// 1f.5; 05-product section 4). Only the booker of a pickup sees it, before
// the sides lock. balance_match_teams splits the players by level and
// returns each side's average, shown here; the page then reloads the sides.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { describeLevelError, STALE_LEVEL_ERRORS } from '@/lib/match/level-errors';
import { formatLevel, type BalancedTeams } from '@/lib/match/levels';
import { balanceMatchTeams } from '@/lib/match/levels-api';

export type BalanceTeamsProps = {
  matchId: string;
  /** The side labels, e.g. Bibs and Non-bibs. */
  labels: { a: string; b: string };
  onBalanced: () => void;
};

const average = (side: BalancedTeams['sideA']) =>
  side.players.length === 0 || side.average === null ? 'No players' : `Average level ${formatLevel(side.average)}`;

const count = (n: number) => (n === 1 ? '1 player' : `${n} players`);

export function BalanceTeams({ matchId, labels, onBalanced }: BalanceTeamsProps) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BalancedTeams | null>(null);

  const balance = async () => {
    setSending(true);
    setError(null);
    const { result: teams, error: balanceError } = await balanceMatchTeams(matchId);
    setSending(false);
    if (balanceError || !teams) {
      setError(describeLevelError(balanceError ?? { message: '' }));
      if (balanceError && STALE_LEVEL_ERRORS.has(balanceError.message)) onBalanced();
      return;
    }
    setResult(teams);
    onBalanced();
  };

  return (
    <View style={styles.stack} testID="balance-teams">
      <Text variant="callout" tone="inkMuted">
        Split the players into two sides of about the same level. You can do this until the score is entered.
      </Text>
      {result ? (
        <View testID="balance-result">
          <ListRow title={labels.a} subtitle={count(result.sideA.players.length)} trailing={<Average side={result.sideA} />} />
          <ListRow title={labels.b} subtitle={count(result.sideB.players.length)} trailing={<Average side={result.sideB} />} />
        </View>
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
      <Button
        label={result ? 'Balance again' : 'Balance teams'}
        variant={result ? 'secondary' : 'primary'}
        onPress={balance}
        loading={sending}
        fullWidth
        testID="balance-teams-button"
      />
    </View>
  );
}

function Average({ side }: { side: BalancedTeams['sideA'] }) {
  return (
    <Text variant="callout" tone="inkMuted" tabular>
      {average(side)}
    </Text>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
