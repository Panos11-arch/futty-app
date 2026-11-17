import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { AddPlayerRow } from '@/components/add-player-row';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';
import { TEAM_PREMIUM_ENABLED } from '@/lib/premium';
import { getTeamRoster, hasTeamPremium, PREMIUM_FORMAT_PRICES, type RosterMember, type Team } from '@/lib/teams';
import { playHref } from '@/lib/play-segments';
import { useMyTeams } from '@/lib/use-my-teams';
import { useProfile } from '@/lib/use-profile';

type PremiumFormat = '9-a-side' | '11-a-side';

function roleLabel(role: string) {
  if (role === 'captain') return 'Captain';
  if (role === 'substitute') return 'Substitute';
  return 'Player';
}

function StatTile({ label, value }: { label: string; value: string | number }) {
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

function TeamDetail({ team, isCaptain, onTeamChanged }: { team: Team; isCaptain: boolean; onTeamChanged: () => void }) {
  const myProfile = useProfile();
  const [roster, setRoster] = useState<RosterMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);

  const loadRoster = useCallback(() => {
    getTeamRoster(team.id).then(({ data, error: rosterError }) => {
      if (rosterError) setError(rosterError.message);
      else setRoster(data);
    });
  }, [team.id]);

  useEffect(() => {
    setRoster(null);
    setShowRoster(false);
    loadRoster();
  }, [team.id, loadRoster]);

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
    onTeamChanged();
  }

  return (
    <View style={styles.sections}>
      <Card style={styles.teamCard}>
        <View style={styles.teamHeader}>
          <Avatar name={team.name} size={space.xxl + space.lg} />
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
              const name = member.username ?? 'unknown';
              return (
                <View key={member.profile_id}>
                  {i > 0 ? <View style={styles.divider} /> : null}
                  <ListRow
                    title={name}
                    leading={{ avatar: { name } }}
                    trailing={
                      <Text variant="caption" tone="inkMuted">
                        {roleLabel(member.role)}
                      </Text>
                    }
                  />
                </View>
              );
            })}
          </Card>
        ) : null}
      </View>
    </View>
  );
}

/** Your teams, shown in Play's Teams segment (app/(tabs)/play.tsx). Scrolls
 *  itself. `teamId` opens one team (app/account/activity/teams.tsx links to
 *  it) instead of whichever comes first. */
export function TeamContent({ teamId }: { teamId?: string }) {
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

const styles = StyleSheet.create({
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
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
});
