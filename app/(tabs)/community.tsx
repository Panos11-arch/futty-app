import { Redirect, router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { MIN_TOUCH } from '@/components/ui/foundation';
import { IconButton } from '@/components/ui/icon-button';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { colors, hairline, space } from '@/constants/futty-theme';
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

/** One person or team: avatar, name, a line under it, then one row of
 *  actions. The name side opens the profile when `onPress` is set. */
function PersonRow({
  name,
  subtitle,
  onPress,
  actions,
  children,
}: {
  name: string;
  subtitle?: string | null;
  onPress?: () => void;
  actions: ReactNode;
  children?: ReactNode;
}) {
  const main = (
    <>
      <Avatar name={name} />
      <View style={styles.flex}>
        <Text variant="headline">{name}</Text>
        {subtitle ? (
          <Text variant="callout" tone="inkMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <Card style={styles.personCard}>
      <View style={styles.row}>
        {onPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={name}
            onPress={onPress}
            style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
            {main}
          </Pressable>
        ) : (
          <View style={styles.rowMain}>{main}</View>
        )}
        <View style={styles.rowActions}>{actions}</View>
      </View>
      {children}
    </Card>
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
  const following = follows.isFollowing(targetType, targetId);

  async function press() {
    setBusy(true);
    await follows.toggle(targetType, targetId);
    setBusy(false);
  }

  return (
    <Button
      label={following ? 'Following' : 'Follow'}
      variant={following ? 'secondary' : 'primary'}
      onPress={press}
      disabled={busy}
    />
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
        <TextField
          label="Report this player"
          value={reason}
          onChangeText={setReason}
          placeholder="Why are you reporting this player?"
          multiline
          error={error ?? undefined}
        />
        <View style={styles.buttonRow}>
          <Button label="Send report" onPress={sendReport} disabled={!reason.trim()} loading={busy} />
          <Button label="Cancel" variant="secondary" onPress={() => setReporting(false)} disabled={busy} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.moderationPanel}>
      {reported ? (
        <Text variant="callout" tone="inkMuted">
          Report submitted — thanks.
        </Text>
      ) : null}
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <View style={styles.buttonRow}>
        <Button label={blocked ? 'Unblock' : 'Block'} variant="secondary" onPress={toggleBlock} loading={busy} />
        <Button label="Report" variant="secondary" onPress={() => setReporting(true)} disabled={busy} />
      </View>
    </View>
  );
}

function MatchedContactRow({
  contact,
  follows,
  blocks,
}: {
  contact: MatchedContact;
  follows: ReturnType<typeof useFollows>;
  blocks: ReturnType<typeof useBlocks>;
}) {
  const [open, setOpen] = useState(false);
  const blocked = blocks.isBlocked(contact.match.profileId);

  return (
    <PersonRow
      name={contact.name}
      subtitle={contact.match.username ? `@${contact.match.username}` : null}
      onPress={() => router.push({ pathname: '/player-profile', params: { profileId: contact.match.profileId } })}
      actions={
        <>
          <FollowButton targetType="player" targetId={contact.match.profileId} follows={follows} />
          <IconButton
            icon="flag.fill"
            size="small"
            tone={blocked ? 'danger' : 'inkMuted'}
            accessibilityLabel="Block or report this player"
            onPress={() => setOpen((v) => !v)}
          />
        </>
      }>
      {open ? <ContactModerationPanel playerId={contact.match.profileId} blocks={blocks} /> : null}
    </PersonRow>
  );
}

function UnmatchedContactRow({ contact }: { contact: UnmatchedContact }) {
  const [sent, setSent] = useState(false);

  return (
    <PersonRow
      name={contact.name}
      actions={
        <Button
          label={sent ? 'Sent' : 'Invite'}
          variant="secondary"
          onPress={async () => {
            await shareContactInvite(contact.name);
            setSent(true);
          }}
        />
      }
    />
  );
}

function RowsSkeleton({ testID }: { testID: string }) {
  return (
    <View testID={testID} style={styles.list}>
      {[0, 1, 2].map((i) => (
        <Card key={i} style={styles.row}>
          <SkeletonBlock width={MIN_TOUCH - space.xs} height={MIN_TOUCH - space.xs} rounded="pill" />
          <View style={styles.flex}>
            <SkeletonText lines={2} />
          </View>
        </Card>
      ))}
    </View>
  );
}

/** Contacts-based Community screen (item 9) — Playtomic's own Community tab
 *  works the same way: read the phone's contacts, show who's already on the
 *  app so you can follow them, and let you invite whoever isn't. */
function ContactsTab() {
  const contacts = useContacts();
  const follows = useFollows();
  const blocks = useBlocks();

  useEffect(() => {
    contacts.load();
    // Only on first mount of this tab — load() is stable (useCallback with
    // no deps) and re-running it on every render would re-prompt/re-scan
    // the whole contact list pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (contacts.status === 'idle' || contacts.status === 'loading') {
    return (
      <View style={styles.list}>
        <Text variant="callout" tone="inkMuted">
          Checking your contacts…
        </Text>
        <RowsSkeleton testID="contacts-skeleton" />
      </View>
    );
  }

  if (contacts.status === 'denied') {
    return (
      <EmptyState
        icon="person.2.fill"
        message="Futty needs contacts access to show which of your contacts are already on the app."
        action={{ label: 'Try again', onPress: contacts.load }}
      />
    );
  }

  if (contacts.status === 'error') {
    return (
      <Banner
        tone="danger"
        message={`Could not load contacts: ${contacts.message}`}
        action={{ label: 'Try again', onPress: contacts.load }}
      />
    );
  }

  return (
    <View style={styles.sections}>
      {contacts.matched.length > 0 ? (
        <View style={styles.list}>
          <SectionHeader title={`On Futty (${contacts.matched.length})`} />
          {contacts.matched.map((contact) => (
            <MatchedContactRow key={contact.id} contact={contact} follows={follows} blocks={blocks} />
          ))}
        </View>
      ) : null}

      {contacts.unmatched.length > 0 ? (
        <View style={styles.list}>
          <SectionHeader title={`Invite to Futty (${contacts.unmatched.length})`} />
          {contacts.unmatched.map((contact) => (
            <UnmatchedContactRow key={contact.id} contact={contact} />
          ))}
        </View>
      ) : null}

      {contacts.matched.length === 0 && contacts.unmatched.length === 0 ? (
        <EmptyState icon="person.2.fill" message="No contacts with phone numbers found." />
      ) : null}
    </View>
  );
}

function TeamsTab() {
  const [teams, setTeams] = useState<TeamListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const follows = useFollows();

  useEffect(() => {
    listTeams().then(({ data, error: listError }) => {
      if (listError) setError(listError.message);
      else setTeams(data);
    });
  }, []);

  return (
    <View style={styles.list}>
      {error ? <Banner tone="danger" message={`Could not load: ${error}`} /> : null}
      {!teams && !error ? <RowsSkeleton testID="teams-list-skeleton" /> : null}
      {teams && teams.length === 0 ? <EmptyState icon="person.2.fill" message="No teams registered yet." /> : null}
      {teams?.map((team) => (
        <PersonRow
          key={team.id}
          name={team.name}
          subtitle={team.city}
          onPress={() => router.push({ pathname: '/team-profile', params: { teamId: team.id } })}
          actions={<FollowButton targetType="team" targetId={team.id} follows={follows} />}
        />
      ))}
    </View>
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
      <View style={styles.chipRow}>
        <Chip label="Contacts" selected={view === 'contacts'} onPress={() => setView('contacts')} />
        <Chip label="Teams" selected={view === 'teams'} onPress={selectTeams} />
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
  hidden: { display: 'none' },
  flex: { flex: 1 },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sections: { gap: space.xl },
  list: { gap: space.md },
  personCard: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: MIN_TOUCH },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pressed: { opacity: 0.8 },
  moderationPanel: {
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
