import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { authStorage } from '@/lib/auth-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase credentials. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env, then restart the dev server so Expo re-inlines them.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // SQLite-backed on native, the browser's own localStorage on web.
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    // On web the password-recovery link comes back with its tokens in the URL
    // fragment, and supabase-js can consume them itself. Native has no URL to
    // read, so lib/use-recovery-link.ts parses the deep link instead.
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// supabase-js keeps its refresh timer on a JS interval, which native platforms
// suspend in the background. Tie it to foreground transitions so a session that
// was backgrounded past its expiry still refreshes on the way back in.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
