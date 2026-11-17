// The player's "Check in" for one game (P6 check-in QR), on the booking
// detail and the match page. docs/specs/match-record.md decision 1a.4: the
// QR check-in is open from 60 minutes before kickoff until 1 hour after the
// end. Before then the panel says when it opens (Cyprus time); inside it,
// "Check in" scans the venue's QR or takes the typed code; after it, the
// panel is gone. check_in_to_match decides; an already checked-in player is
// told so (it's idempotent, so a second scan is a success too).
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CheckInScanner } from '@/components/booking/check-in-scanner';
import { Button, Card, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { useNow } from '@/lib/booking-search';
import {
  checkInErrorWords,
  checkInToMatch,
  fetchCheckInMatch,
  fetchMyCheckIn,
  opensAtLabel,
  windowState,
  type CheckInMatch,
} from '@/lib/check-in';

export type CheckInPanelProps = {
  match: CheckInMatch;
  checkedIn: boolean;
  now: Date;
  /** Resolves to the refusal in words, or null once checked in. */
  onCheckIn: (code: string) => Promise<string | null>;
};

export function CheckInPanel({ match, checkedIn, now, onCheckIn }: CheckInPanelProps) {
  const [scanning, setScanning] = useState(false);
  const [done, setDone] = useState(false);
  const state = windowState(match, now);

  if (state === 'closed') return null;

  async function submit(code: string) {
    const refusal = await onCheckIn(code);
    if (!refusal) {
      setDone(true);
      setScanning(false);
    }
    return refusal;
  }

  let body: React.ReactNode;
  if (state === 'before') {
    body = <Text tone="inkMuted" tabular>{`Check-in opens at ${opensAtLabel(match)}`}</Text>;
  } else if (checkedIn || done) {
    body = (
      <Text tone="success" accessibilityRole="alert">
        {"You're checked in."}
      </Text>
    );
  } else if (scanning) {
    body = <CheckInScanner matchId={match.id} onSubmit={submit} onCancel={() => setScanning(false)} />;
  } else {
    body = (
      <>
        <Text tone="inkMuted">Scan the QR the venue shows you when you arrive.</Text>
        <Button label="Check in" onPress={() => setScanning(true)} />
      </>
    );
  }

  return (
    <Card testID="check-in-panel">
      <View style={styles.stack}>
        <Text variant="headline">Check-in</Text>
        {body}
      </View>
    </Card>
  );
}

type Loaded = { match: CheckInMatch; checkedIn: boolean };

/** Loads the game and the player's check-in, and checks in on the server.
 *  Shows nothing when there's no match or it can't be read. */
export function CheckInSection(props: ({ bookingId: string } | { matchId: string }) & { now?: Date }) {
  const { user } = useAuth();
  const clock = useNow();
  const now = props.now ?? clock;
  const bookingId = 'bookingId' in props ? props.bookingId : null;
  const matchId = 'matchId' in props ? props.matchId : null;
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: match } = await fetchCheckInMatch(bookingId ? { bookingId } : { matchId: matchId! });
      if (!match || !userId) {
        if (live) setLoaded(null);
        return;
      }
      const { data: checkedIn } = await fetchMyCheckIn(match.id, userId);
      if (live) setLoaded({ match, checkedIn });
    })();
    return () => {
      live = false;
    };
  }, [bookingId, matchId, userId]);

  const checkIn = useCallback(
    async (code: string) => {
      if (!loaded) return checkInErrorWords('match_not_found');
      const { error } = await checkInToMatch(loaded.match.id, code);
      return error ? checkInErrorWords(error.message) : null;
    },
    [loaded],
  );

  if (!loaded) return null;
  return <CheckInPanel match={loaded.match} checkedIn={loaded.checkedIn} now={now} onCheckIn={checkIn} />;
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
