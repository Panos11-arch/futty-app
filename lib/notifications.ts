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
  | 'match_result_disputed';

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

export type NotificationGroupKey = 'games' | 'follows' | 'community';

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
      'motm_vote_open',
      'fixture_agreed',
      'fixture_message',
      'booking_invite',
    ],
  },
  {
    key: 'follows',
    title: 'Teams you follow',
    types: ['followed_team_match', 'followed_team_result', 'followed_team_opponent_wanted'],
  },
  { key: 'community', title: 'Community', types: ['squad_post', 'booking_slot', 'team_invite'] },
];

/** Decision 1d.2: one reason for every always-sent type. */
export const ALWAYS_SENT_REASON = 'About money or a cancelled game, so we always send these.';

export const NOTIFICATION_LABELS: Record<string, string> = {
  match_reminder_24h: 'A day before a game',
  match_reminder_2h: '2 hours before a game',
  match_after_game: 'After a game: score, vote, rate',
  match_result_submitted: 'A result is entered',
  match_result_confirmed: 'A result is confirmed',
  match_result_disputed: 'A result is disputed',
  motm_vote_open: 'Man of the match voting',
  fixture_agreed: 'A fixture is agreed',
  fixture_message: 'Fixture messages',
  booking_invite: 'Invites to a booking',
  followed_team_match: 'They play today',
  followed_team_result: 'Their results',
  followed_team_opponent_wanted: 'They want an opponent',
  squad_post: 'New squad posts',
  booking_slot: 'Open spots in games',
  team_invite: 'Invites to a team',
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
};

/** A type's words on screen; an unknown type shows its name in words rather than nothing. */
export function notificationLabel(type: string): string {
  const known = NOTIFICATION_LABELS[type];
  if (known) return known;
  const words = type.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type NotificationTypeRow = { type: string; always_sent: boolean };

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

export async function getNotificationTypes() {
  const { data, error } = await supabase.from('notification_types').select('type, always_sent').order('type');
  return { rows: (data as NotificationTypeRow[] | null) ?? [], error };
}

/** The player's own opt-outs: type → enabled. No row means on. */
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
