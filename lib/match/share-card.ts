// A6 share cards (docs/specs/05-product.md section 6, cut down for launch):
// what the result and man-of-the-match cards show, taken unchanged from
// get_match_page. Nothing here is computed: no counting goals, no deciding a
// winner. Only a confirmed match with a score (not a forfeit) has a card.
import { formatMatchWhen } from '@/lib/match/format';
import { playedMatch, playerName, sideOf, type MatchPage } from '@/lib/match/page';
import type { Side } from '@/lib/match/types';

export type ShareCardSide = { label: string; score: number; scorers: string[] };

export type ShareCardData = {
  matchId: string;
  a: ShareCardSide;
  b: ShareCardSide;
  /** Every tied winner; empty until voting has closed. */
  motm: string[];
  venue: string | null;
  /** Cyprus time, "Sat 14 Nov · 19:00". */
  date: string;
};

export function shareCardData(page: MatchPage): ShareCardData | null {
  if (!playedMatch(page)) return null;
  const a = sideOf(page, 'a');
  const b = sideOf(page, 'b');
  if (a.score === null || b.score === null) return null;
  const scorers = (side: Side) => page.goals.filter((g) => g.side === side).map((g) => playerName(g.scorer));
  return {
    matchId: page.matchId,
    a: { label: a.label, score: a.score, scorers: scorers('a') },
    b: { label: b.label, score: b.score, scorers: scorers('b') },
    motm: page.motm.map((p) => playerName(p)),
    venue: page.venue?.name ?? null,
    date: formatMatchWhen(page.kickoffAt),
  };
}

export const canShareMotm = (data: ShareCardData) => data.motm.length > 0;
