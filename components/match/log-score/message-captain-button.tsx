// "Message <captain>" on the score mismatch screen (follow-up to S13 and
// S13B): the captains of the two teams of a match can talk it through, even
// when the teams share no league. The server names the other team's current
// captain (a minor's first name only, A5) and decides who may open the chat
// (current captains only, blocks, adult-minor refused, A4). No captain to
// message: no button.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import {
  chatHref,
  describeMessageError,
  fetchMatchCaptainContact,
  openMatchCaptainConversation,
  type CaptainContact,
} from '@/lib/messages';
import { makeStyles } from '@/lib/theme';

export function MessageCaptainButton({ matchId }: { matchId: string }) {
  const styles = useStyles();
  const [contact, setContact] = useState<CaptainContact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMatchCaptainContact(matchId)
      .then((c) => {
        if (live) setContact(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [matchId]);

  if (!contact) return null;

  async function open() {
    if (busy) return;
    haptic.tap();
    setBusy(true);
    setError(null);
    const { conversationId, error: refusal } = await openMatchCaptainConversation(matchId);
    setBusy(false);
    if (conversationId) router.push(chatHref(conversationId));
    else setError(describeMessageError(refusal));
  }

  return (
    <View style={styles.wrap}>
      <Button
        testID="score-mismatch-message-captain"
        label={`Message ${contact.captain_name}`}
        variant="secondary"
        fullWidth
        loading={busy}
        onPress={() => void open()}
      />
      {error ? (
        <Text variant="callout" tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.sm },
}));
