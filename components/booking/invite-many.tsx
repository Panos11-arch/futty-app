// S20A (b): two quick ways to fill a side (spec 13 "Player invites"): invite
// every friend at once, or every other member of one of my teams. The server
// skips anyone who can't come (blocked, adult-minor, already in or invited)
// and says how many it invited.
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Chip, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { makeStyles } from '@/lib/theme';

export type InviteResult = { count: number; error: string | null };

/** Written out, so .maestro's guard finds them in the source. */
const TEST_IDS = {
  'after-pay': { all: { testID: 'after-pay-invite-all-friends' }, team: { testID: 'after-pay-invite-team' } },
  'booking-detail': {
    all: { testID: 'booking-detail-invite-all-friends' },
    team: { testID: 'booking-detail-invite-team' },
  },
} as const;

export type InviteManyProps = {
  /** Which screen: testIDs <prefix>-invite-all-friends, <prefix>-invite-team(-<team id>). */
  testIDPrefix: keyof typeof TEST_IDS;
  /** My teams (not deleted). */
  teams: { id: string; name: string }[];
  onInviteAllFriends: () => Promise<InviteResult>;
  onInviteTeam: (teamId: string) => Promise<InviteResult>;
};

function sentLine(count: number, team: string | null): string {
  if (count === 0) return 'Nobody new to invite.';
  if (team) return `Invited ${count} from ${team}.`;
  return `Invited ${count} ${count === 1 ? 'friend' : 'friends'}.`;
}

export function InviteMany({ testIDPrefix, teams, onInviteAllFriends, onInviteTeam }: InviteManyProps) {
  const styles = useStyles();
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [line, setLine] = useState<{ text: string; error: boolean } | null>(null);

  async function run(key: string, call: () => Promise<InviteResult>, team: string | null) {
    if (busy) return;
    setBusy(key);
    setLine(null);
    const { count, error } = await call();
    setBusy(null);
    if (error) {
      haptic.error();
      setLine({ text: error, error: true });
      return;
    }
    haptic.success();
    setPicking(false);
    setLine({ text: sentLine(count, team), error: false });
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Button
          {...TEST_IDS[testIDPrefix].all}
          label="Invite all friends"
          variant="secondary"
          onPress={() => void run('friends', onInviteAllFriends, null)}
          loading={busy === 'friends'}
        />
        {teams.length > 0 ? (
          <Button
            {...TEST_IDS[testIDPrefix].team}
            label="Invite a team"
            variant="secondary"
            onPress={() => setPicking((p) => !p)}
          />
        ) : null}
      </View>
      {picking ? (
        <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Your teams">
          {teams.map((t) => (
            <Chip
              key={t.id}
              testID={`${testIDPrefix}-invite-team-${t.id}`}
              label={t.name}
              selected={busy === t.id}
              onPress={() => void run(t.id, () => onInviteTeam(t.id), t.name)}
            />
          ))}
        </View>
      ) : null}
      {line ? (
        <Text variant="callout" tone={line.error ? 'danger' : 'inkMuted'} accessibilityLiveRegion="polite">
          {line.text}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
}));
