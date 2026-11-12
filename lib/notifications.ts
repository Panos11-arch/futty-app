import { supabase } from '@/lib/supabase';

export type NotificationType =
  | 'fixture_message'
  | 'squad_post'
  | 'booking_slot'
  | 'booking_cancelled'
  | 'fixture_agreed'
  | 'match_payment_due'
  | 'team_invite'
  | 'booking_invite'
  | 'match_result_submitted'
  | 'match_result_confirmed'
  | 'match_result_disputed';

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

/** Fanned out server-side by triggers in supabase/notifications.sql — this
 *  just reads the resulting rows, it never writes them. */
export async function listNotifications() {
  return supabase
    .from('notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
}

export async function markNotificationRead(id: string) {
  return supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
}

export async function markAllNotificationsRead(ids: string[]) {
  if (ids.length === 0) return { error: null };
  return supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids);
}
