// Loads spec 13's rules from public.app_rules (P10) and keeps them on the
// phone. Everyone may read the table, signed in or not.
//
//   - The last good copy is saved on the phone and used straight away at the
//     next launch, so the app shows the rules offline. Each launch fetches
//     them again, and a new copy replaces the old one everywhere at once.
//   - A row that fails the check (lib/rules.ts parseRules) is ignored: the
//     copy already in use stays.
//   - With no copy at all (a phone that has never fetched them), screens
//     show a placeholder and a retry, never a guessed number.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

import { type AppRules, getCachedRules, onRulesChange, parseRules, RULE_COLUMNS, setCachedRules } from '@/lib/rules';
import { supabase } from '@/lib/supabase';

export const RULES_STORAGE_KEY = 'futty.app_rules.v1';

export type RulesState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  /** `fresh` is false while the copy saved on the phone is shown and the
   *  fetch hasn't come back yet (or failed). */
  | { status: 'ready'; rules: AppRules; fresh: boolean };

let fetched = false;
let inFlight: Promise<AppRules> | null = null;
let restored: Promise<void> | null = null;

/** The copy saved on the phone, into memory (once). */
function restoreSaved(): Promise<void> {
  restored ??= (async () => {
    try {
      const saved = parseRules(JSON.parse((await AsyncStorage.getItem(RULES_STORAGE_KEY)) ?? 'null'));
      if (saved && !getCachedRules()) setCachedRules(saved);
    } catch {
      // Nothing saved, or unreadable: the fetch decides.
    }
  })();
  return restored;
}

/** Fetches the rules now. Resolves with the new rules, or rejects (the copy in use stays). */
export function fetchRules(): Promise<AppRules> {
  inFlight ??= (async () => {
    try {
      const { data, error } = await supabase.from('app_rules').select(RULE_COLUMNS).single();
      if (error) throw new Error(error.message);
      const rules = parseRules(data);
      if (!rules) throw new Error('The rules from the server are incomplete.');
      // Fresh first: setCachedRules tells the screens, and they read `fetched`.
      fetched = true;
      setCachedRules(rules);
      try {
        await AsyncStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
      } catch {
        // Not saved: the next launch fetches again.
      }
      return rules;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** The saved copy first, then one fetch per launch. Safe to call often. */
export async function ensureRules(): Promise<void> {
  await restoreSaved();
  if (!fetched) await fetchRules().catch(() => undefined);
}

/** For tests: forget everything this module knows. */
export function resetRulesForTests(): void {
  fetched = false;
  inFlight = null;
  restored = null;
  setCachedRules(null);
}

/** The rules for a screen: the saved copy at once, then the fetched one. */
export function useRules() {
  const [state, setState] = useState<RulesState>(() => {
    const rules = getCachedRules();
    return rules ? { status: 'ready', rules, fresh: fetched } : { status: 'loading' };
  });

  useEffect(() => {
    let live = true;
    const unsubscribe = onRulesChange((rules) => {
      if (live) setState({ status: 'ready', rules, fresh: fetched });
    });
    (async () => {
      await restoreSaved();
      if (!live) return;
      const saved = getCachedRules();
      if (saved) setState({ status: 'ready', rules: saved, fresh: fetched });
      if (fetched) return;
      try {
        await fetchRules();
      } catch (err) {
        if (!live) return;
        const rules = getCachedRules();
        setState(
          rules
            ? { status: 'ready', rules, fresh: false }
            : { status: 'error', message: err instanceof Error ? err.message : 'Could not load the rules.' },
        );
      }
    })();
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      await fetchRules();
    } catch (err) {
      const rules = getCachedRules();
      setState(
        rules
          ? { status: 'ready', rules, fresh: false }
          : { status: 'error', message: err instanceof Error ? err.message : 'Could not load the rules.' },
      );
    }
  }, []);

  return { state, reload };
}
