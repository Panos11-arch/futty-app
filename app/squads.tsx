import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { describeSquadError } from '@/lib/squad-errors';
import {
  cancelOppositionOffer,
  describeOppositionPostNeed,
  describePlayerPostNeed,
  leaveSquadPost,
  offerOpposition,
} from '@/lib/squads';
import { useMyTeams } from '@/lib/use-my-teams';
import { useSquadPosts, type SquadPostWithDetails } from '@/lib/use-squad-posts';

// Cancelling a matched opposition post is blocked from 30 minutes before
// kickoff onward — matches cancel_opposition_offer's server-side check
// (supabase/scores.sql).
const CANCEL_WINDOW_MS = 30 * 60 * 1000;

function formatWhen(iso: string) {
  const date = new Date(iso);
  const day = date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

/** One of the small labeled boxes on a post card — where, when, how many
 *  needed, how many spots are left. A different accent tint per box makes
 *  the card easier to scan at a glance. */
function InfoBox({ label, value, tint }: { label: string; value: string; tint: string }) {
  return (
    <View style={[styles.infoBox, { borderColor: tint, backgroundColor: tint + '14' }]}>
      <ThemedText type="defaultSemiBold" style={styles.infoBoxValue}>
        {value}
      </ThemedText>
      <ThemedText style={styles.note}>{label}</ThemedText>
    </View>
  );
}

function PlayersPostCard({ post, onChanged }: { post: SquadPostWithDetails; onChanged: () => void }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spotsLeft = (post.players_needed ?? 0) - post.joined_count;
  const full = spotsLeft <= 0;

  async function leave() {
    setBusy(true);
    setError(null);
    const { error: leaveError } = await leaveSquadPost(post.id);
    setBusy(false);
    if (leaveError) setError(describeSquadError(leaveError));
    else onChanged();
  }

  return (
    <ThemedView style={[styles.card, { borderColor: border }]}>
      <ThemedText type="defaultSemiBold">{post.venue_name}</ThemedText>
      <ThemedText style={styles.note}>
        {post.venue_city ?? 'Unknown city'} · {post.format}
        {post.level ? ` · ${post.level}` : ''}
      </ThemedText>

      {describePlayerPostNeed(post) ? (
        <View style={styles.quote}>
          <ThemedText style={styles.quoteText}>&ldquo;{describePlayerPostNeed(post)}&rdquo;</ThemedText>
        </View>
      ) : null}

      <View style={styles.infoRow}>
        <InfoBox label="When" value={formatWhen(post.scheduled_at)} tint={FuttyColors.sky500} />
        <InfoBox label="Needed" value={String(post.players_needed ?? 0)} tint={FuttyColors.coral500} />
        <InfoBox
          label={full ? 'Status' : 'Spots left'}
          value={full ? 'Full' : String(spotsLeft)}
          tint={full ? FuttyColors.stone400 : FuttyColors.emerald700}
        />
      </View>

      {post.roster.length > 0 ? (
        <View style={styles.roster}>
          {post.roster.map((player) => (
            <View key={player.profileId} style={styles.rosterRow}>
              <ThemedText style={styles.rosterName}>{player.name}</ThemedText>
              <ThemedText style={styles.rosterTier}>{player.tier}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}

      {error ? <AuthError>{error}</AuthError> : null}

      {post.joined_by_me ? (
        <AuthButton label="Cancel" variant="secondary" onPress={leave} busy={busy} compact />
      ) : (
        <AuthButton
          label={full ? 'Full' : 'Join & Pay My Share'}
          onPress={() => router.push({ pathname: '/join-squad-post', params: { postId: post.id } })}
          disabled={full}
          compact
        />
      )}
    </ThemedView>
  );
}

function OppositionPostCard({ post, onChanged }: { post: SquadPostWithDetails; onChanged: () => void }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const myTeams = useMyTeams();
  const [offering, setOffering] = useState(false);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const captainTeams =
    myTeams.status === 'ready'
      ? myTeams.teams.filter((t) => t.role === 'captain' && t.team.id !== post.team_id)
      : [];

  // Either side of a matched post — the original poster's team or the team
  // that offered — can cancel it, so this checks both, not just the one the
  // "Offer" form above cares about.
  const myCaptainTeamIds =
    myTeams.status === 'ready'
      ? new Set(myTeams.teams.filter((t) => t.role === 'captain').map((t) => t.team.id))
      : new Set<string>();
  const isMyMatch =
    post.status === 'matched' &&
    ((post.team_id ? myCaptainTeamIds.has(post.team_id) : false) ||
      (post.matched_team_id ? myCaptainTeamIds.has(post.matched_team_id) : false));
  const canCancel = isMyMatch && new Date(post.scheduled_at).getTime() - CANCEL_WINDOW_MS > Date.now();

  async function submitOffer() {
    if (!teamId) return;
    setBusy(true);
    setError(null);
    const { error: offerError } = await offerOpposition(post.id, teamId);
    setBusy(false);
    if (offerError) {
      setError(describeSquadError(offerError));
    } else {
      setOffering(false);
      onChanged();
    }
  }

  async function cancelMatch() {
    setBusy(true);
    setError(null);
    const { error: cancelError } = await cancelOppositionOffer(post.id);
    setBusy(false);
    if (cancelError) setError(describeSquadError(cancelError));
    else onChanged();
  }

  return (
    <ThemedView style={[styles.card, { borderColor: border }]}>
      <View style={styles.teamNameRow}>
        <ThemedText type="defaultSemiBold">{post.team_name}</ThemedText>
        {post.team_level ? (
          <View style={[styles.tag, { borderColor: FuttyColors.amber400 }]}>
            <ThemedText style={[styles.tagText, { color: FuttyColors.stone700 }]}>{post.team_level}</ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText style={styles.note}>
        {post.venue_name} · {post.venue_city ?? 'Unknown city'} · {post.format}
        {post.level ? ` · ${post.level}` : ''}
      </ThemedText>

      {describeOppositionPostNeed(post) ? (
        <View style={styles.quote}>
          <ThemedText style={styles.quoteText}>&ldquo;{describeOppositionPostNeed(post)}&rdquo;</ThemedText>
        </View>
      ) : null}

      <View style={styles.infoRow}>
        <InfoBox label="Where" value={post.venue_name} tint={FuttyColors.violet500} />
        <InfoBox label="When" value={formatWhen(post.scheduled_at)} tint={FuttyColors.sky500} />
        <InfoBox
          label="Status"
          value={post.status === 'matched' ? 'Matched' : 'Open'}
          tint={post.status === 'matched' ? FuttyColors.emerald700 : FuttyColors.coral500}
        />
      </View>

      {post.status === 'matched' ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/fixture-confirmed', params: { kind: 'squad', id: post.id } })}>
            <ThemedText type="link" style={styles.note}>
              Matched vs {post.matched_team_name} — view fixture
            </ThemedText>
          </Pressable>
          {error ? <AuthError>{error}</AuthError> : null}
          {isMyMatch ? (
            canCancel ? (
              <AuthButton label="Cancel" variant="secondary" onPress={cancelMatch} busy={busy} compact />
            ) : (
              <ThemedText style={styles.note}>Too close to kickoff to cancel now.</ThemedText>
            )
          ) : null}
        </>
      ) : offering ? (
        <>
          {captainTeams.length === 0 ? (
            <ThemedText style={styles.note}>You need to captain a team first.</ThemedText>
          ) : (
            <View style={styles.wrapRow}>
              {captainTeams.map(({ team }) => (
                <Chip
                  key={team.id}
                  label={team.name}
                  selected={teamId === team.id}
                  onPress={() => setTeamId(team.id)}
                />
              ))}
            </View>
          )}
          {error ? <AuthError>{error}</AuthError> : null}
          <View style={styles.confirmRow}>
            {captainTeams.length > 0 ? (
              <View style={styles.confirmButton}>
                <AuthButton label="Offer" onPress={submitOffer} disabled={!teamId} busy={busy} />
              </View>
            ) : null}
            <View style={styles.confirmButton}>
              <AuthButton
                label="Cancel"
                variant="secondary"
                onPress={() => setOffering(false)}
                disabled={busy}
              />
            </View>
          </View>
        </>
      ) : (
        <AuthButton label="Offer to play them" onPress={() => setOffering(true)} compact />
      )}
    </ThemedView>
  );
}

export default function SquadsScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const [view, setView] = useState<'players' | 'opposition'>(
    params.view === 'opposition' ? 'opposition' : 'players'
  );
  const posts = useSquadPosts(view);

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.wrapRow}>
          <Chip
            label="Need players"
            icon="person.2.fill"
            selected={view === 'players'}
            onPress={() => setView('players')}
          />
          <Chip
            label="Need opposition"
            icon="flag.fill"
            selected={view === 'opposition'}
            onPress={() => setView('opposition')}
          />
        </View>

        {posts.status === 'loading' ? <ActivityIndicator /> : null}
        {posts.status === 'error' ? (
          <ThemedText style={styles.note}>Could not load: {posts.message}</ThemedText>
        ) : null}
        {posts.status === 'ready' && posts.posts.length === 0 ? (
          <ThemedText style={styles.note}>Nothing open right now — check back soon.</ThemedText>
        ) : null}

        {posts.status === 'ready'
          ? posts.posts.map((post) =>
              view === 'players' ? (
                <PlayersPostCard key={post.id} post={post} onChanged={posts.reload} />
              ) : (
                <OppositionPostCard key={post.id} post={post} onChanged={posts.reload} />
              )
            )
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 10,
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
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  infoBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 84,
    flexGrow: 1,
  },
  infoBoxValue: {
    fontSize: 13,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmButton: {
    flex: 1,
  },
  tag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: FuttyColors.amber400,
    paddingLeft: 12,
    paddingVertical: 4,
  },
  quoteText: {
    fontSize: 13,
    fontStyle: 'italic',
    color: FuttyColors.stone700,
  },
  teamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roster: {
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
    paddingTop: 8,
  },
  rosterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rosterName: {
    fontSize: 13,
  },
  rosterTier: {
    fontSize: 12,
    fontWeight: '600',
    color: FuttyColors.stone500,
  },
});
