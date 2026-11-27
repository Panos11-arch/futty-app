// S7: what the Community feed cards say, from the server's rows
// (lib/community.ts). Times in Cyprus time. No amounts here.

import { cyprusDayTime, dayTitle, levelText } from '@/lib/find-match';
import type { FeedCursor, FeedItem, MatchResultItem, SquadPostItem } from '@/lib/community';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** "now", "5 min", "2 h", "1 d", "3 w". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  if (ms < WEEK) return `${Math.floor(ms / DAY)} d`;
  return `${Math.floor(ms / WEEK)} w`;
}

/** "1 spot", "3 spots"; null when the server gives none (closed, opposition). */
export function spotsLabel(spots: number | null): string | null {
  if (spots === null || spots === undefined) return null;
  return spots === 1 ? '1 spot' : `${spots} spots`;
}

/** The line under the name: "Looking for players · 4 h". */
export function postSubtitle(item: Pick<SquadPostItem, 'post_type' | 'sort_at'>, now: Date = new Date()): string {
  const what = item.post_type === 'opposition' ? 'Looking for opposition' : 'Looking for players';
  return `${what} · ${timeAgo(item.sort_at, now)}`;
}

export function resultSubtitle(item: Pick<MatchResultItem, 'sort_at'>, now: Date = new Date()): string {
  return `Match result · ${timeAgo(item.sort_at, now)}`;
}

/** "tomorrow 20:00", "today 18:30", "Friday 27 Nov 19:00" (Cyprus time). */
function whenText(iso: string, now: Date): string {
  const today = cyprusDayTime(now.toISOString()).day;
  const { day, time } = cyprusDayTime(iso);
  const title = dayTitle(day, today);
  return `${title === 'Today' || title === 'Tomorrow' ? title.toLowerCase() : title} ${time}`;
}

/** The post itself, from its fields: "Need 2 for 5-a-side tomorrow 20:00 at
 *  Nuevo Campo. Level 5.0–7.0." */
export function postLine(
  item: Pick<SquadPostItem, 'post_type' | 'spots' | 'format' | 'scheduled_at' | 'venue_name' | 'level_min' | 'level_max'>,
  now: Date = new Date(),
): string {
  const game = [item.format, whenText(item.scheduled_at, now)].filter(Boolean).join(' ');
  const where = item.venue_name ? ` at ${item.venue_name}` : '';
  const lead =
    item.post_type === 'opposition'
      ? `Opponent wanted for ${game}`
      : item.spots !== null && item.spots !== undefined
        ? `Need ${item.spots} for ${game}`
        : `Players for ${game}`;
  const level = levelText(item.level_min, item.level_max);
  return `${lead}${where}.${level ? ` ${level}.` : ''}`;
}

/** The middle of the score panel: "3 : 2", or "Forfeit" when one side forfeited. */
export function scoreText(item: Pick<MatchResultItem, 'side_a_score' | 'side_b_score' | 'forfeit_side'>): string {
  if (item.forfeit_side) return 'Forfeit';
  return `${item.side_a_score ?? 0} : ${item.side_b_score ?? 0}`;
}

/** What VoiceOver reads for the score panel. */
export function scoreLabel(
  item: Pick<MatchResultItem, 'side_a_label' | 'side_b_label' | 'side_a_score' | 'side_b_score' | 'forfeit_side'>,
): string {
  if (item.forfeit_side) {
    const winner = item.forfeit_side === 'a' ? item.side_b_label : item.side_a_label;
    return `${winner} won by forfeit`;
  }
  return `${item.side_a_label} ${item.side_a_score ?? 0}, ${item.side_b_label} ${item.side_b_score ?? 0}`;
}

export function feedKey(item: Pick<FeedItem, 'kind' | 'item_id'>): string {
  return `${item.kind}:${item.item_id}`;
}

/** Where the next page starts: after the last row. */
export function nextCursor(items: Pick<FeedItem, 'sort_at' | 'item_id'>[]): FeedCursor | null {
  const last = items[items.length - 1];
  return last ? { at: last.sort_at, id: last.item_id } : null;
}

/** A new page appended, without repeats. */
export function mergePages<T extends Pick<FeedItem, 'kind' | 'item_id'>>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map(feedKey));
  return [...current, ...incoming.filter((item) => !seen.has(feedKey(item)))];
}

/** Where "Open post" on my own post goes. Lives in find-match (Find a match
 *  cards use it too), which this file already imports from. */
export { ownPostHref } from '@/lib/find-match';
