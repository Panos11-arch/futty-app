import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export const PREFERRED_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const PREFERRED_TIMES = ['morning', 'afternoon', 'evening'] as const;
export type PreferredDay = (typeof PREFERRED_DAYS)[number];
export type PreferredTime = (typeof PREFERRED_TIMES)[number];

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
  /** Owner only (match_profile_prefs): never in PublicProfile or the public profile functions. */
  preferred_days: PreferredDay[];
  preferred_times: PreferredTime[];
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
  | 'preferred_days'
  | 'preferred_times'
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
        'id, email, username, full_name, phone, gender, date_of_birth, bio, city, position, preferred_foot, preferred_days, preferred_times, show_phone_publicly, role, is_premium, xp, played, won, drawn, lost, goals, created_at'
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

export type PublicProfile = Pick<
  Profile,
  'id' | 'username' | 'full_name' | 'city' | 'position' | 'preferred_foot' | 'xp' | 'played' | 'won' | 'drawn' | 'lost' | 'goals'
>;

/** Another user's public stats only (item 5) — via a security-definer RPC
 *  (supabase/public-profiles.sql), since profiles' RLS only lets you read
 *  your own row. Never includes email/phone/gender/date_of_birth/bio. */
export async function getPublicProfile(profileId: string) {
  const { data, error } = await supabase.rpc('get_public_profile', { p_profile_id: profileId }).maybeSingle();
  return { data: data as PublicProfile | null, error };
}

/** Widens a PublicProfile to the full Profile shape so it can be passed to
 *  components (e.g. ProfileCard) that expect one — the fields that aren't
 *  fetched are never rendered by a read-only view, so a safe placeholder is
 *  fine rather than plumbing a second, narrower prop type through them. */
export function publicProfileAsProfile(p: PublicProfile): Profile {
  return {
    id: p.id,
    email: null,
    username: p.username,
    full_name: p.full_name,
    phone: null,
    gender: null,
    date_of_birth: null,
    bio: null,
    city: p.city,
    position: p.position,
    preferred_foot: p.preferred_foot,
    preferred_days: [],
    preferred_times: [],
    show_phone_publicly: false,
    role: 'player',
    is_premium: false,
    xp: p.xp,
    played: p.played,
    won: p.won,
    drawn: p.drawn,
    lost: p.lost,
    goals: p.goals,
    created_at: '',
  };
}
