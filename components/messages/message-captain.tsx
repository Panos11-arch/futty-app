import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import {
  chatHref,
  describeMessageError,
  fetchLeagueCaptainContacts,
  filterContacts,
  kitOf,
  openCaptainConversation,
  type CaptainContact,
} from '@/lib/messages';
import { makeStyles } from '@/lib/theme';

/** The sheet: the other teams of the league with their captain, and a search. */
export function CaptainPickerSheet({
  visible,
  onClose,
  contacts,
}: {
  visible: boolean;
  onClose: () => void;
  contacts: CaptainContact[];
}) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = filterContacts(contacts, query);

  useEffect(() => {
    if (visible) {
      setQuery('');
      setError(null);
    }
  }, [visible]);

  async function open(contact: CaptainContact) {
    if (opening) return;
    setOpening(contact.team_id);
    setError(null);
    const { conversationId, error: openError } = await openCaptainConversation(contact.my_team_id, contact.team_id);
    setOpening(null);
    if (openError || !conversationId) {
      setError(describeMessageError(openError));
      return;
    }
    onClose();
    router.push(chatHref(conversationId));
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Message a captain">
      <TextField
        label="Search"
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        testID="captain-search"
        accessibilityLabel="Search teams or captains"
      />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="captain-error">
          {error}
        </Text>
      ) : null}
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {shown.length === 0 ? (
          <Text variant="callout" tone="inkMuted" style={styles.empty}>
            No teams found.
          </Text>
        ) : (
          shown.map((c) => (
            <ListRow
              key={c.team_id}
              testID={`captain-row-${c.team_id}`}
              title={c.captain_name}
              subtitle={c.team_name}
              leading={{ avatar: { name: c.captain_name, kit: kitOf(c) } }}
              trailing={opening === c.team_id ? <Text variant="caption" tone="inkMuted">Opening</Text> : undefined}
              chevron
              onPress={() => open(c)}
              accessibilityLabel={`Message ${c.captain_name}, ${c.team_name}`}
            />
          ))
        )}
      </ScrollView>
    </Sheet>
  );
}

/**
 * "Message a captain", for the very bottom of a league's Matches tab. Shown
 * only to a captain of a team in that league: the server returns no teams
 * to anyone else.
 */
export function MessageCaptainButton({ leagueId }: { leagueId: string }) {
  const styles = useStyles();
  const [contacts, setContacts] = useState<CaptainContact[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    fetchLeagueCaptainContacts(leagueId)
      .then((rows) => {
        if (live) setContacts(rows);
      })
      .catch(() => {
        if (live) setContacts([]);
      });
    return () => {
      live = false;
    };
  }, [leagueId]);

  if (contacts.length === 0) return null;

  return (
    <View style={styles.button}>
      <Button
        testID="league-message-captain"
        label="Message a captain"
        variant="secondary"
        fullWidth
        onPress={() => setOpen(true)}
      />
      <CaptainPickerSheet visible={open} onClose={() => setOpen(false)} contacts={contacts} />
    </View>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: space.xxl * 10 },
  empty: { paddingVertical: space.md },
  button: { paddingTop: space.sm },
}));
