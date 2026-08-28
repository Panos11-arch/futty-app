import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { type AppNotification, listNotifications } from '@/lib/notifications';
import { useRealtimeChannelName } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';

type NotificationsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; notifications: AppNotification[] };

/** Backs both the bell's unread badge (Home header) and the full list
 *  (app/notifications.tsx) — one hook so a notification read on one doesn't
 *  need a separate refetch to reflect on the other. */
export function useNotifications() {
  const { user } = useAuth();
  const [state, setState] = useState<NotificationsState>({ status: 'loading' });
  const channelName = useRealtimeChannelName('notifications');

  const reload = useCallback(async () => {
    if (!user) {
      setState({ status: 'ready', notifications: [] });
      return;
    }
    const { data, error } = await listNotifications();
    if (error) setState({ status: 'error', message: error.message });
    else setState({ status: 'ready', notifications: data ?? [] });
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${user.id}` },
        () => reload()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, user, reload]);

  const unreadCount = state.status === 'ready' ? state.notifications.filter((n) => !n.read_at).length : 0;

  return { ...state, unreadCount, reload };
}
