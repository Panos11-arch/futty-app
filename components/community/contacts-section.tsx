// "From your contacts" in Find players (S7; was Community's Contacts view).
// The same logic as before: read the phone's contacts only when the section
// is opened, show who's on Futty (Follow, Block, Report) and invite the rest.
// The server leaves out the other age group (A4, A5).
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { FollowToggle } from '@/components/community/follow-toggle';
import { PersonRow, RowsSkeleton } from '@/components/community/person-row';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { hairline, space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import type { MatchedContact, UnmatchedContact } from '@/lib/contacts';
import { shareContactInvite } from '@/lib/invite';
import { submitReport } from '@/lib/moderation';
import { makeStyles } from '@/lib/theme';
import { useBlocks } from '@/lib/use-blocks';
import { useContacts } from '@/lib/use-contacts';
import type { useFollows } from '@/lib/use-follows';

/** Block + report for a matched contact, collapsed behind a flag icon so the
 *  default row stays compact. Reporting is insert-only
 *  (supabase/moderation.sql): there's nothing to show back afterward beyond
 *  a plain confirmation. */
function ContactModerationPanel({ playerId, blocks }: { playerId: string; blocks: ReturnType<typeof useBlocks> }) {
  const styles = useStyles();
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
        />
        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
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
      testID={`contact-${contact.id}`}
      name={contact.name}
      subtitle={contact.match.username ? `@${contact.match.username}` : null}
      onPress={() => router.push({ pathname: '/player-profile', params: { profileId: contact.match.profileId } })}
      actions={
        <>
          <FollowToggle
            testID={`contact-follow-${contact.id}`}
            targetType="player"
            targetId={contact.match.profileId}
            name={contact.name}
            follows={follows}
          />
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
      testID={`contact-${contact.id}`}
      name={contact.name}
      actions={
        <Button
          testID={`contact-invite-${contact.id}`}
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

/** The contacts list itself. Reads contacts once, when it first mounts. */
export function ContactsList({ follows }: { follows: ReturnType<typeof useFollows> }) {
  const styles = useStyles();
  const contacts = useContacts();
  const blocks = useBlocks();

  useEffect(() => {
    contacts.load();
    // Only on first mount — load() is stable (useCallback with no deps) and
    // re-running it on every render would re-prompt/re-scan the whole
    // contact list pointlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (contacts.status === 'idle' || contacts.status === 'loading') {
    return <RowsSkeleton testID="contacts-skeleton" />;
  }

  if (contacts.status === 'denied') {
    return (
      <EmptyState
        icon="person.2.fill"
        message="Allow contacts to find friends on Futty."
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

/** Collapsed until tapped, so the contacts permission is asked only then. */
export function ContactsSection({ follows }: { follows: ReturnType<typeof useFollows> }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.list}>
      <Card padded={false}>
        <ListRow
          testID="community-contacts"
          title="From your contacts"
          leading={{ icon: 'person.2.fill' }}
          chevron={!open}
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((v) => !v)}
        />
      </Card>
      {open ? <ContactsList follows={follows} /> : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  sections: { gap: space.xl },
  list: { gap: space.md },
  moderationPanel: {
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
