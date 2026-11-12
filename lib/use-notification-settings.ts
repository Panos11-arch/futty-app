import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import {
  clearQuietHours,
  getMyNotificationSettings,
  getMyQuietHours,
  getNotificationTypes,
  groupSwitchableTypes,
  setNotificationEnabled,
  setQuietHours,
  type NotificationSection,
  type QuietHours,
} from '@/lib/notifications';

type Ready = {
  status: 'ready';
  sections: NotificationSection[];
  alwaysSent: string[];
  /** type → enabled; a type with no row is on. */
  settings: Record<string, boolean>;
  quietHours: QuietHours | null;
};

type State = { status: 'loading' } | { status: 'error'; message: string } | Ready;

/** The signed-in player's notification settings and quiet hours. */
export function useNotificationSettings() {
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  const [state, setState] = useState<State>({ status: 'loading' });
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!profileId) return;
    const requestId = ++requestIdRef.current;
    setState({ status: 'loading' });
    const [types, settings, quiet] = await Promise.all([
      getNotificationTypes(),
      getMyNotificationSettings(),
      getMyQuietHours(),
    ]);
    if (requestIdRef.current !== requestId) return;
    const error = types.error ?? settings.error ?? quiet.error;
    if (error) {
      setState({ status: 'error', message: error.message });
      return;
    }
    setState({
      status: 'ready',
      sections: groupSwitchableTypes(types.rows),
      alwaysSent: types.rows.filter((r) => r.always_sent).map((r) => r.type),
      settings: settings.settings,
      quietHours: quiet.quietHours,
    });
  }, [profileId]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current++;
    };
  }, [reload]);

  /** Optimistic; puts the switch back and returns the error if the write fails. */
  const setEnabled = useCallback(
    async (type: string, enabled: boolean) => {
      if (!profileId) return { error: null };
      setState((s) => (s.status === 'ready' ? { ...s, settings: { ...s.settings, [type]: enabled } } : s));
      const { error } = await setNotificationEnabled(profileId, type, enabled);
      if (error) {
        setState((s) => (s.status === 'ready' ? { ...s, settings: { ...s.settings, [type]: !enabled } } : s));
      }
      return { error };
    },
    [profileId],
  );

  /** Saves quiet hours, or turns them off with null. */
  const saveQuietHours = useCallback(
    async (q: QuietHours | null) => {
      if (!profileId) return { error: null };
      const { error } = q ? await setQuietHours(profileId, q) : await clearQuietHours(profileId);
      if (!error) setState((s) => (s.status === 'ready' ? { ...s, quietHours: q } : s));
      return { error };
    },
    [profileId],
  );

  return { ...state, reload, setEnabled, saveQuietHours };
}
