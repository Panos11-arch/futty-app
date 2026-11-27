// S10A admin: set the groups by hand (or draw them on the manage screen).
// Each team goes into A, B, C or D; four per group, in the order picked
// (that order is the group's fixture order). The server checks the 16.
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { TeamBadge } from '@/components/match/team-badge';
import { Chip } from '@/components/ui/chip';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { adminSetGroups, GROUP_LETTERS, type GroupLetter, type GroupsInput, type TournamentTeam } from '@/lib/match/tournament-api';
import { describeTournamentError } from '@/lib/match/tournament-errors';
import { makeStyles } from '@/lib/theme';

const EMPTY: GroupsInput = { A: [], B: [], C: [], D: [] };

/** Moves a team into a group (out of any other), at the end. */
export function placeTeam(groups: GroupsInput, teamId: string, group: GroupLetter): GroupsInput {
  const next = { A: [...groups.A], B: [...groups.B], C: [...groups.C], D: [...groups.D] };
  for (const g of GROUP_LETTERS) next[g] = next[g].filter((id) => id !== teamId);
  if (groups[group].includes(teamId)) return next;
  if (next[group].length >= 4) return groups;
  next[group].push(teamId);
  return next;
}

export const groupsComplete = (groups: GroupsInput) => GROUP_LETTERS.every((g) => groups[g].length === 4);

export function AdminGroupsSheet({
  visible,
  tournamentId,
  teams,
  onClose,
  onDone,
}: {
  visible: boolean;
  tournamentId: string;
  teams: TournamentTeam[];
  onClose: () => void;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [groups, setGroups] = useState<GroupsInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setGroups(EMPTY);
      setError(null);
    }
  }, [visible]);

  async function save() {
    setBusy(true);
    setError(null);
    const { error: saveError } = await adminSetGroups(tournamentId, groups);
    setBusy(false);
    if (saveError) {
      haptic.error();
      setError(describeTournamentError(saveError));
      return;
    }
    haptic.success();
    onDone();
    onClose();
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Set groups"
      primaryAction={{ label: 'Save groups', onPress: () => void save(), loading: busy, disabled: !groupsComplete(groups), testID: 'admin-groups-save' }}>
      <ScrollView style={styles.list} nestedScrollEnabled testID="admin-groups-list">
        {teams.map((t) => (
          <View key={t.teamId} style={styles.row}>
            <TeamBadge name={t.teamName} kitColour={t.kitColour} size={32} />
            <Text variant="body" numberOfLines={1} style={styles.flex}>
              {t.teamName}
            </Text>
            <View style={styles.chips}>
              {GROUP_LETTERS.map((g) => (
                <Chip
                  key={g}
                  label={g}
                  selected={groups[g].includes(t.teamId)}
                  onPress={() => setGroups((cur) => placeTeam(cur, t.teamId, g))}
                  testID={`admin-groups-${t.teamId}-${g}`}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="admin-groups-error">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  list: { maxHeight: space.xxl * 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', gap: space.xs },
}));
