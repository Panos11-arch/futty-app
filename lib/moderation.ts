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

export type ReportContext = 'player' | 'team' | 'fixture_chat';

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
