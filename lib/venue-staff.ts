// Who sees venue staff screens and entries (S2). The role is set on the
// server (profiles.role, supabase/venue-owners.sql) and read through
// useProfile(); every check in the app goes through here, so the Account
// menu's Venue dashboard row and the dashboard screen always agree. The
// server's own check (public.is_venue_staff) still guards every action.

/** The profiles.role values that are venue staff. Only owners today. */
export const VENUE_STAFF_ROLES: readonly string[] = ['venue_owner'];

type ProfileState = { status: string; profile?: { role?: string | null } };

/** True once the server's profile says this person is venue staff. */
export function isVenueStaff(state: ProfileState): boolean {
  if (state.status !== 'ready') return false;
  const role = state.profile?.role;
  return !!role && VENUE_STAFF_ROLES.includes(role);
}
