// Game type on the match page: Competitive or Friendly (decided by Panos
// 25 November, docs/specs/match-record.md decision 1l item 11). Every game is
// Competitive by default. Everyone in the match sees which it is; the booker
// (in a named game either captain) can switch it while the match is
// scheduled and before kickoff (set_match_competitive checks again); after
// that it is read-only. A Friendly game never moves levels.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner } from '@/components/ui/banner';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { describeLevelError, STALE_LEVEL_ERRORS } from '@/lib/match/level-errors';
import { competitiveView } from '@/lib/match/levels';
import { setMatchCompetitive } from '@/lib/match/levels-api';
import type { ResultMatch } from '@/lib/match/result';
import type { Side } from '@/lib/match/types';

export type MatchCompetitiveProps = {
  match: ResultMatch;
  /** The side the viewer captains, or null. */
  captainSide: Side | null;
  onChanged: () => void;
  now?: number;
};

type Choice = 'competitive' | 'friendly';

const OPTIONS: { value: Choice; label: string }[] = [
  { value: 'competitive', label: 'Competitive' },
  { value: 'friendly', label: 'Friendly' },
];

export function MatchCompetitive({ match, captainSide, onChanged, now = Date.now() }: MatchCompetitiveProps) {
  const view = competitiveView(match, captainSide, now);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (choice: Choice) => {
    const competitive = choice === 'competitive';
    if (sending || competitive === view.isCompetitive) return;
    setSending(true);
    setError(null);
    const { error: changeError } = await setMatchCompetitive(match.match.id, competitive);
    setSending(false);
    if (changeError) {
      setError(describeLevelError(changeError));
      if (STALE_LEVEL_ERRORS.has(changeError.message)) onChanged();
      return;
    }
    onChanged();
  };

  return (
    <View style={styles.stack} testID="match-competitive">
      <Text variant="headline" testID="competitive-label">
        {view.isCompetitive ? 'Competitive' : 'Friendly'}
      </Text>
      <Text variant="callout" tone="inkMuted">
        {view.isCompetitive ? 'The result counts towards player levels.' : "The result doesn't change player levels."}
      </Text>
      {view.editable ? (
        <View style={styles.stack} testID="competitive-switch">
          <SegmentedControl
            options={OPTIONS}
            value={view.isCompetitive ? 'competitive' : 'friendly'}
            onChange={change}
            accessibilityLabel="Competitive or Friendly"
          />
          <Text variant="caption" tone="inkMuted">
            Captains can change this until kickoff.
          </Text>
        </View>
      ) : null}
      {error ? <Banner tone="danger" message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
});
