// Power rankings: this competition's teams in the order of their app-wide
// points for its format (match-record.md 1n item 8; no separate count), with
// the change of place since Monday. S15's rows and breakdown, unchanged.
import { PowerRankingRows } from '@/components/match/power-ranking-list';
import { toPowerRankingRows } from '@/lib/match/competition-api';
import { useCompetitionPowerRanking } from '@/lib/match/use-competition';

export function PowerTab({ seasonId, format, onSeeStandings }: { seasonId: string; format: string; onSeeStandings: () => void }) {
  const power = useCompetitionPowerRanking(seasonId);
  const state =
    power.status === 'ready' ? { status: 'ready' as const, rows: toPowerRankingRows(power.rows) } : { status: power.status };
  return (
    <PowerRankingRows
      state={state}
      reload={power.reload}
      format={format}
      empty={{ message: 'No ranked teams yet', action: { label: 'See standings', onPress: onSeeStandings } }}
    />
  );
}
