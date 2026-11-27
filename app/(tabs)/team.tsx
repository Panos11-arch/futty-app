import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';

import { AddPlayerRow } from '@/components/add-player-row';
import { TeamBadge } from '@/components/match/team-badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { IconButton } from '@/components/ui/icon-button';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { haptic } from '@/lib/haptics';
import { profileHref } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';
import { TEAM_PREMIUM_ENABLED } from '@/lib/premium';
import {
  cancelTeamInvite,
  deleteTeam,
  describeTeamError,
  fetchPendingTeamInvites,
  getTeamRoster,
  hasTeamPremium,
  leaveTeam,
  passCaptaincy,
  PREMIUM_FORMAT_PRICES,
  removeTeamMember,
  type PendingTeamInvite,
  type RosterMember,
  type Team,
} from '@/lib/teams';
import { playHref } from '@/lib/play-segments';
import { useMyTeams } from '@/lib/use-my-teams';
import { useProfile } from '@/lib/use-profile';
import { avatarLook } from '@/lib/avatar';

type PremiumFormat = '9-a-side' | '11-a-side';

function roleLabel(role: string) {
  if (role === 'captain') return 'Captain';
  if (role === 'substitute') return 'Substitute';
  return 'Player';
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  const styles = useStyles();
  return (
    <View style={styles.statTile} accessible accessibilityLabel={`${label} ${value}`}>
      <Text variant="headline" tabular>
        {String(value)}
      </Text>
      <Text variant="caption" tone="inkMuted">
        {label}
      </Text>
    </View>
  );
}

/** premium_9aside/premium_11aside are only ever set by verify-team-purchase
 *  after a real Apple purchase (supabase/team-premium-payments.sql). "Buy"
 *  navigates to the same /premium-plan popup every other Premium entry
 *  point uses (account/premium.tsx, the League tab's "Buy Team Premium"
 *  prompts) — this row used to open its own separate useIAP purchase
 *  directly, which was a second, divergent path to the exact same purchase
 *  and the actual bug report: it meant this was the one place in the app
 *  that didn't show the plan/price/bullets confirmation screen before
 *  charging anything. There is now exactly one place that ever calls
 *  requestPurchase() for Team Premium — app/premium-plan.tsx. */
function TeamPremiumRow({ team, format }: { team: Team; format: PremiumFormat }) {
  const styles = useStyles();
  const enabled = hasTeamPremium(team, format);

  return (
    <ListRow
      title={`${format} — €${PREMIUM_FORMAT_PRICES[format]}/season`}
      trailing={
        enabled ? (
          <View style={styles.premiumActive}>
            <Text variant="callout" tone="success">
              Active
            </Text>
            {/* Team Premium is a one-time (non-consumable) purchase, so unlike
                a subscription there's no "cancel" for Apple to manage — the
                only way it ever comes off is a refund, which only Apple can
                approve. This just opens their own refund-request flow;
                apple-server-notifications already reacts correctly once/if
                Apple grants one (see supabase/team-premium-forfeit.sql). */}
            <Button
              label="Request a refund"
              variant="plain"
              onPress={() => Linking.openURL('https://reportaproblem.apple.com/')}
            />
          </View>
        ) : Platform.OS === 'ios' ? (
          <Button
            label="Buy"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: '/premium-plan',
                params: { plan: `team-${format}`, teamId: team.id },
              })
            }
          />
        ) : (
          <Text variant="callout" tone="inkMuted">
            iOS only for now
          </Text>
        )
      }
    />
  );
}

function TeamPremiumSection({ team }: { team: Team }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <SectionHeader title="Team Premium" />
      <Text variant="callout" tone="inkMuted">
        Needed for 9-a-side and 11-a-side leagues.
      </Text>
      <Card padded={false}>
        <TeamPremiumRow team={team} format="9-a-side" />
        <View style={styles.divider} />
        <TeamPremiumRow team={team} format="11-a-side" />
      </Card>
    </View>
  );
}

const memberName = (member: RosterMember) => member.full_name || member.username || 'Player';

/** S20A: the confirm sheet's button for leaving or deleting the team. */
const CONFIRM = {
  leave: { label: 'Leave team', testID: 'team-leave-confirm' },
  delete: { label: 'Delete team', testID: 'team-delete-confirm' },
} as const;

type PendingState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; invites: PendingTeamInvite[] };

/** S20A: the captain's open invites, each with Cancel. Hidden when there are none. */
function PendingInvites({ state, onRetry, onCancel }: {
  state: PendingState;
  onRetry: () => void;
  onCancel: (invite: PendingTeamInvite) => void;
}) {
  const styles = useStyles();
  if (state.status === 'loading' || (state.status === 'ready' && state.invites.length === 0)) return null;
  return (
    <View style={styles.section}>
      <SectionHeader title="Pending" />
      {state.status === 'error' ? (
        <View style={styles.inline}>
          <Text variant="callout" tone="danger">
            {state.message}
          </Text>
          <Button label="Try again" variant="plain" onPress={onRetry} testID="team-pending-retry" />
        </View>
      ) : (
        <Card padded={false}>
          {state.invites.map((invite, i) => (
            <View key={invite.invite_id}>
              {i > 0 ? <View style={styles.divider} /> : null}
              <ListRow
                title={invite.name}
                leading={{ avatar: { name: invite.name } }}
                onPress={() => router.push(profileHref(invite.profile_id))}
                trailing={
                  <IconButton
                    icon="xmark"
                    tone="inkMuted"
                    onPress={() => onCancel(invite)}
                    accessibilityLabel={`Cancel invite to ${invite.name}`}
                    testID={`team-invite-cancel-${invite.invite_id}`}
                  />
                }
              />
            </View>
          ))}
        </Card>
      )}
    </View>
  );
}

function TeamDetail({ team, isCaptain, onTeamChanged }: { team: Team; isCaptain: boolean; onTeamChanged: () => void }) {
  const styles = useStyles();
  const myProfile = useProfile();
  const { user } = useAuth();
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [pending, setPending] = useState<PendingState>({ status: 'loading' });
  const [acting, setActing] = useState<RosterMember | null>(null);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRoster = useCallback(() => {
    setError(null);
    getTeamRoster(team.id).then(({ data, error: rosterError }) => {
      if (rosterError) setError(rosterError.message);
      else setRoster(data);
    });
  }, [team.id]);

  const loadPending = useCallback(() => {
    if (!isCaptain) return;
    setPending({ status: 'loading' });
    fetchPendingTeamInvites(team.id).then(
      (invites) => setPending({ status: 'ready', invites }),
      (e: Error) => setPending({ status: 'error', message: e.message }),
    );
  }, [team.id, isCaptain]);

  useEffect(() => {
    setRoster(null);
    setShowRoster(false);
    loadRoster();
  }, [team.id, loadRoster]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  /** Runs a team action; on success refreshes, otherwise shows one line. */
  async function run(action: () => Promise<{ error: { message: string } | null }>, after: () => void) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const { error: actionErr } = await action();
    setBusy(false);
    if (actionErr) {
      haptic.error();
      setActionError(describeTeamError(actionErr));
      return;
    }
    haptic.success();
    after();
  }

  function closeSheets() {
    setActing(null);
    setConfirm(null);
    setActionError(null);
  }

  const memberDone = () => {
    closeSheets();
    loadRoster();
    onTeamChanged();
  };

  async function cancelInvite(invite: PendingTeamInvite) {
    const { error: cancelError } = await cancelTeamInvite(invite.invite_id);
    if (cancelError) {
      haptic.error();
      setPending({ status: 'error', message: describeTeamError(cancelError) });
      return;
    }
    haptic.success();
    setPending((p) => (p.status === 'ready' ? { ...p, invites: p.invites.filter((i) => i.invite_id !== invite.invite_id) } : p));
  }

  const isLastMember = isCaptain && roster?.length === 1;

  const winRate = team.played > 0 ? Math.round((team.won / team.played) * 100) : null;
  const inviterUsername = myProfile.status === 'ready' ? myProfile.profile.username : null;

  // roster_size counts the captain as the first main-squad slot (teams.sql),
  // so "5 names" means the captain plus 4 more here, not 5 more.
  const mainCount = roster ? roster.filter((m) => m.role !== 'substitute').length : 0;
  const subCount = roster ? roster.filter((m) => m.role === 'substitute').length : 0;
  const mainRemaining = team.roster_size - mainCount;
  const subRemaining = team.substitute_slots - subCount;

  function memberAdded() {
    loadRoster();
    loadPending();
    onTeamChanged();
  }

  return (
    <View style={styles.sections}>
      <Card style={styles.teamCard}>
        <View style={styles.teamHeader}>
          <TeamBadge name={team.name} kitColour={team.kit_colour} size={space.xxl + space.lg} />
          <View style={styles.flex}>
            <Text variant="headline">{team.name}</Text>
            <Text variant="callout" tone="inkMuted">
              {team.city ?? 'No city set'}
            </Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <StatTile label="Played" value={team.played} />
          <StatTile label="Won" value={team.won} />
          <StatTile label="Drawn" value={team.drawn} />
          <StatTile label="Lost" value={team.lost} />
          <StatTile label="Goals" value={team.goals} />
          <StatTile label="XP" value={team.xp} />
          {winRate !== null ? <StatTile label="Win rate" value={`${winRate}%`} /> : null}
        </View>
      </Card>

      {isCaptain && TEAM_PREMIUM_ENABLED ? <TeamPremiumSection team={team} /> : null}

      <View style={styles.section}>
        <SectionHeader
          title={`Roster (${team.roster_size} ${team.substitute_slots > 0 ? `+ ${team.substitute_slots} subs` : ''})`}
        />

        {error ? (
          <Banner
            tone="danger"
            message={`Could not load roster: ${error}`}
            action={{ label: 'Try again', onPress: loadRoster }}
          />
        ) : null}
        {!roster && !error ? (
          <View testID="roster-skeleton">
            <SkeletonText lines={2} />
          </View>
        ) : null}

        {isCaptain && roster && (mainRemaining > 0 || subRemaining > 0) ? (
          <Card style={styles.section}>
            <AddPlayerRow
              teamId={team.id}
              teamName={team.name}
              inviterUsername={inviterUsername}
              role="player"
              remaining={mainRemaining}
              onAdded={memberAdded}
            />
            <AddPlayerRow
              teamId={team.id}
              teamName={team.name}
              inviterUsername={inviterUsername}
              role="substitute"
              remaining={subRemaining}
              onAdded={memberAdded}
            />
          </Card>
        ) : null}

        {roster ? (
          <Button
            label={showRoster ? 'Hide team' : 'View team'}
            variant="plain"
            onPress={() => setShowRoster((v) => !v)}
          />
        ) : null}

        {showRoster && roster ? (
          <Card padded={false}>
            {roster.map((member, i) => {
              const name = memberName(member);
              const canAct = isCaptain && member.profile_id !== user?.id;
              return (
                <View key={member.profile_id}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <ListRow
                    title={name}
                    leading={{ avatar: { name, kit: avatarLook(member) } }}
                    onPress={() => router.push(profileHref(member.profile_id))}
                    accessibilityLabel={name}
                    trailing={
                      <View style={styles.inline}>
                        <Text variant="caption" tone="inkMuted">
                          {roleLabel(member.role)}
                        </Text>
                        {canAct ? (
                          <IconButton
                            icon="ellipsis"
                            accessibilityLabel={`Options for ${name}`}
                            onPress={() => setActing(member)}
                            testID={`team-member-actions-${member.profile_id}`}
                          />
                        ) : null}
                      </View>
                    }
                  />
                </View>
              );
            })}
          </Card>
        ) : null}
      </View>

      {isCaptain ? <PendingInvites state={pending} onRetry={loadPending} onCancel={cancelInvite} /> : null}

      {roster ? (
        isLastMember ? (
          <Button label="Delete team" variant="destructive" onPress={() => setConfirm('delete')} testID="team-delete" />
        ) : (
          <Button label="Leave team" variant="secondary" onPress={() => setConfirm('leave')} testID="team-leave" />
        )
      ) : null}

      <Sheet visible={acting !== null} onClose={closeSheets} title={acting ? memberName(acting) : ''}>
        <View style={styles.sheetActions}>
          <Button
            label="Make captain"
            variant="secondary"
            loading={busy}
            disabled={busy}
            onPress={() => acting && run(() => passCaptaincy(team.id, acting.profile_id), memberDone)}
            testID="team-member-make-captain"
          />
          <Button
            label="Remove"
            variant="destructive"
            loading={busy}
            disabled={busy}
            onPress={() => acting && run(() => removeTeamMember(team.id, acting.profile_id), memberDone)}
            testID="team-member-remove"
          />
          {actionError ? (
            <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
              {actionError}
            </Text>
          ) : null}
        </View>
      </Sheet>

      <Sheet
        visible={confirm !== null}
        onClose={closeSheets}
        title={CONFIRM[confirm ?? 'leave'].label}
        primaryAction={{
          ...CONFIRM[confirm ?? 'leave'],
          loading: busy,
          onPress: () =>
            run(
              () => (confirm === 'delete' ? deleteTeam(team.id) : leaveTeam(team.id)),
              () => {
                closeSheets();
                onTeamChanged();
              },
            ),
        }}
        secondaryAction={{ label: 'Cancel' }}>
        <Text variant="callout" tone={actionError ? 'danger' : 'inkMuted'} accessibilityLiveRegion="polite">
          {actionError ?? team.name}
        </Text>
      </Sheet>
    </View>
  );
}

/** Your teams, shown in Play's Teams segment (app/(tabs)/play.tsx). Scrolls
 *  itself. `teamId` opens one team (app/account/activity/teams.tsx links to
 *  it) instead of whichever comes first. */
export function TeamContent({ teamId }: { teamId?: string }) {
  const styles = useStyles();
  const myTeams = useMyTeams();
  const [selectedId, setSelectedId] = useState<string | null>(teamId ?? null);

  // Play stays mounted, so a later link to another team arrives as a new prop.
  useEffect(() => {
    if (teamId) setSelectedId(teamId);
  }, [teamId]);

  const teams = myTeams.status === 'ready' ? myTeams.teams : [];
  const selected = teams.find((t) => t.team.id === selectedId) ?? teams[0] ?? null;

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {myTeams.status === 'loading' ? (
        <Card testID="teams-skeleton" style={styles.teamCard}>
          <View style={styles.teamHeader}>
            <SkeletonBlock width={space.xxl + space.lg} height={space.xxl + space.lg} rounded="pill" />
            <View style={styles.flex}>
              <SkeletonText lines={2} />
            </View>
          </View>
          <SkeletonBlock width="100%" height={space.xxl * 2} />
        </Card>
      ) : null}

      {myTeams.status === 'error' ? (
        <Banner
          tone="danger"
          message={`Could not load your teams: ${myTeams.message}`}
          action={{ label: 'Try again', onPress: myTeams.reload }}
        />
      ) : null}

      {myTeams.status === 'ready' && teams.length === 0 ? (
        <EmptyState
          icon="person.2.fill"
          message="You’re not on a team yet."
          action={{ label: 'Register one when you join a league', onPress: () => router.push('/leagues') }}
        />
      ) : null}

      {teams.length > 1 ? (
        <View style={styles.wrapRow}>
          {teams.map(({ team }) => (
            <Chip
              key={team.id}
              label={team.name}
              selected={selected?.team.id === team.id}
              onPress={() => setSelectedId(team.id)}
            />
          ))}
        </View>
      ) : null}

      {selected ? (
        <TeamDetail
          team={selected.team}
          isCaptain={selected.role === 'captain'}
          onTeamChanged={myTeams.reload}
        />
      ) : null}
    </ScrollView>
  );
}

/** /team is no longer a tab: it opens Play on Teams, keeping the team id. */
export default function TeamRoute() {
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  return <Redirect href={playHref('teams', { teamId })} />;
}

const useStyles = makeStyles(({ colors }) => ({
  flex: { flex: 1 },
  content: { gap: space.md, padding: space.lg, paddingBottom: space.xxl },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sections: { gap: space.xl },
  section: { gap: space.sm },
  teamCard: { gap: space.lg },
  teamHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  statTile: {
    minWidth: space.xxl * 2,
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    backgroundColor: colors.canvas,
  },
  premiumActive: { alignItems: 'flex-end' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  sheetActions: { gap: space.sm },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
