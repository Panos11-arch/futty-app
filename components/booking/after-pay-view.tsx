// The screen after paying (B3; spec 13 "Invites, after payment", "Publish
// game"): the pitch name, the day and time; "Invite friends" (by username,
// and the share menu; the friends list comes with S20); on a half pitch,
// side A's captain's "Invite opposition" (players and teams, plus a
// "Publish" switch); and "Publish game". Nothing here has an amount.
import { useRef, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';

import {
  Banner,
  Button,
  Chip,
  EmptyState,
  ListRow,
  SectionHeader,
  SkeletonBlock,
  SkeletonText,
  StatusPill,
  StickyActionBar,
  Text,
  TextField,
} from '@/components/ui';
import { AmenityIcons, FoodCards } from '@/components/venue/venue-extras';
import { space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';
import type { BookingDetailData } from '@/lib/booking-detail';
import type { TeamResult } from '@/lib/booking-opposition';
import { slotLabel, type LoadState } from '@/lib/booking-search';
import type { VenueExtras } from '@/lib/venue-extras';

export type AfterPayViewProps = {
  state: LoadState<BookingDetailData>;
  onRetry: () => void;
  /** Each resolves to an error message, or null once done. */
  onInviteFriend: (username: string) => Promise<string | null>;
  onShare: () => void;
  onSearchTeams: (query: string) => Promise<TeamResult[]>;
  onInviteOpposition: (choice: { usernames: string[]; teamIds: string[] }) => Promise<string | null>;
  onPublishOpposition: (on: boolean) => Promise<string | null>;
  onPublishGame: (on: boolean) => Promise<string | null>;
  onDone: () => void;
  /** S5A: the venue's food, drink and amenities; null until loaded, or if they can't be. */
  atVenue?: VenueExtras | null;
};

export function AfterPayView(props: AfterPayViewProps) {
  const styles = useStyles();
  const { state } = props;
  if (state.status === 'loading') {
    return (
      <View style={styles.screen}>
        <View style={styles.content}>
          <SkeletonText lines={2} variant="headline" />
          <SkeletonBlock width="100%" height={120} />
        </View>
      </View>
    );
  }
  if (state.status === 'error') {
    return (
      <View style={styles.screen}>
        <EmptyState icon="exclamationmark.circle.fill" message={state.message} action={{ label: 'Try again', onPress: props.onRetry }} />
      </View>
    );
  }
  return <AfterPayReady {...props} detail={state.data} />;
}

/** A switch that calls the server and goes back if it refuses. */
function PublishSwitch({
  testID,
  label,
  line,
  initial,
  onChange,
}: {
  testID: string;
  label: string;
  line: string;
  initial: boolean;
  onChange: (on: boolean) => Promise<string | null>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: boolean) {
    if (busy) return;
    setOn(next);
    setBusy(true);
    setError(null);
    const message = await onChange(next);
    setBusy(false);
    if (message) {
      setOn(!next);
      setError(message);
    }
  }

  return (
    <View style={styles.group}>
      <View style={styles.switchRow}>
        <View style={styles.grow}>
          <Text variant="body">{label}</Text>
          <Text variant="callout" tone="inkMuted">
            {line}
          </Text>
        </View>
        <Switch
          testID={testID}
          accessibilityLabel={label}
          value={on}
          disabled={busy}
          onValueChange={change}
          trackColor={{ true: colors.brand, false: colors.border }}
          thumbColor={colors.surface}
        />
      </View>
      {error ? <Banner tone="danger" message={error} /> : null}
    </View>
  );
}

function AfterPayReady({
  detail,
  onInviteFriend,
  onShare,
  onSearchTeams,
  onInviteOpposition,
  onPublishOpposition,
  onPublishGame,
  onDone,
  atVenue = null,
}: Omit<AfterPayViewProps, 'state' | 'onRetry'> & { detail: BookingDetailData }) {
  const styles = useStyles();
  const { booking, venue } = detail;
  const v2 = detail.v2 ?? null;
  const half = v2?.kind === 'half';
  // Whole pitch: the booker. Half pitch: each side's captain for his side.
  const captain = half ? v2!.captain_of !== null : detail.is_booker;
  const opposition = half && v2!.captain_of === 'a' ? v2!.opposition : null;

  // ---- Invite friends -----------------------------------------------------
  const [username, setUsername] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  async function invite() {
    const name = username.trim();
    if (!name || inviting) return;
    setInviting(true);
    setInviteError(null);
    setInvited(null);
    const error = await onInviteFriend(name);
    setInviting(false);
    if (error) setInviteError(error);
    else {
      setInvited(name);
      setUsername('');
    }
  }

  // ---- Invite opposition ---------------------------------------------------
  const [player, setPlayer] = useState('');
  const [players, setPlayers] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TeamResult[]>([]);
  const [teams, setTeams] = useState<TeamResult[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const searchRef = useRef(0);

  function addPlayer() {
    const name = player.trim();
    if (!name) return;
    setPlayers((list) => (list.includes(name) ? list : [...list, name]));
    setPlayer('');
  }

  async function search(text: string) {
    setQuery(text);
    const request = ++searchRef.current;
    try {
      const found = await onSearchTeams(text);
      if (searchRef.current === request) setResults(found);
    } catch {
      if (searchRef.current === request) setResults([]);
    }
  }

  function toggleTeam(team: TeamResult) {
    setTeams((list) => (list.some((t) => t.id === team.id) ? list.filter((t) => t.id !== team.id) : [...list, team]));
  }

  async function send() {
    if (sending || (players.length === 0 && teams.length === 0)) return;
    setSending(true);
    setSendError(null);
    setSent(false);
    const error = await onInviteOpposition({ usernames: players, teamIds: teams.map((t) => t.id) });
    setSending(false);
    if (error) setSendError(error);
    else {
      setSent(true);
      setPlayers([]);
      setTeams([]);
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.group}>
          <Text variant="title" accessibilityRole="header">
            {v2?.pitch_label ?? venue.name}
          </Text>
          <Text variant="body" tone="inkMuted" tabular>
            {slotLabel(booking.booking_day, booking.start_time, booking.end_time)}
          </Text>
          {v2?.pitch_label ? (
            <Text variant="body" tone="inkMuted">
              {venue.name}
            </Text>
          ) : null}
          {/* QA 24 November, S4: the payment went through; Confirmed once
              the payment webhook has confirmed the booking on the server. */}
          <View testID="after-pay-status" style={styles.status}>
            <StatusPill status={booking.status === 'confirmed' ? 'confirmed' : 'paid'} />
          </View>
        </View>

        {captain ? (
          <View style={styles.section} testID="after-pay-invite-friends">
            <SectionHeader title="Invite friends" />
            <TextField
              label="Username"
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                setInviteError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              error={inviteError ?? undefined}
              helper={invited ? `Invite sent to ${invited}. They'll show up in the booking once they accept.` : undefined}
              editable={!inviting}
            />
            <Button testID="after-pay-invite" label="Invite" variant="secondary" onPress={invite} loading={inviting} disabled={!username.trim()} />
            <Button testID="after-pay-share" label="Share" variant="secondary" onPress={onShare} />
          </View>
        ) : null}

        {half && v2!.captain_of === 'a' && v2!.opposition?.found ? (
          <Banner tone="info" message="Opposition found." />
        ) : null}

        {opposition?.open ? (
          <View style={styles.section} testID="after-pay-opposition">
            <SectionHeader title="Invite opposition" />
            <View style={styles.inline}>
              <View style={styles.grow}>
                <TextField
                  label="Player's username"
                  value={player}
                  onChangeText={setPlayer}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <Button testID="after-pay-add-player" label="Add" variant="secondary" onPress={addPlayer} disabled={!player.trim()} />
            </View>
            <TextField label="Search teams" value={query} onChangeText={search} autoCorrect={false} />
            {results.map((team) => {
              const picked = teams.some((t) => t.id === team.id);
              return (
                <ListRow
                  key={team.id}
                  testID={`after-pay-team-${team.id}`}
                  title={team.name}
                  subtitle={team.city ?? undefined}
                  onPress={() => toggleTeam(team)}
                  trailing={
                    picked ? (
                      <Text variant="callout" tone="brand">
                        Added
                      </Text>
                    ) : undefined
                  }
                />
              );
            })}
            {players.length + teams.length > 0 ? (
              <View style={styles.chips}>
                {players.map((name) => (
                  <Chip
                    key={`p-${name}`}
                    testID={`after-pay-player-${name}`}
                    label={name}
                    selected
                    onPress={() => setPlayers((list) => list.filter((n) => n !== name))}
                  />
                ))}
                {teams.map((team) => (
                  <Chip key={`t-${team.id}`} label={team.name} selected onPress={() => toggleTeam(team)} />
                ))}
              </View>
            ) : null}
            <Button
              testID="after-pay-send-opposition"
              label="Send invites"
              onPress={send}
              loading={sending}
              disabled={players.length === 0 && teams.length === 0}
            />
            {sendError ? <Banner tone="danger" message={sendError} /> : null}
            {sent ? (
              <Text variant="callout" tone="inkMuted">
                Invites sent. The first captain to accept plays you.
              </Text>
            ) : null}
            <PublishSwitch
              testID="after-pay-publish-opposition"
              label="Publish"
              line="Any team can take it on in Find a game."
              initial={v2!.posts.opposition !== null}
              onChange={onPublishOpposition}
            />
          </View>
        ) : null}

        {captain ? (
          <View style={styles.section}>
            <SectionHeader title="Publish game" />
            <PublishSwitch
              testID="after-pay-publish-game"
              label="Publish game"
              line="Anyone can join your open spots in Find a game."
              initial={v2?.posts.players != null}
              onChange={onPublishGame}
            />
          </View>
        ) : null}

        {/* S5A: only what the venue has entered. */}
        {atVenue && (atVenue.food.length > 0 || atVenue.amenities.length > 0) ? (
          <View style={styles.section} testID="after-pay-at-venue">
            <SectionHeader title="At the venue" />
            <FoodCards testID="after-pay-food" cards={atVenue.food} />
            <AmenityIcons testID="after-pay-amenities" amenities={atVenue.amenities.map((kind) => ({ kind }))} />
          </View>
        ) : null}
      </ScrollView>
      <StickyActionBar actionTestID="after-pay-done" actionLabel="Go to booking" onPress={onDone} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.md },
  group: { gap: space.xs },
  status: { flexDirection: 'row' },
  inline: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  grow: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
}));
