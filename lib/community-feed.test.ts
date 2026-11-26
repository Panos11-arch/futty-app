import type { MatchResultItem, SquadPostItem } from './community';
import {
  feedKey,
  mergePages,
  nextCursor,
  postLine,
  postSubtitle,
  resultSubtitle,
  scoreLabel,
  scoreText,
  spotsLabel,
  timeAgo,
} from './community-feed';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

// 25 November 2026, 12:00 in Cyprus (UTC+2 in winter).
const NOW = new Date('2026-11-25T10:00:00Z');

function post(over: Partial<SquadPostItem> = {}): SquadPostItem {
  return {
    kind: 'squad_post',
    item_id: 'p1',
    sort_at: '2026-11-25T06:00:00Z',
    actor_kind: 'player',
    actor_id: 'u1',
    actor_name: 'Anna',
    scheduled_at: '2026-11-26T18:00:00Z', // tomorrow 20:00 Cyprus
    format: '5-a-side',
    venue_name: 'Nuevo Campo',
    post_type: 'players',
    post_status: 'open',
    spots: 2,
    level_min: 5,
    level_max: 7,
    v2: false,
    mine: false,
    can_message: false,
    ...over,
  };
}

function result(over: Partial<MatchResultItem> = {}): MatchResultItem {
  return {
    kind: 'match_result',
    item_id: 'm1',
    sort_at: '2026-11-25T08:00:00Z',
    actor_kind: 'team',
    actor_id: 't1',
    actor_name: 'Kato United',
    scheduled_at: '2026-11-24T18:00:00Z',
    format: '5-a-side',
    venue_name: null,
    league: true,
    side_a_label: 'Kato United',
    side_a_team_id: 't1',
    side_b_label: 'Limassol Lions',
    side_b_team_id: 't2',
    side_a_score: 3,
    side_b_score: 2,
    forfeit_side: null,
    ...over,
  };
}

describe('timeAgo', () => {
  it.each([
    ['2026-11-25T09:59:30Z', 'now'],
    ['2026-11-25T09:55:00Z', '5 min'],
    ['2026-11-25T08:00:00Z', '2 h'],
    ['2026-11-24T09:00:00Z', '1 d'],
    ['2026-11-04T10:00:00Z', '3 w'],
  ])('%s is %s ago', (iso, expected) => {
    expect(timeAgo(iso, NOW)).toBe(expected);
  });

  it('a time in the future reads as now', () => {
    expect(timeAgo('2026-11-25T11:00:00Z', NOW)).toBe('now');
  });
});

describe('spotsLabel', () => {
  it('one, many, none', () => {
    expect(spotsLabel(1)).toBe('1 spot');
    expect(spotsLabel(3)).toBe('3 spots');
    expect(spotsLabel(0)).toBe('0 spots');
    expect(spotsLabel(null)).toBeNull();
  });
});

describe('subtitles', () => {
  it('posts say what they want and when they were posted', () => {
    expect(postSubtitle(post(), NOW)).toBe('Looking for players · 4 h');
    expect(postSubtitle(post({ post_type: 'opposition' }), NOW)).toBe('Looking for opposition · 4 h');
  });

  it('results', () => {
    expect(resultSubtitle(result(), NOW)).toBe('Match result · 2 h');
  });
});

describe('postLine', () => {
  it('a players post with spots and a level (image 18)', () => {
    expect(postLine(post(), NOW)).toBe('Need 2 for 5-a-side tomorrow 20:00 at Nuevo Campo. Level 5.0–7.0.');
  });

  it('today, no level, no venue', () => {
    expect(
      postLine(post({ scheduled_at: '2026-11-25T16:30:00Z', level_min: null, level_max: null, venue_name: null }), NOW),
    ).toBe('Need 2 for 5-a-side today 18:30.');
  });

  it('a later day uses its name', () => {
    expect(postLine(post({ scheduled_at: '2026-11-27T17:00:00Z', level_min: null }), NOW)).toBe(
      'Need 2 for 5-a-side Friday 27 Nov 19:00 at Nuevo Campo.',
    );
  });

  it('an opposition post', () => {
    expect(postLine(post({ post_type: 'opposition', spots: null, level_min: 6, level_max: 6 }), NOW)).toBe(
      'Opponent wanted for 5-a-side tomorrow 20:00 at Nuevo Campo. Level 6.0.',
    );
  });

  it('a closed players post has no spots', () => {
    expect(postLine(post({ spots: null, level_min: null }), NOW)).toBe(
      'Players for 5-a-side tomorrow 20:00 at Nuevo Campo.',
    );
  });
});

describe('score', () => {
  it('a played match', () => {
    expect(scoreText(result())).toBe('3 : 2');
    expect(scoreLabel(result())).toBe('Kato United 3, Limassol Lions 2');
  });

  it('a forfeit names the winner', () => {
    const forfeit = result({ forfeit_side: 'a', side_a_score: null, side_b_score: null });
    expect(scoreText(forfeit)).toBe('Forfeit');
    expect(scoreLabel(forfeit)).toBe('Limassol Lions won by forfeit');
    expect(scoreLabel(result({ forfeit_side: 'b' }))).toBe('Kato United won by forfeit');
  });

  it('a missing score reads as 0', () => {
    expect(scoreText(result({ side_a_score: null, side_b_score: null }))).toBe('0 : 0');
    expect(scoreLabel(result({ side_a_score: null, side_b_score: null }))).toBe('Kato United 0, Limassol Lions 0');
  });
});

describe('paging', () => {
  it('keys by kind and id, so a post and a match never clash', () => {
    expect(feedKey(post({ item_id: 'x' }))).not.toBe(feedKey(result({ item_id: 'x' })));
  });

  it('the cursor is the last row', () => {
    expect(nextCursor([post(), result()])).toEqual({ at: result().sort_at, id: 'm1' });
    expect(nextCursor([])).toBeNull();
  });

  it('merging drops repeats and keeps order', () => {
    const a = post({ item_id: 'a' });
    const b = result({ item_id: 'b' });
    const c = post({ item_id: 'c' });
    expect(mergePages([a, b], [b, c]).map((i) => i.item_id)).toEqual(['a', 'b', 'c']);
  });
});
