import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AuthButton, AuthError, AuthField } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import type { MatchedContact, UnmatchedContact } from '@/lib/contacts';
import { shareContactInvite } from '@/lib/invite';
import { listTeams, type TeamListing } from '@/lib/community';
import { submitReport } from '@/lib/moderation';
import { playHref } from '@/lib/play-segments';
import { useAuth } from '@/lib/auth';
import { useBlocks } from '@/lib/use-blocks';
import { useContacts } from '@/lib/use-contacts';
import { useFollows } from '@/lib/use-follows';

type CommunityView = 'contacts' | 'teams';

function Avatar({ initial }: { initial: string }) {
  const tint = useThemeColor({}, 'tint');
  const onTint = useThemeColor({}, 'background');
  return (
    <View style={[styles.avatar, { backgroundColor: tint }]}>
      <ThemedText style={[styles.avatarText, { color: onTint }]}>{initial}</ThemedText>
    </View>
  );
}

function FollowButton({
  targetType,
  targetId,
  follows,
}: {
  targetType: 'player' | 'team';
  targetId: string;
  follows: ReturnType<typeof useFollows>;
}) {
  const [busy, setBusy] = useState(false);
  const tint = useThemeColor({}, 'tint');
  const onTint = useThemeColor({}, 'background');
  const following = follows.isFollowing(targetType, targetId);

  async function press() {
    setBusy(true);
    await follows.toggle(targetType, targetId);
    setBusy(false);
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={press}
      disabled={busy}
      style={[
        styles.followButton,
        { borderColor: tint },
        following && { backgroundColor: tint },
        busy && styles.dimmed,
      ]}>
      <ThemedText style={[styles.followButtonText, following && { color: onTint }]}>
        {following ? 'Following' : 'Follow'}
      </ThemedText>
    </Pressable>
  );
}

/** Block + report for a matched contact, collapsed behind a flag icon so the
 *  default row stays as compact as before. Reporting is insert-only
 *  (supabase/moderation.sql): there's nothing to show back afterward beyond
 *  a plain confirmation. */
function ContactModerationPanel({ playerId, blocks }: { playerId: string; blocks: ReturnType<typeof useBlocks> }) {
  const { user } = useAuth();
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = blocks.isBlocked(playerId);

  async function toggleBlock() {
    setBusy(true);
    setError(null);
    const { error: toggleError } = await blocks.toggle(playerId);
    setBusy(false);
    if (toggleError) setError(toggleError.message);
  }

  async function sendReport() {
    if (!user || !reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { error: reportError } = await submitReport({
      reporterId: user.id,
      reportedUserId: playerId,
      context: 'player',
      reason: reason.trim(),
    });
    setBusy(false);
    if (reportError) {
      setError(reportError.message);
    } else {
      setReported(true);
      setReporting(false);
      setReason('');
    }
  }

  if (reporting) {
    return (
      <View style={styles.moderationPanel}>
        <AuthField
          value={reason}
          onChangeText={setReason}
          placeholder="Why are you reporting this player?"
          multiline
        />
        {error ? <AuthError>{error}</AuthError> : null}
        <View style={styles.confirmRow}>
          <View style={styles.confirmButton}>
            <AuthButton label="Submit" onPress={sendReport} disabled={!reason.trim()} busy={busy} />
          </View>
          <View style={styles.confirmButton}>
            <AuthButton
              label="Cancel"
              variant="secondary"
              onPress={() => setReporting(false)}
              disabled={busy}
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.moderationPanel}>
      {reported ? (
        <IconLabel icon="exclamationmark.triangle.fill" style={styles.note} iconColor={FuttyColors.stone500} iconSize={11}>
          Report submitted — thanks.
        </IconLabel>
      ) : null}
      {error ? <AuthError>{error}</AuthError> : null}
      <View style={styles.confirmRow}>
        <View style={styles.confirmButton}>
          <AuthButton
            label={blocked ? 'Unblock' : 'Block'}
            variant="secondary"
            onPress={toggleBlock}
            busy={busy}
          />
        </View>
        <View style={styles.confirmButton}>
          <AuthButton label="Report" variant="secondary" onPress={() => setReporting(true)} disabled={busy} />
        </View>
      </View>
    </View>
  );
}

function MatchedContactRow({
  contact,
  follows,
  blocks,
  border,
}: {
  contact: MatchedContact;
  follows: ReturnType<typeof useFollows>;
  blocks: ReturnType<typeof useBlocks>;
  border: string;
}) {
  const [open, setOpen] = useState(false);
  const blocked = blocks.isBlocked(contact.match.profileId);

  return (
    <ThemedView style={[styles.card, { borderColor: border }]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/player-profile', params: { profileId: contact.match.profileId } })}
          style={styles.rowMain}>
          <Avatar initial={contact.name[0]?.toUpperCase() ?? '?'} />
          <View>
            <ThemedText type="defaultSemiBold">{contact.name}</ThemedText>
            {contact.match.username ? (
              <ThemedText style={styles.note}>@{contact.match.username}</ThemedText>
            ) : null}
          </View>
        </Pressable>
        <View style={styles.rowActions}>
          <FollowButton targetType="player" targetId={contact.match.profileId} follows={follows} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Block or report this player"
            onPress={() => setOpen((v) => !v)}
            style={styles.flagButton}
            hitSlop={8}>
            <IconSymbol name="flag.fill" size={14} color={blocked ? FuttyColors.rose600 : FuttyColors.stone400} />
          </Pressable>
        </View>
      </View>

      {open ? <ContactModerationPanel playerId={contact.match.profileId} blocks={blocks} /> : null}
    </ThemedView>
  );
}

function UnmatchedContactRow({ contact, border }: { contact: UnmatchedContact; border: string }) {
  const [sent, setSent] = useState(false);

  return (
    <ThemedView style={[styles.card, { borderColor: border }]}>
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Avatar initial={contact.name[0]?.toUpperCase() ?? '?'} />
          <ThemedText type="defaultSemiBold">{contact.name}</ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={async () => {
            await shareContactInvite(contact.name);
            setSent(true);
          }}
          style={styles.inviteButton}>
          <IconSymbol name="square.and.arrow.up" size={12} color={FuttyColors.white} />
          <ThemedText style={styles.inviteButtonText}>{sent ? 'Sent' : 'Invite'}</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

/** Contacts-based Community screen (item 9) — Playtomic's own Community tab
 *  works the same way: read the phone's contacts, show who's already on the
 *  app so you can follow them, and let you invite whoever isn't. */
function ContactsTab() {
  const contacts = useContacts();
  const follows = useFollows();
  const blocks = useBlocks();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  useEffect(() => {
    contacts.load();
    // Only on first mount of this tab — load() is stable (useCallback with
    // no deps) and re-running it on every render would re-prompt/re-scan
    // the whole contact list pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (contacts.status === 'idle' || contacts.status === 'loading') {
    return (
      <View style={styles.centerPad}>
        <ActivityIndicator />
        <ThemedText style={styles.note}>Checking your contacts…</ThemedText>
      </View>
    );
  }

  if (contacts.status === 'denied') {
    return (
      <View style={styles.centerPad}>
        <IconSymbol name="person.2.fill" size={28} color={FuttyColors.stone400} />
        <ThemedText style={styles.note}>
          Futty needs contacts access to show which of your contacts are already on the app.
        </ThemedText>
        <AuthButton label="Try again" variant="secondary" onPress={contacts.load} />
      </View>
    );
  }

  if (contacts.status === 'error') {
    return <ThemedText style={styles.note}>Could not load contacts: {contacts.message}</ThemedText>;
  }

  return (
    <>
      {contacts.matched.length > 0 ? (
        <>
          <ThemedText style={styles.sectionTitle}>On Futty ({contacts.matched.length})</ThemedText>
          {contacts.matched.map((contact) => (
            <MatchedContactRow key={contact.id} contact={contact} follows={follows} blocks={blocks} border={border} />
          ))}
        </>
      ) : null}

      {contacts.unmatched.length > 0 ? (
        <>
          <ThemedText style={styles.sectionTitle}>Invite to Futty ({contacts.unmatched.length})</ThemedText>
          {contacts.unmatched.map((contact) => (
            <UnmatchedContactRow key={contact.id} contact={contact} border={border} />
          ))}
        </>
      ) : null}

      {contacts.matched.length === 0 && contacts.unmatched.length === 0 ? (
        <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
          No contacts with phone numbers found.
        </IconLabel>
      ) : null}
    </>
  );
}

function TeamsTab() {
  const [teams, setTeams] = useState<TeamListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const follows = useFollows();

  useEffect(() => {
    listTeams().then(({ data, error: listError }) => {
      if (listError) setError(listError.message);
      else setTeams(data);
    });
  }, []);

  return (
    <>
      {error ? <ThemedText style={styles.note}>Could not load: {error}</ThemedText> : null}
      {!teams ? <ActivityIndicator /> : null}
      {teams && teams.length === 0 ? (
        <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
          No teams registered yet.
        </IconLabel>
      ) : null}
      {teams?.map((team) => (
        <ThemedView key={team.id} style={[styles.card, { borderColor: border }]}>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/team-profile', params: { teamId: team.id } })}
              style={styles.rowMain}>
              <Avatar initial={team.name[0]?.toUpperCase() ?? '?'} />
              <View>
                <ThemedText type="defaultSemiBold">{team.name}</ThemedText>
                {team.city ? <ThemedText style={styles.note}>{team.city}</ThemedText> : null}
              </View>
            </Pressable>
            <FollowButton targetType="team" targetId={team.id} follows={follows} />
          </View>
        </ThemedView>
      ))}
    </>
  );
}

/** Contacts and teams, shown in Play's Community segment
 *  (app/(tabs)/play.tsx). Scrolls itself. */
export function CommunityContent() {
  const [view, setView] = useState<CommunityView>('contacts');
  // Once a tab has been opened, its component stays mounted for the rest of
  // the screen's lifetime (toggled with display:none below) instead of
  // being unmounted on every switch. Unmounting was the actual bug: each
  // tab reads its data in its own useEffect(..., []) — device contacts +
  // matching for Contacts, a table query for Teams, plus a follows/blocks
  // fetch either way — so remounting re-ran all of that from scratch on
  // every single switch back, which is what made switching feel slow.
  const [openedTeams, setOpenedTeams] = useState(false);

  function selectTeams() {
    setOpenedTeams(true);
    setView('teams');
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.wrapRow}>
        <Chip icon="person.2.fill" label="Contacts" selected={view === 'contacts'} onPress={() => setView('contacts')} />
        <Chip icon="shield.fill" label="Teams" selected={view === 'teams'} onPress={selectTeams} />
      </View>

      <View style={view === 'contacts' ? undefined : styles.hidden}>
        <ContactsTab />
      </View>
      {openedTeams ? (
        <View style={view === 'teams' ? undefined : styles.hidden}>
          <TeamsTab />
        </View>
      ) : null}
    </ScrollView>
  );
}

/** /community is no longer a tab: it opens Play on Community. */
export default function CommunityRoute() {
  return <Redirect href={playHref('community')} />;
}

const styles = StyleSheet.create({
  hidden: {
    display: 'none',
  },
  flex: {
    flex: 1,
  },
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 48,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: FuttyColors.stone400,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 8,
  },
  centerPad: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  flagButton: {
    padding: 4,
  },
  moderationPanel: {
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmButton: {
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
  },
  followButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  followButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: FuttyColors.emerald700,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  inviteButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: FuttyColors.white,
  },
  dimmed: {
    opacity: 0.5,
  },
});
