// "Add house player" (supabase/house-players.sql; spec 05 section 12, item
// 11a "offer a player to a team that's short"), moved unchanged from the old
// app/venue-dashboard.tsx in P6c with a light restyle; the full restyle is
// P6e. For each of the day's bookings with an open "Need players" post still
// short a spot, staff can fill that spot for free with a named house player:
// no account, no payment hold (add_house_player checks the caller owns the
// venue).
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, SectionHeader, Text, TextField } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { describeSquadError } from '@/lib/squad-errors';
import { addHousePlayer } from '@/lib/squads';
import { supabase } from '@/lib/supabase';
import { bookingTitle, hhmm, type BoardBooking } from '@/lib/venue-today';

type PlayersPost = { id: string; bookingId: string; playersNeeded: number; joinedCount: number };

/** The open "Need players" posts linked to these bookings, with how many
 *  have joined each. */
function usePlayersPosts(bookingIds: string[]) {
  const [posts, setPosts] = useState<PlayersPost[]>([]);
  const requestIdRef = useRef(0);
  const key = bookingIds.join(',');

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) {
      setPosts([]);
      return;
    }
    const { data: squadPosts } = await supabase
      .from('squad_posts')
      .select('id, type, players_needed, venue_booking_id, status')
      .in('venue_booking_id', ids);
    if (requestIdRef.current !== requestId) return;
    const open = (squadPosts ?? []).filter((p) => p.type === 'players' && p.status === 'open' && p.venue_booking_id);
    const { data: joiners } =
      open.length > 0
        ? await supabase.from('squad_post_joiners').select('post_id').in('post_id', open.map((p) => p.id))
        : { data: [] as { post_id: string }[] };
    if (requestIdRef.current !== requestId) return;
    const joined = new Map<string, number>();
    for (const j of joiners ?? []) joined.set(j.post_id, (joined.get(j.post_id) ?? 0) + 1);
    setPosts(
      open.map((p) => ({
        id: p.id,
        bookingId: p.venue_booking_id as string,
        playersNeeded: p.players_needed ?? 0,
        joinedCount: joined.get(p.id) ?? 0,
      })),
    );
  }, [key]);

  useEffect(() => {
    reload();
    return () => {
      requestIdRef.current += 1;
    };
  }, [reload]);

  return { posts, reload };
}

export function NeedPlayersSection({ bookings }: { bookings: BoardBooking[] }) {
  const appBookings = bookings.filter((b) => b.kind === 'app');
  const { posts, reload } = usePlayersPosts(appBookings.map((b) => b.id));
  if (posts.length === 0) return null;
  const byId = new Map(appBookings.map((b) => [b.id, b]));
  return (
    <View style={styles.section}>
      <SectionHeader title="Need players" />
      {posts.map((post) => {
        const booking = byId.get(post.bookingId);
        return (
          <Card key={post.id}>
            <View style={styles.post}>
              {booking ? (
                <Text variant="headline" tabular>
                  {hhmm(booking.start_time)}–{hhmm(booking.end_time)} · {bookingTitle(booking)}
                </Text>
              ) : null}
              <AddHousePlayerRow postId={post.id} spotsLeft={post.playersNeeded - post.joinedCount} onAdded={reload} />
            </View>
          </Card>
        );
      })}
    </View>
  );
}

function AddHousePlayerRow({ postId, spotsLeft, onAdded }: { postId: string; spotsLeft: number; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (spotsLeft <= 0) {
    return <Text tone="inkMuted">Need players: full.</Text>;
  }

  if (!open) {
    return (
      <Button
        label={`Need players: ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left — add house player`}
        variant="plain"
        onPress={() => setOpen(true)}
      />
    );
  }

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { error: addError } = await addHousePlayer(postId, name.trim());
    setBusy(false);
    if (addError) {
      setError(describeSquadError(addError));
    } else {
      setName('');
      setOpen(false);
      onAdded();
    }
  }

  return (
    <View style={styles.post}>
      <TextField label="House player" value={name} onChangeText={setName} placeholder="Staff member's name" editable={!busy} />
      {error ? <Text tone="danger">{error}</Text> : null}
      <View style={styles.row}>
        <Button label="Add" onPress={submit} disabled={!name.trim()} loading={busy} />
        <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  post: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
});
