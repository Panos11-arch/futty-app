// S10A: a captain registers one of his teams (S20A) for a tournament, or
// changes its squad until the deadline: the team, its kit colour (the badge
// is the colour with its initials), and the squad from the team's players
// (starters plus up to the tournament's subs). The server checks every rule
// again (captain, deadline, squad size, members, one squad per player).
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, View } from 'react-native';

import { kitLabel } from '@/components/community/new-team-sheet';
import { TeamBadge } from '@/components/match/team-badge';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space, type KitColourName } from '@/constants/futty-theme';
import { avatarLook } from '@/lib/avatar';
import { haptic } from '@/lib/haptics';
import { registerTeam, setSquad, type Tournament } from '@/lib/match/tournament-api';
import { describeTournamentError } from '@/lib/match/tournament-errors';
import { getTeamRoster, KIT_COLOURS, teamKit, type RosterMember } from '@/lib/teams';
import { makeStyles, useTheme } from '@/lib/theme';
import type { MyTeam } from '@/lib/use-my-teams';

export type RegistrationMode = 'register' | 'edit';

/** My captained teams that can still register (not deleted, not already in). */
export function teamsToRegister(myTeams: MyTeam[], tournament: Pick<Tournament, 'myTeams'>): MyTeam[] {
  const registered = new Set((tournament.myTeams ?? []).map((t) => t.teamId));
  return myTeams.filter((m) => m.role === 'captain' && !m.team.deleted_at && !registered.has(m.team.id));
}

type RosterState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; players: RosterMember[] };

export function RegistrationSheet({
  visible,
  mode,
  tournament,
  myTeams,
  onClose,
  onDone,
  onMakeTeam,
}: {
  visible: boolean;
  mode: RegistrationMode;
  tournament: Tournament;
  myTeams: MyTeam[];
  onClose: () => void;
  /** Registered or saved: reload the page. */
  onDone: () => void;
  /** No team to register: S20A's new-team sheet. */
  onMakeTeam: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const editing = mode === 'edit' ? (tournament.myTeams ?? []).find((t) => t.isCaptain && t.canEditSquad) ?? null : null;
  const choices = useMemo(() => teamsToRegister(myTeams, tournament), [myTeams, tournament]);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [kit, setKit] = useState<KitColourName>(KIT_COLOURS[0]);
  const [squad, setSquadIds] = useState<string[]>([]);
  const [roster, setRoster] = useState<RosterState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const min = tournament.squadMin ?? 0;
  const max = tournament.squadMax ?? 0;

  const selectedTeam = editing ? null : choices.find((c) => c.team.id === teamId) ?? null;
  const activeTeamId = editing ? editing.teamId : selectedTeam?.team.id ?? null;
  const activeName = editing ? editing.teamName : selectedTeam?.team.name ?? '';

  // Opening: the first team (or the team being edited), its kit, its squad.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (editing) {
      setSquadIds(editing.squad.map((p) => p.profileId));
      return;
    }
    const first = choices[0] ?? null;
    setTeamId(first?.team.id ?? null);
    setKit(teamKit(first?.team ?? {}) ?? KIT_COLOURS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || !activeTeamId) return;
    let live = true;
    setRoster({ status: 'loading' });
    void getTeamRoster(activeTeamId).then(({ data, error: rosterError }) => {
      if (!live) return;
      if (rosterError) {
        setRoster({ status: 'error' });
        return;
      }
      const players = (data ?? []) as RosterMember[];
      setRoster({ status: 'ready', players });
      if (!editing) setSquadIds(players.length <= max ? players.map((p) => p.profile_id) : []);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, activeTeamId]);

  function pickTeam(id: string) {
    setTeamId(id);
    const team = choices.find((c) => c.team.id === id)?.team;
    setKit(teamKit(team ?? {}) ?? KIT_COLOURS[0]);
  }

  function toggle(profileId: string) {
    haptic.tap();
    setSquadIds((s) => (s.includes(profileId) ? s.filter((id) => id !== profileId) : [...s, profileId]));
  }

  async function save() {
    if (!activeTeamId || busy) return;
    setBusy(true);
    setError(null);
    const { error: saveError } = editing
      ? await setSquad(tournament.id, activeTeamId, squad)
      : await registerTeam(tournament.id, activeTeamId, kit, squad);
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

  const sizeOk = squad.length >= min && squad.length <= max;

  if (!editing && choices.length === 0) {
    return (
      <Sheet visible={visible} onClose={onClose} title="Register team">
        <View style={styles.empty} testID="tournament-register-empty">
          <Text variant="body" tone="inkMuted">
            No team to register
          </Text>
          <Button label="Make a team" onPress={onMakeTeam} testID="tournament-register-make-team" fullWidth />
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={editing ? 'Edit squad' : 'Register team'}
      primaryAction={{
        label: editing ? 'Save squad' : 'Register',
        onPress: () => void save(),
        loading: busy,
        disabled: !sizeOk || !activeTeamId,
        testID: 'tournament-register-submit',
      }}>
      <View style={styles.preview}>
        <TeamBadge name={activeName || 'Team'} kitColour={editing ? editing.kitColour : kit} size={space.xxl + space.lg} />
        <Text variant="headline">{activeName}</Text>
      </View>
      {!editing && choices.length > 1 ? (
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Team">
          {choices.map((c) => (
            <Chip
              key={c.team.id}
              label={c.team.name}
              selected={c.team.id === teamId}
              onPress={() => pickTeam(c.team.id)}
              testID={`tournament-register-team-${c.team.id}`}
            />
          ))}
        </View>
      ) : null}
      {!editing ? (
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Kit">
          {KIT_COLOURS.map((k) => (
            <Chip
              key={k}
              label={kitLabel(k)}
              selected={kit === k}
              onPress={() => setKit(k)}
              testID={`tournament-register-kit-${kitLabel(k).toLowerCase()}`}
            />
          ))}
        </View>
      ) : null}
      <SectionHeader title={`Squad ${squad.length} of ${min}–${max}`} />
      {roster.status === 'loading' ? (
        <View testID="tournament-register-roster-skeleton">
          <SkeletonText lines={3} />
        </View>
      ) : roster.status === 'error' ? (
        <Text variant="callout" tone="danger">
          Couldn’t load the players. Try again.
        </Text>
      ) : (
        <ScrollView style={styles.list} nestedScrollEnabled testID="tournament-register-roster">
          {roster.players.map((p) => {
            const name = p.full_name ?? p.username ?? 'Player';
            const checked = squad.includes(p.profile_id);
            return (
              <ListRow
                key={p.profile_id}
                testID={`tournament-register-player-${p.profile_id}`}
                title={name}
                leading={{ avatar: { name, kit: avatarLook(p) } }}
                trailing={checked ? <IconSymbol name="checkmark.circle.fill" size={space.xl} color={colors.ink} /> : null}
                onPress={() => toggle(p.profile_id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={name}
              />
            );
          })}
        </ScrollView>
      )}
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" testID="tournament-register-error">
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const useStyles = makeStyles(() => ({
  preview: { alignItems: 'center', gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  empty: { alignItems: 'center', gap: space.lg, paddingVertical: space.lg },
  list: { maxHeight: Dimensions.get('window').height / 3 },
}));
