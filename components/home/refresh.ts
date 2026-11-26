// Home's reloads. Each section loads when it mounts; these reload it again:
// on pull to refresh (the screen bumps one number) and when Home comes back
// into view (e.g. after joining a game or cancelling a booking). Neither
// fires on the first render, so nothing loads twice.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

export function useReloadOn(signal: number, reload: () => unknown) {
  const first = useRef(signal);
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (signal !== first.current) void latest.current();
  }, [signal]);
}

export function useReloadOnRefocus(reload: () => unknown) {
  const seen = useRef(false);
  const latest = useRef(reload);
  latest.current = reload;
  useFocusEffect(
    useCallback(() => {
      if (seen.current) void latest.current();
      seen.current = true;
    }, [])
  );
}
