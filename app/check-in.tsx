// futtyapp://check-in?match=<id>&code=<code> (P6 check-in QR): what opens
// when a player scans the venue's QR with the phone's own camera. It reads
// the link, shows the game, and checks in with check_in_to_match on a tap,
// never on open, so an old or accidental scan checks nobody in. The window
// (docs/specs/match-record.md decision 1a.4) is shown from the server's
// times in Cyprus time; the server decides.
//
// Not listed in app/_layout.tsx: like booking/[id] and match/[id], the
// route works on its own, and guards a signed-out player itself.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Card, SkeletonText, Text } from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { useNow } from '@/lib/booking-search';
import {
  checkInErrorWords,
  checkInToMatch,
  fetchCheckInMatch,
  fetchMyCheckIn,
  opensAtLabel,
  parseCheckInParams,
  windowState,
  type CheckInMatch,
} from '@/lib/check-in';
import { formatMatchWhen } from '@/lib/match/format';

type Load =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'not_found' }
  | { status: 'ready'; match: CheckInMatch; checkedIn: boolean };

function done() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function CheckInScreen() {
  const params = useLocalSearchParams<{ match?: string; code?: string }>();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const link = parseCheckInParams(params);
  const matchId = link.kind === 'ok' ? link.matchId : null;
  const now = useNow();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId || !userId) return;
    let live = true;
    setLoad({ status: 'loading' });
    (async () => {
      const { data: match, error } = await fetchCheckInMatch({ matchId });
      if (!live) return;
      if (error) return setLoad({ status: 'error' });
      if (!match) return setLoad({ status: 'not_found' });
      const { data: checkedIn } = await fetchMyCheckIn(match.id, userId);
      if (live) setLoad({ status: 'ready', match, checkedIn });
    })();
    return () => {
      live = false;
    };
  }, [matchId, userId, attempt]);

  const checkIn = useCallback(async () => {
    if (load.status !== 'ready' || link.kind !== 'ok') return;
    setBusy(true);
    setRefusal(null);
    const { error } = await checkInToMatch(load.match.id, link.code);
    setBusy(false);
    if (error) setRefusal(checkInErrorWords(error.message));
    else setLoad({ ...load, checkedIn: true });
  }, [load, link]);

  let content: React.ReactNode;
  if (!userId) {
    content = (
      <>
        <Text>Sign in to check in, then scan the venue’s code again.</Text>
        <Button label="Sign in" onPress={() => router.replace('/sign-in')} />
      </>
    );
  } else if (link.kind !== 'ok') {
    content = (
      <>
        <Text>{"This isn't a Futty check-in link. Scan the QR the venue shows you."}</Text>
        <Button label="Done" variant="secondary" onPress={done} />
      </>
    );
  } else if (load.status === 'loading') {
    content = <SkeletonText lines={2} />;
  } else if (load.status === 'error') {
    content = (
      <Banner
        tone="danger"
        message="Could not load this game."
        action={{ label: 'Try again', onPress: () => setAttempt((n) => n + 1) }}
      />
    );
  } else if (load.status === 'not_found') {
    content = (
      <>
        <Text>{"We couldn't find this game, or you're not in it."}</Text>
        <Button label="Done" variant="secondary" onPress={done} />
      </>
    );
  } else {
    const { match, checkedIn } = load;
    const state = windowState(match, now);
    const when = [formatMatchWhen(match.kickoff_at), match.venue_name].filter(Boolean).join(' · ');
    content = (
      <>
        <Text tone="inkMuted" tabular>
          {when}
        </Text>
        {checkedIn ? (
          <>
            <Text tone="success" accessibilityRole="alert">
              {"You're checked in."}
            </Text>
            <Button label="See the match" variant="secondary" onPress={() => router.replace(`/match/${match.id}`)} />
          </>
        ) : state === 'before' ? (
          <Text tabular>{`Check-in opens at ${opensAtLabel(match)}`}</Text>
        ) : state === 'closed' ? (
          <Text>{checkInErrorWords('check_in_closed')}</Text>
        ) : (
          <>
            {refusal ? (
              <Text tone="danger" accessibilityRole="alert">
                {refusal}
              </Text>
            ) : null}
            <Button label="Check in" loading={busy} onPress={checkIn} />
          </>
        )}
        <Button label="Done" variant="plain" onPress={done} />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Check-in' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={styles.stack}>
            <Text variant="headline">Check in to your game</Text>
            {content}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg },
  stack: { gap: space.md },
});
