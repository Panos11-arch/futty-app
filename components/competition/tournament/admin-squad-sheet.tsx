// S10A admin: change a registered team's squad (match-record.md 1o, item 3;
// decided by Panos, 27 November), e.g. an injury after the deadline. The
// squad and the team's members who could be added: tap to remove or add,
// then Save squad (admin_set_squad; the server checks the size, membership
// and one squad per player again). Below, the change log, newest first. A
// finished tournament can't change (invalid_status), so the sheet is then
// read-only: the squad and the log.
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';

import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { competitionPlayerLook, type CompetitionPlayer } from '@/lib/match/competition-api';
import {
  adminSetSquad,
  squadChangeMeta,
  squadChangeTitle,
  squadCountLabel,
  type AdminSquadTeam,
} from '@/lib/match/tournament-api';
import { describeTournamentError } from '@/lib/match/tournament-errors';
import { makeStyles, useTheme } from '@/lib/theme';

/** Whether two squads hold the same players, in any order. */
export function sameSquad(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function AdminSquadSheet({
  tournamentId,
  team,
  min,
  max,
  readOnly,
  onClose,
  onDone,
}: {
  tournamentId: string;
  /** null: closed. */
  team: AdminSquadTeam | null;
  min: number;
  max: number;
  /** A finished tournament: show the squad and the log only. */
  readOnly: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(team ? team.squad.map((p) => p.profileId) : []);
    setError(null);
  }, [team]);

  // Every player the sheet can show: the squad first, then the candidates.
  const players = useMemo(() => {
    const all = new Map<string, CompetitionPlayer>();
    for (const p of [...(team?.squad ?? []), ...(team?.candidates ?? [])]) all.set(p.profileId, p);
    return all;
  }, [team]);
  const inSquad = draft.map((id) => players.get(id)).filter((p): p is CompetitionPlayer => !!p);
  const toAdd = [...players.values()].filter((p) => !draft.includes(p.profileId));

  const original = team?.squad.map((p) => p.profileId) ?? [];
  const sizeOk = draft.length >= min && draft.length <= max;
  const canSave = !readOnly && sizeOk && !sameSquad(draft, original);

  const remove = (id: string) => {
    haptic.tap();
    setDraft((d) => d.filter((x) => x !== id));
  };
  const add = (id: string) => {
    haptic.tap();
    setDraft((d) => [...d, id]);
  };

  async function save() {
    if (!team || !canSave) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = await adminSetSquad(tournamentId, team.teamId, draft);
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
      visible={team !== null}
      onClose={onClose}
      title={team?.teamName ?? 'Squad'}
      primaryAction={
        readOnly
          ? undefined
          : { label: 'Save squad', onPress: () => void save(), loading: busy, disabled: !canSave, testID: 'admin-squad-save' }
      }>
      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} testID="admin-squad-sheet">
        <SectionHeader title={`Squad ${squadCountLabel(draft.length, min, max)}`} />
        <View>
          {inSquad.map((p) =>
            readOnly ? (
              <ListRow
                key={p.profileId}
                testID={`admin-squad-readonly-${p.profileId}`}
                title={p.name}
                leading={{ avatar: { name: p.name, kit: competitionPlayerLook(p) } }}
              />
            ) : (
              <ListRow
                key={p.profileId}
                testID={`admin-squad-player-${p.profileId}`}
                title={p.name}
                leading={{ avatar: { name: p.name, kit: competitionPlayerLook(p) } }}
                trailing={<IconSymbol name="minus" size={ICON.regular} color={colors.ink} />}
                onPress={() => remove(p.profileId)}
                accessibilityLabel={`Remove ${p.name}`}
              />
            ),
          )}
        </View>
        {readOnly ? null : (
          <>
            <SectionHeader title="Add players" />
            {toAdd.length === 0 ? (
              <Text variant="callout" tone="inkMuted" testID="admin-squad-no-candidates">
                No players to add.
              </Text>
            ) : (
              <View>
                {toAdd.map((p) => (
                  <ListRow
                    key={p.profileId}
                    testID={`admin-squad-candidate-${p.profileId}`}
                    title={p.name}
                    leading={{ avatar: { name: p.name, kit: competitionPlayerLook(p) } }}
                    trailing={<IconSymbol name="plus" size={ICON.regular} color={colors.ink} />}
                    onPress={() => add(p.profileId)}
                    accessibilityLabel={`Add ${p.name}`}
                  />
                ))}
              </View>
            )}
          </>
        )}
        {error ? (
          <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="admin-squad-error">
            {error}
          </Text>
        ) : null}
        {team && team.changes.length > 0 ? (
          <View testID="admin-squad-log">
            <SectionHeader title="Changes" />
            {team.changes.map((c, i) => (
              <ListRow
                key={`${c.changedAt}-${c.player.profileId}-${i}`}
                testID={`admin-squad-change-${i}`}
                title={squadChangeTitle(c)}
                subtitle={squadChangeMeta(c)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  body: { maxHeight: Dimensions.get('window').height * 0.6 },
  bodyContent: { gap: space.sm },
}));
