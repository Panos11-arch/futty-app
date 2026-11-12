import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import { followerTarget, type SquadPostRecord } from './handler.ts';

function post(extra: Partial<SquadPostRecord> = {}): SquadPostRecord {
  return {
    id: 'post-1',
    venue_id: 'venue-1',
    type: 'players',
    posted_by: 'profile-1',
    team_id: 'team-1',
    players_needed: 2,
    ...extra,
  };
}

Deno.test('a players post goes to the poster\'s followers', () => {
  deepStrictEqual(followerTarget(post()), { targetType: 'player', targetId: 'profile-1' });
});

Deno.test('an opposition post is not pushed here: the team\'s followers get it through send_notification', () => {
  strictEqual(followerTarget(post({ type: 'opposition' })), null);
});

Deno.test('a players post with no poster goes to nobody', () => {
  strictEqual(followerTarget(post({ posted_by: null })), null);
});
