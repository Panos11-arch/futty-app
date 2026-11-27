// S10A admin: the organiser's draw, the last tiebreak (after points, goal
// difference, goals scored and head-to-head). Tap the group's teams in the
// order drawn, highest first; at least the two still level.
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { TeamBadge } from '@/components/match/team-badge';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { adminSetDrawOrder, type GroupStandings } from '@/lib/match/tournament-api';
import { describeTournamentError } from '@/lib/match/tournament-errors';
import { makeStyles } from '@/lib/theme';

export function AdminDrawSheet({
  tournamentId,
  group,
  onClose,
  onDone,
}: {
  tournamentId: string;
  /** null: closed. */
  group: GroupStandings | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const styles = useStyles();
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrder([]);
    setError(null);
  }, [group]);

  const toggle = (teamId: string) => {
    haptic.tap();
    setOrder((o) => (o.includes(teamId) ? o.filter((id) => id !== teamId) : [...o, teamId]));
  };

  async function save() {
    if (!group) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = await adminSetDrawOrder(tournamentId, group.group, order);
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
      visible={group !== null}
      onClose={onClose}
      title={group ? `Group ${group.group} draw` : 'Draw'}
      primaryAction={{ label: 'Save order', onPress: () => void save(), loading: busy, disabled: order.length < 2, testID: 'admin-draw-save' }}>
      <View testID="admin-draw-sheet">
        {(group?.rows ?? []).map((r) => {
          const place = order.indexOf(r.teamId);
          return (
            <ListRow
              key={r.teamId}
              testID={`admin-draw-${r.teamId}`}
              title={r.teamName}
              subtitle={`${r.points} pts · ${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}`}
              leading={undefined}
              trailing={
                <View style={styles.trailing}>
                  <TeamBadge name={r.teamName} kitColour={r.kitColour} size={24} />
                  <Text variant="headline" tabular>
                    {place >= 0 ? String(place + 1) : ''}
                  </Text>
                </View>
              }
              onPress={() => toggle(r.teamId)}
              accessibilityLabel={place >= 0 ? `${r.teamName}, drawn ${place + 1}` : r.teamName}
            />
          );
        })}
      </View>
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="admin-draw-error">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minWidth: space.xxl * 2, justifyContent: 'flex-end' },
}));
