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
  | 'match_result_disputed'
  | 'match_score_mismatch'
  | 'match_score_check'
  | 'match_score_rejected'
  | 'venue_new_booking'
  | 'venue_booking_cancelled'
  | 'venue_short_game'
  | 'venue_daily_summary'
  | 'venue_player_offered'
  | 'venue_player_withdrawn'
  | 'venue_player_accepted'
  | 'venue_player_declined'
  | 'venue_player_removed'
  | 'saved_search_match';

/** Sent to venue staff only (venue_notifications_tick, PR #99). They open the
 *  venue dashboard, never My Bookings, and only staff see them in settings. */
export const VENUE_NOTIFICATION_TYPES = [
  'venue_new_booking',
  'venue_booking_cancelled',
  'venue_short_game',
  'venue_daily_summary',
  // P6e: the booker answered or removed the venue's offered player.
  'venue_player_accepted',
  'venue_player_declined',
  'venue_player_removed',
] as const;

/** P6e: sent to the booker about the venue's offered player. They open the
 *  booking, where the booker answers. */
export const VENUE_PLAYER_BOOKER_TYPES = ['venue_player_offered', 'venue_player_withdrawn'] as const;

export function isVenuePlayerBookerType(type: unknown): boolean {
  return typeof type === 'string' && (VENUE_PLAYER_BOOKER_TYPES as readonly string[]).includes(type);
}

export function isVenueNotificationType(type: unknown): boolean {
  return typeof type === 'string' && (VENUE_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

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

// Notification settings (docs/specs/match-record.md section 4.10, decision
// 1d). Which types exist and which are always sent come from the server
// (notification_types); the app only groups and names them. Writes go
// straight to notification_settings and notification_quiet_hours, whose RLS
// allows a player their own rows only and refuses an always-sent type.

export type NotificationGroupKey = 'games' | 'follows' | 'community' | 'premium' | 'venue';

/** Decision 1d.1: the switchable types, grouped. A type the server adds later lands in "Other". */
export const NOTIFICATION_GROUPS: { key: NotificationGroupKey; title: string; types: string[] }[] = [
  {
    key: 'games',
    title: 'Your games',
    types: [
      'match_reminder_24h',
      'match_reminder_2h',
      'match_after_game',
      'match_result_submitted',
      'match_result_confirmed',
      'match_result_disputed',
      'match_score_mismatch',
      'match_score_check',
      'match_score_rejected',
      'motm_vote_open',
      'team_of_the_week',
      'streak_badge',
      'fixture_agreed',
      'fixture_message',
      'booking_invite',
      ...VENUE_PLAYER_BOOKER_TYPES,
    ],
  },
  {
    key: 'follows',
    title: 'Teams you follow',
    types: ['followed_team_match', 'followed_team_result', 'followed_team_opponent_wanted'],
  },
  { key: 'community', title: 'Community', types: ['squad_post', 'booking_slot', 'team_invite', 'saved_search_match', 'message_new'] },
  // S14: off until the player switches it on (Apple guideline 4.5.4).
  { key: 'premium', title: 'Premium', types: ['premium_offers'] },
  { key: 'venue', title: 'Venue', types: [...VENUE_NOTIFICATION_TYPES] },
];

/** Decision 1d.2: one reason for every always-sent type. */
export const ALWAYS_SENT_REASON = 'About money or a cancelled game, so we always send these.';

export const NOTIFICATION_LABELS: Record<string, string> = {
  match_reminder_24h: 'A day before a game',
  match_reminder_2h: '2 hours before a game',
  match_after_game: 'After a game: score and vote',
  match_result_submitted: 'A result is entered',
  match_result_confirmed: 'A result is confirmed',
  match_result_disputed: 'A result is disputed',
  match_score_mismatch: 'Captains’ scores don’t match',
  match_score_check: 'Check a captain’s score',
  match_score_rejected: 'Your score was rejected',
  motm_vote_open: 'Man of the match voting',
  team_of_the_week: 'You’re in the team of the week',
  premium_offers: 'Premium and offers',
  streak_badge: 'Streak badges',
  fixture_agreed: 'A fixture is agreed',
  fixture_message: 'Fixture messages',
  booking_invite: 'Invites to a booking',
  followed_team_match: 'They play today',
  followed_team_result: 'Their results',
  followed_team_opponent_wanted: 'They want an opponent',
  squad_post: 'New squad posts',
  booking_slot: 'Open spots in games',
  saved_search_match: 'Your saved searches',
  team_invite: 'Invites to a team',
  message_new: 'New messages',
  booking_cancelled: 'A booking is cancelled',
  match_payment_due: 'Payment due for a game',
  venue_closed_new_bookings: 'A venue stops taking bookings',
  guarantee_hold_failed: 'A card hold didn’t work',
  booking_spot_released: 'Your spot is released',
  cancellation_fee_failed: 'A cancellation fee didn’t go through',
  short_game_warning: 'A game is short of players',
  top_up_charged: 'A top-up is charged',
  debt_created: 'You owe money',
  debt_settled: 'A debt is settled',
  cash_unpaid_prompt: 'Cash not yet paid',
  booking_cancelled_by_venue: 'The venue cancels a booking',
  venue_condition_warning: 'Pitch condition warnings',
  gipedo_result_needed: 'A result is needed for a payout',
  guarantee_charged: 'Money taken from your hold',
  venue_new_booking: 'A new booking at your venue',
  venue_booking_cancelled: 'A booking at your venue is cancelled',
  venue_short_game: 'A game at your venue is short of players',
  venue_daily_summary: 'Tomorrow’s summary, at 20:00',
  venue_player_offered: 'A venue offers your game a player',
  venue_player_withdrawn: 'A venue withdraws its player',
  venue_player_accepted: 'A booker accepts your player',
  venue_player_declined: 'A booker declines your player',
  venue_player_removed: 'A booker removes your player',
};

/** A type's words on screen; an unknown type shows its name in words rather than nothing. */
export function notificationLabel(type: string): string {
  const known = NOTIFICATION_LABELS[type];
  if (known) return known;
  const words = type.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** default_enabled false: off until the player switches it on (S14 premium_offers). */
export type NotificationTypeRow = { type: string; always_sent: boolean; default_enabled?: boolean };

export type NotificationSection = { key: NotificationGroupKey | 'other'; title: string; types: string[] };

/** The switchable types in their groups, in the order above; unknown switchable ones under "Other". */
export function groupSwitchableTypes(rows: NotificationTypeRow[]): NotificationSection[] {
  const switchable = new Set(rows.filter((r) => !r.always_sent).map((r) => r.type));
  const grouped = new Set(NOTIFICATION_GROUPS.flatMap((g) => g.types));
  const sections: NotificationSection[] = NOTIFICATION_GROUPS.map((g) => ({
    key: g.key,
    title: g.title,
    types: g.types.filter((t) => switchable.has(t)),
  })).filter((s) => s.types.length > 0);
  const other = rows.filter((r) => !r.always_sent && !grouped.has(r.type)).map((r) => r.type);
  if (other.length > 0) sections.push({ key: 'other', title: 'Other', types: other });
  return sections;
}

/** Venue types are for venue staff only: everyone else never sees them. */
export function sectionsForViewer(sections: NotificationSection[], isVenueStaff: boolean): NotificationSection[] {
  return isVenueStaff ? sections : sections.filter((s) => s.key !== 'venue');
}

/** The always-sent list with venue types left out for anyone who isn't staff. */
export function alwaysSentForViewer(types: string[], isVenueStaff: boolean): string[] {
  return isVenueStaff ? types : types.filter((t) => !isVenueNotificationType(t));
}

export async function getNotificationTypes() {
  const { data, error } = await supabase.from('notification_types').select('type, always_sent, default_enabled').order('type');
  return { rows: (data as NotificationTypeRow[] | null) ?? [], error };
}

/** The player's settings with each type's default filled in: a type that is off by default and has no row is off. */
export function withDefaults(types: NotificationTypeRow[], settings: Record<string, boolean>): Record<string, boolean> {
  const filled: Record<string, boolean> = {};
  for (const t of types) if (t.default_enabled === false) filled[t.type] = false;
  return { ...filled, ...settings };
}

/** The player's own rows: type → enabled. No row means the type's default (see withDefaults). */
export async function getMyNotificationSettings() {
  const { data, error } = await supabase.from('notification_settings').select('type, enabled');
  const settings: Record<string, boolean> = {};
  for (const r of (data as { type: string; enabled: boolean }[] | null) ?? []) settings[r.type] = r.enabled;
  return { settings, error };
}

export async function setNotificationEnabled(profileId: string, type: string, enabled: boolean) {
  return supabase
    .from('notification_settings')
    .upsert({ profile_id: profileId, type, enabled }, { onConflict: 'profile_id,type' });
}

/** Quiet hours in Cyprus time as "HH:MM"; null when off (no row). */
export type QuietHours = { starts: string; ends: string };

const hhmm = (t: string) => t.slice(0, 5);

export async function getMyQuietHours() {
  const { data, error } = await supabase
    .from('notification_quiet_hours')
    .select('starts_local, ends_local')
    .maybeSingle();
  const row = data as { starts_local: string; ends_local: string } | null;
  return { quietHours: row ? { starts: hhmm(row.starts_local), ends: hhmm(row.ends_local) } : null, error };
}

/** Start after end is a span past midnight (23:00 to 07:00). The same start and end isn't allowed. */
export function quietHoursError(q: Partial<QuietHours>): string | null {
  if (!q.starts || !q.ends) return 'Pick a start and an end time.';
  if (q.starts === q.ends) return 'Start and end can’t be the same time.';
  return null;
}

export function quietHoursCrossMidnight(q: QuietHours): boolean {
  return q.ends < q.starts;
}

export async function setQuietHours(profileId: string, q: QuietHours) {
  return supabase
    .from('notification_quiet_hours')
    .upsert({ profile_id: profileId, starts_local: q.starts, ends_local: q.ends }, { onConflict: 'profile_id' });
}

export async function clearQuietHours(profileId: string) {
  return supabase.from('notification_quiet_hours').delete().eq('profile_id', profileId);
}
