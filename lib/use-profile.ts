import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  email: string | null;
  username: string | null;
  full_name: string | null;
  phone: string | null;
  gender: string | null;
  date_of_birth: string | null;
  bio: string | null;
  city: string | null;
  position: string | null;
  preferred_foot: string | null;
  show_phone_publicly: boolean;
  /** 'venue_owner' unlocks the venue owner dashboard
   *  (app/venue-dashboard.tsx) — set manually in the database for now, see
   *  supabase/venue-owners.sql. Pre-existing column/values, not something
   *  this app introduced. */
  role: 'player' | 'venue_owner';
  is_premium: boolean;
  xp: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals: number;
  created_at: string;
};

type EditableProfileFields = Pick<
  Profile,
  | 'username'
  | 'full_name'
  | 'phone'
  | 'gender'
  | 'date_of_birth'
  | 'bio'
  | 'city'
  | 'position'
  | 'preferred_foot'
  | 'show_phone_publicly'
>;

type ProfileState =
  | { status: 'loading' }
  /** Signed in, but no matching row — the trigger in supabase/schema.sql is missing. */
  | { status: 'missing' }
  | { status: 'error'; message: string }
  | { status: 'ready'; profile: Profile };

/** Reads the signed-in user's own `profiles` row. Returns 'missing' rather than
 *  an error when the row isn't there, so the UI can tell the two apart. */
export function useProfile() {
  const { user } = useAuth();
  const [state, setState] = useState<ProfileState>({ status: 'loading' });

  const reload = useCallback(async () => {
    if (!user) return;

    setState({ status: 'loading' });

    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, email, username, full_name, phone, gender, date_of_birth, bio, city, position, preferred_foot, show_phone_publicly, role, is_premium, xp, played, won, drawn, lost, goals, created_at'
      )
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      setState({ status: 'error', message: error.message });
    } else if (!data) {
      setState({ status: 'missing' });
    } else {
      setState({ status: 'ready', profile: data });
    }
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}

export async function updateProfile(userId: string, fields: Partial<EditableProfileFields>) {
  return supabase.from('profiles').update(fields).eq('id', userId);
}
