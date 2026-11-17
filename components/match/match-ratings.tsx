// Player ratings on the match page (docs/specs/match-record.md decision
// 1f.4; 05-product section 4). After confirmation, while the window is open,
// a checked-in player rates each other checked-in player 1 to 10, once each,
// never themselves; a rated player then shows "Rated". Once the window
// closes, each player's match rating shows only when the server returns it
// (3 or more ratings). Individual ratings are never shown.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { SectionError } from '@/components/match/page-section';
import type { RosterState } from '@/components/match/match-scorers';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { formatMatchWhen } from '@/lib/match/format';
import { describeLevelError, STALE_LEVEL_ERRORS } from '@/lib/match/level-errors';
import { formatLevel, ratingsView, type MatchRatings } from '@/lib/match/levels';
import { rateMatchPlayer } from '@/lib/match/levels-api';

export type MatchRatingsProps = {
  matchId: string;
  ratings: MatchRatings;
  /** profile id → name, for the ratings the server returned. */
  names: Record<string, string>;
  roster: RosterState | null;
  onRetryRoster: () => void;
  viewerId: string | null;
  onRated: () => void;
};

const SCORES = Array.from({ length: 10 }, (_, i) => i + 1);

export function MatchRatingsPanel({ matchId, ratings, names, roster, onRetryRoster, viewerId, onRated }: MatchRatingsProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Members wait for the squad to know whom they can rate; strangers never can.
  if (ratings.ratingsOpen && roster?.status === 'loading') {
    return (
      <View testID="ratings-roster-skeleton">
        <SkeletonText lines={3} />
      </View>
    );
  }
  if (ratings.ratingsOpen && roster?.status === 'error') {
    return <SectionError message="Could not load the squad." onRetry={onRetryRoster} />;
  }

  const view = ratingsView(ratings, roster?.status === 'ready' ? roster.roster : null, viewerId);

  switch (view.kind) {
    case 'none':
      return null;

    case 'closed':
      if (view.players.length === 0) {
        return <EmptyState icon="star.fill" message="Not enough ratings to show." />;
      }
      return (
        <View testID="ratings-result">
          {view.players.map((p) => (
            <ListRow
              key={p.playerId}
              title={names[p.profileId] ?? 'Player'}
              leading={{ avatar: { name: names[p.profileId] ?? 'Player' } }}
              trailing={
                <Text variant="headline" tabular>
                  {formatLevel(p.rating)}
                </Text>
              }
              testID={`rating-${p.playerId}`}
            />
          ))}
        </View>
      );

    case 'open':
      return (
        <Text variant="callout" tone="inkMuted" tabular>
          {`Ratings are open until ${formatMatchWhen(view.closesAt)}. Players who checked in rate each other.`}
        </Text>
      );

    case 'rate': {
      if (view.players.length === 0) {
        return <EmptyState icon="star.fill" message="Nobody else has checked in yet." />;
      }
      const player = view.players.find((p) => p.id === picked && !p.rated) ?? null;
      const send = async () => {
        if (!player || score === null) return;
        setSending(true);
        setError(null);
        const { error: rateError } = await rateMatchPlayer(matchId, player.id, score);
        setSending(false);
        if (rateError) {
          setError(describeLevelError(rateError));
          if (STALE_LEVEL_ERRORS.has(rateError.message)) onRated();
          return;
        }
        setPicked(null);
        setScore(null);
        onRated();
      };
      return (
        <View style={styles.stack} testID="ratings-rate">
          <Text variant="callout" tone="inkMuted" tabular>
            {`Rate each player from 1 to 10, once, until ${formatMatchWhen(view.closesAt)}. Nobody sees who gave which rating.`}
          </Text>
          <View>
            {view.players.map((p) => (
              <ListRow
                key={p.id}
                title={p.name}
                leading={{ avatar: { name: p.name } }}
                trailing={
                  p.rated ? (
                    <Text variant="callout" tone="inkMuted">
                      Rated
                    </Text>
                  ) : picked === p.id ? (
                    <Text variant="callout" tone="brand">
                      Rating
                    </Text>
                  ) : undefined
                }
                onPress={
                  p.rated
                    ? undefined
                    : () => {
                        setPicked(p.id);
                        setScore(null);
                        setError(null);
                      }
                }
                accessibilityLabel={p.rated ? `${p.name}, rated` : `Rate ${p.name}`}
                testID={`rate-${p.id}`}
              />
            ))}
          </View>
          {player ? (
            <View style={styles.stack} testID="rating-picker">
              <Text variant="headline">{`Rate ${player.name}`}</Text>
              <View style={styles.chips}>
                {SCORES.map((s) => (
                  <Chip
                    key={s}
                    label={String(s)}
                    selected={score === s}
                    onPress={() => setScore(s)}
                    tabular
                    testID={`score-${s}`}
                  />
                ))}
              </View>
              <Button
                label={score === null ? 'Pick a rating' : `Give ${player.name} ${score}`}
                onPress={send}
                disabled={score === null}
                loading={sending}
                fullWidth
                testID="save-rating"
              />
            </View>
          ) : null}
          {error ? <Banner tone="danger" message={error} /> : null}
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
