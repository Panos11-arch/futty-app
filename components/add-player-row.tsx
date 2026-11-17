import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { space } from '@/constants/futty-theme';
import { shareTeamInvite } from '@/lib/invite';
import { describeInviteError } from '@/lib/invites';
import { findProfileByUsername, inviteTeamMember } from '@/lib/teams';

/** One "add a player" or "add a substitute" row — looks a username up and
 *  sends them a team invite if found (they join once they accept), or offers
 *  to invite them by link if not. Shared by the
 *  League tab's register-a-new-team flow and the Team tab's "fill your
 *  roster" flow for an already-registered team. */
export function AddPlayerRow({
  teamId,
  teamName,
  inviterUsername,
  role,
  remaining,
  onAdded,
}: {
  teamId: string;
  teamName: string;
  inviterUsername: string | null;
  role: 'player' | 'substitute';
  remaining: number;
  onAdded: (username: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  if (remaining <= 0) return null;

  async function submit() {
    const trimmed = username.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    setNotFound(null);
    setInvited(null);

    const { data: matches, error: lookupError } = await findProfileByUsername(trimmed);

    if (lookupError) {
      setBusy(false);
      setError(lookupError.message);
      return;
    }
    if (!matches || matches.length === 0) {
      setBusy(false);
      setNotFound(trimmed);
      return;
    }

    const { error: inviteError } = await inviteTeamMember(teamId, matches[0].id, role);
    setBusy(false);

    if (inviteError) {
      setError(describeInviteError(inviteError));
    } else {
      const name = matches[0].username ?? trimmed;
      setUsername('');
      setInvited(name);
      onAdded(name);
    }
  }

  const label = `${role === 'substitute' ? 'Add a substitute' : 'Add a player'} (${remaining} slot${remaining === 1 ? '' : 's'} left)`;

  return (
    <View style={styles.addRow}>
      <TextField
        label={label}
        value={username}
        onChangeText={(text) => {
          setUsername(text);
          setNotFound(null);
        }}
        placeholder="Their username"
        autoCapitalize="none"
        editable={!busy}
        onSubmitEditing={submit}
        returnKeyType="done"
      />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {invited ? (
        <Text variant="callout" tone="inkMuted">
          Invite sent to {invited} — they join once they accept.
        </Text>
      ) : null}
      {notFound ? (
        <>
          <Text variant="callout" tone="inkMuted">
            No one on Futty uses &quot;{notFound}&quot; yet — invite them instead?
          </Text>
          <Button
            label="Invite by message"
            variant="secondary"
            onPress={() => shareTeamInvite({ teamName, inviterUsername })}
          />
        </>
      ) : (
        <Button label="Invite" onPress={submit} disabled={!username.trim()} loading={busy} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  addRow: { gap: space.sm },
});
