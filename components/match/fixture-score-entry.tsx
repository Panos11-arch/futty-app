// A league fixture's score entry. A fixture with a match (made since A2) is
// scored in the match screen with submit_match_result and
// respond_to_match_result; a fixture recorded before A2 keeps the old form.
// No fixture is linked to a match yet (docs/specs/match-record.md 1a.8), so
// today this always shows the old form once the check has loaded.
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
        label="Enter or check the result"
        variant="secondary"
        onPress={() => router.push({ pathname: '/match/[id]', params: { id: matchId } })}
      />
    );
  }
  return <FixtureScoreForm fixture={fixture} onSubmitted={onSubmitted} />;
}
