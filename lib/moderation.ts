import { supabase } from '@/lib/supabase';

export async function blockUser(blockerId: string, blockedId: string) {
  return supabase.from('blocked_users').insert({ blocker_id: blockerId, blocked_id: blockedId });
}

export async function unblockUser(blockerId: string, blockedId: string) {
  return supabase
    .from('blocked_users')
    .delete()
    .eq('blocker_id', blockerId)
    .eq('blocked_id', blockedId);
}

/** Which of the user's own blocks currently exist — used to show "Blocked"
 *  instead of a "Block" button for someone already blocked. */
export async function listMyBlocks(blockerId: string) {
  return supabase.from('blocked_users').select('blocked_id').eq('blocker_id', blockerId);
}

/** S13: 'conversation' reports a whole chat, 'message' one message (context_id
 *  is its id); S19: 'favourite_player' a player card's favourite player. The
 *  reported player makes it urgent when they are a minor (A7). */
export type ReportContext = 'player' | 'team' | 'fixture_chat' | 'conversation' | 'message' | 'favourite_player';

/** Insert-only by design (see supabase/moderation.sql) — there's nothing to
 *  read back, just a confirmation that the write succeeded. */
export async function submitReport(params: {
  reporterId: string;
  reportedUserId?: string;
  context: ReportContext;
  contextId?: string;
  reason: string;
}) {
  return supabase.from('reports').insert({
    reporter_id: params.reporterId,
    reported_user_id: params.reportedUserId ?? null,
    context: params.context,
    context_id: params.contextId ?? null,
    reason: params.reason,
  });
}

/** S19: reports the favourite player shown on a player's card (the Report
 *  button is on S20's player sheet, components/friends/profile-sheet.tsx). */
export async function reportFavouritePlayer(reporterId: string, reportedUserId: string, reason: string) {
  return submitReport({ reporterId, reportedUserId, context: 'favourite_player', reason });
}
