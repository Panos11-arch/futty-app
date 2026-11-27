// A league fixture's score entry. Since S10 (match-record.md 1n item 1) a
// fixture gets a match once it has a day and time, and its captains log the
// score in that match's "Log the score" flow; this sends them straight
// there. A fixture made since S10 with no match yet has nothing to score
// (the server would refuse the old form with use_match_flow). Fixtures made
// before S10 keep the old form.
import { router } from 'expo-router';

import { FixtureScoreForm } from '@/components/fixture-score-form';
import { Button } from '@/components/ui/button';
import type { Fixture } from '@/lib/fixtures';
import { useMatchLinks } from '@/lib/match/use-match-result';

export function FixtureScoreEntry({ fixture, onSubmitted }: { fixture: Fixture; onSubmitted: () => void }) {
  const matchLinks = useMatchLinks({ leagueFixtureIds: [fixture.id] });
  if (matchLinks.status !== 'ready') return null;

  const matchId = matchLinks.links.byLeagueFixtureId.get(fixture.id);
  if (matchId) {
    return (
      <Button
        label="Log the score"
        variant="secondary"
        testID={`fixture-log-score-${fixture.id}`}
        onPress={() => router.push({ pathname: '/match/after-game', params: { id: matchId } })}
      />
    );
  }
  if (fixture.match_flow) return null;
  return <FixtureScoreForm fixture={fixture} onSubmitted={onSubmitted} />;
}
