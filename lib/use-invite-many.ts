// S20A (b): what the booking screens need for Invite all friends and Invite a
// team: my teams (not deleted) and the two calls, with their errors in words.
import { useEffect, useMemo, useState } from 'react';

import type { InviteResult } from '@/components/booking/invite-many';
import { useAuth } from '@/lib/auth';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { inviteAllFriendsToBooking, inviteTeamToBooking } from '@/lib/booking-shares';
import { supabase } from '@/lib/supabase';

export type InviteTeam = { id: string; name: string };

/** The teams I'm in that can be invited (deleted teams left out). A failed read is no teams. */
export async function fetchMyInviteTeams(profileId: string): Promise<InviteTeam[]> {
  try {
    const { data, error } = await supabase
      .from('team_members')
      .select('teams(id, name, deleted_at)')
      .eq('profile_id', profileId);
    if (error || !data) return [];
    return (data as unknown as { teams: { id: string; name: string; deleted_at: string | null } | null }[])
      .map((row) => row.teams)
      .filter((t): t is { id: string; name: string; deleted_at: string | null } => !!t && !t.deleted_at)
      .map((t) => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

const words = (result: { count: number; error: { message: string } | null }): InviteResult => ({
  count: result.count,
  error: result.error ? describeBookingErrorMessage(result.error.message) : null,
});

export function useInviteMany(bookingId: string) {
  const { user } = useAuth();
  const [teams, setTeams] = useState<InviteTeam[]>([]);

  useEffect(() => {
    let live = true;
    if (user?.id) {
      void fetchMyInviteTeams(user.id).then((list) => {
        if (live) setTeams(list);
      });
    }
    return () => {
      live = false;
    };
  }, [user?.id]);

  return useMemo(
    () => ({
      teams,
      onInviteAllFriends: async () => words(await inviteAllFriendsToBooking(bookingId)),
      onInviteTeam: async (teamId: string) => words(await inviteTeamToBooking(bookingId, teamId)),
    }),
    [teams, bookingId],
  );
}
