// "Need players" / "Need opposition" (spec 13 "Booking modes": the booker
// fills empty spots with a public request any Futty player can join). A
// squad post linked to this booking, at its kickoff. It only finds players
// or an opponent: how they pay follows the booking's own mode, priced by the
// server, so the post offers no payment choice (create_squad_post stores its
// default). Posts made before keep whatever they were made with.
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Chip, Text, TextField } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { describeSquadError } from '@/lib/squad-errors';
import {
  cancelSquadPost,
  createSquadPost,
  listMyOpenPostsForBooking,
  POSITIONS_NEEDED,
  SKILL_LEVELS,
  type PositionNeeded,
  type SkillLevel,
} from '@/lib/squads';
import { useMyTeams } from '@/lib/use-my-teams';
import { XP_TIERS, type XpTier } from '@/lib/xp-tier';

export type PostType = 'players' | 'opposition';

export type SquadChoice =
  | { type: 'players'; playersNeeded: number; level?: SkillLevel; positionNeeded?: PositionNeeded; levelNeeded?: XpTier }
  | { type: 'opposition'; teamId: string; level?: SkillLevel; levelNeeded?: XpTier };

export type SquadNeedBooking = {
  id: string;
  venueId: string;
  /** booking_detail's kickoff_at: the exact Cyprus kickoff, as an instant. */
  kickoffAt: string;
  format: string;
  openSpots: number;
};

/** What create_squad_post gets: the booking's venue, kickoff and format,
 *  linked to it, and the booker's choices. Never a payment mode. */
export function squadPostParams(booking: SquadNeedBooking, choice: SquadChoice): Parameters<typeof createSquadPost>[0] {
  const base = {
    venueId: booking.venueId,
    scheduledAt: booking.kickoffAt,
    format: booking.format,
    postType: choice.type,
    venueBookingId: booking.id,
    level: choice.level,
  };
  return choice.type === 'players'
    ? { ...base, playersNeeded: choice.playersNeeded, positionNeeded: choice.positionNeeded, levelNeeded: choice.levelNeeded }
    : { ...base, teamId: choice.teamId, levelNeeded: choice.levelNeeded };
}

export type SquadNeedPanelProps = {
  openSpots: number;
  captainTeams: { id: string; name: string }[];
  /** The booker's open posts for this booking, by type (post ids). */
  posted: Partial<Record<PostType, string>>;
  busy: PostType | null;
  error: string | null;
  onPost: (choice: SquadChoice) => void;
  onCancelPost: (type: PostType) => void;
};

/** Toggle chips: tap again to clear. */
function Choices<T extends string>({
  title,
  values,
  value,
  onChange,
  any,
}: {
  title: string;
  values: readonly T[];
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  any?: boolean;
}) {
  return (
    <View style={styles.group}>
      <Text variant="callout">{title}</Text>
      <View style={styles.wrap}>
        {any ? <Chip label="Any" selected={value === undefined} onPress={() => onChange(undefined)} /> : null}
        {values.map((v) => (
          <Chip key={v} label={v} selected={value === v} onPress={() => onChange(value === v ? undefined : v)} />
        ))}
      </View>
    </View>
  );
}

export function SquadNeedPanel({ openSpots, captainTeams, posted, busy, error, onPost, onCancelPost }: SquadNeedPanelProps) {
  const [mode, setMode] = useState<PostType | null>(null);
  const [count, setCount] = useState(String(Math.max(openSpots, 1)));
  const [level, setLevel] = useState<SkillLevel | undefined>();
  const [position, setPosition] = useState<PositionNeeded | undefined>();
  const [levelNeeded, setLevelNeeded] = useState<XpTier | undefined>();
  const [teamId, setTeamId] = useState<string | undefined>();

  // A post that went out closes its form.
  useEffect(() => {
    if (mode && posted[mode]) setMode(null);
  }, [mode, posted]);

  const errorBanner = error ? <Banner tone="danger" message={error} /> : null;

  if (mode === 'players') {
    const n = Number(count);
    return (
      <View style={styles.group}>
        <TextField
          label="How many more players?"
          value={count}
          onChangeText={(text) => setCount(text.replace(/\D/g, ''))}
          keyboardType="number-pad"
          editable={busy === null}
        />
        <Choices title="Skill level (optional)" values={SKILL_LEVELS} value={level} onChange={setLevel} />
        <Choices title="Position (optional)" values={POSITIONS_NEEDED} value={position} onChange={setPosition} any />
        <Choices title="Level (optional)" values={XP_TIERS} value={levelNeeded} onChange={setLevelNeeded} any />
        {errorBanner}
        <Button
          label={`Post: need ${n} ${n === 1 ? 'player' : 'players'}`}
          onPress={() => onPost({ type: 'players', playersNeeded: n, level, positionNeeded: position, levelNeeded })}
          loading={busy === 'players'}
          disabled={!n}
        />
        <Button label="Not now" variant="plain" onPress={() => setMode(null)} disabled={busy !== null} />
      </View>
    );
  }

  if (mode === 'opposition') {
    return (
      <View style={styles.group}>
        {captainTeams.length === 0 ? (
          <Text variant="body" tone="inkMuted">
            Only a team captain can post for opposition.
          </Text>
        ) : (
          <>
            <View style={styles.group}>
              <Text variant="callout">Which of your teams is playing?</Text>
              <View style={styles.wrap}>
                {captainTeams.map((t) => (
                  <Chip key={t.id} label={t.name} selected={teamId === t.id} onPress={() => setTeamId(t.id)} />
                ))}
              </View>
            </View>
            <Choices title="Skill level (optional)" values={SKILL_LEVELS} value={level} onChange={setLevel} />
            <Choices title="Opponent level (optional)" values={XP_TIERS} value={levelNeeded} onChange={setLevelNeeded} any />
            {errorBanner}
            <Button
              label="Post: need opposition"
              onPress={() => teamId && onPost({ type: 'opposition', teamId, level, levelNeeded })}
              loading={busy === 'opposition'}
              disabled={!teamId}
            />
          </>
        )}
        <Button label="Not now" variant="plain" onPress={() => setMode(null)} disabled={busy !== null} />
      </View>
    );
  }

  return (
    <View style={styles.group}>
      <Text variant="callout" tone="inkMuted">
        Short of players or an opponent? Post it for any Futty player to join.
      </Text>
      <View style={styles.wrap}>
        {posted.players ? (
          <Button label="Cancel players post" variant="secondary" onPress={() => onCancelPost('players')} loading={busy === 'players'} />
        ) : (
          <Button label="Need players" variant="secondary" onPress={() => setMode('players')} disabled={busy !== null} />
        )}
        {posted.opposition ? (
          <Button
            label="Cancel opposition post"
            variant="secondary"
            onPress={() => onCancelPost('opposition')}
            loading={busy === 'opposition'}
          />
        ) : (
          <Button label="Need opposition" variant="secondary" onPress={() => setMode('opposition')} disabled={busy !== null} />
        )}
      </View>
      {errorBanner}
    </View>
  );
}

/** The panel wired to the server: the booker's open posts, their captain
 *  teams, and creating or cancelling a post. */
export function SquadNeed({ booking }: { booking: SquadNeedBooking }) {
  const { user } = useAuth();
  const myTeams = useMyTeams();
  const [posted, setPosted] = useState<Partial<Record<PostType, string>>>({});
  const [busy, setBusy] = useState<PostType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPosts = useCallback(async () => {
    if (!user) return;
    const { data } = await listMyOpenPostsForBooking(booking.id, user.id);
    const next: Partial<Record<PostType, string>> = {};
    for (const row of data ?? []) next[row.type as PostType] = row.id;
    setPosted(next);
  }, [booking.id, user]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

  const captainTeams =
    myTeams.status === 'ready'
      ? myTeams.teams.filter((t) => t.role === 'captain').map((t) => ({ id: t.team.id, name: t.team.name }))
      : [];

  async function post(choice: SquadChoice) {
    setBusy(choice.type);
    setError(null);
    const { data, error: postError } = await createSquadPost(squadPostParams(booking, choice));
    setBusy(null);
    if (postError) setError(describeSquadError(postError));
    else if (data) setPosted((p) => ({ ...p, [choice.type]: data.id }));
  }

  async function cancel(type: PostType) {
    const id = posted[type];
    if (!id) return;
    setBusy(type);
    setError(null);
    const { error: cancelError } = await cancelSquadPost(id);
    setBusy(null);
    if (cancelError) setError(describeSquadError(cancelError));
    else setPosted((p) => ({ ...p, [type]: undefined }));
  }

  return (
    <SquadNeedPanel
      openSpots={booking.openSpots}
      captainTeams={captainTeams}
      posted={posted}
      busy={busy}
      error={error}
      onPost={post}
      onCancelPost={cancel}
    />
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
