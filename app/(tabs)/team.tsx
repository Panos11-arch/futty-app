import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddPlayerRow } from '@/components/add-player-row';
import { AuthButton } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getTeamRoster, hasTeamPremium, PREMIUM_FORMAT_PRICES, type RosterMember, type Team } from '@/lib/teams';
import { useMyTeams } from '@/lib/use-my-teams';
import { useProfile } from '@/lib/use-profile';

type PremiumFormat = '9-a-side' | '11-a-side';

function roleLabel(role: string) {
  if (role === 'captain') return 'Captain';
  if (role === 'substitute') return 'Substitute';
  return 'Player';
}

/** Initials placeholder in place of a real team logo — no image upload
 *  infrastructure (storage bucket, picker) exists in this app yet. */
function TeamAvatar({ name }: { name: string }) {
  const tint = useThemeColor({}, 'tint');
  const onTint = useThemeColor({}, 'background');
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

  return (
    <View style={[styles.avatar, { backgroundColor: tint }]}>
      <ThemedText style={[styles.avatarText, { color: onTint }]}>{initials || '?'}</ThemedText>
    </View>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  return (
    <View
      style={[
        styles.statTile,
        { borderColor: accent ? FuttyColors.amber400 : border },
        accent && styles.statTileAccent,
      ]}>
      <ThemedText type="defaultSemiBold">{value}</ThemedText>
      <ThemedText style={styles.note}>{label}</ThemedText>
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
    <View style={styles.premiumRow}>
      <ThemedText style={styles.note}>
        {format} — €{PREMIUM_FORMAT_PRICES[format]}/season
      </ThemedText>
      {enabled ? (
        <View style={styles.premiumActiveCol}>
          <IconLabel icon="checkmark.circle.fill" style={styles.note} iconColor={FuttyColors.emerald700} iconSize={12}>
            Active
          </IconLabel>
          {/* Team Premium is a one-time (non-consumable) purchase, so unlike
              a subscription there's no "cancel" for Apple to manage — the
              only way it ever comes off is a refund, which only Apple can
              approve. This just opens their own refund-request flow;
              apple-server-notifications already reacts correctly once/if
              Apple grants one (see supabase/team-premium-forfeit.sql). */}
          <Pressable
            accessibilityRole="button"
            onPress={() => Linking.openURL('https://reportaproblem.apple.com/')}>
            <ThemedText style={styles.refundLink}>Request a refund</ThemedText>
          </Pressable>
        </View>
      ) : Platform.OS === 'ios' ? (
        <AuthButton
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
        <IconLabel icon="wrench.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
          iOS only for now
        </IconLabel>
      )}
    </View>
  );
}

function TeamPremiumSection({ team }: { team: Team }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  return (
    <ThemedView style={[styles.teamCard, { borderColor: border }]}>
      <IconLabel icon="star.fill" type="defaultSemiBold" iconColor={FuttyColors.amber400}>
        Team Premium
      </IconLabel>
      <ThemedText style={styles.note}>Needed for 9-a-side and 11-a-side leagues.</ThemedText>
      <TeamPremiumRow team={team} format="9-a-side" />
      <TeamPremiumRow team={team} format="11-a-side" />
    </ThemedView>
  );
}

function TeamDetail({ team, isCaptain, onTeamChanged }: { team: Team; isCaptain: boolean; onTeamChanged: () => void }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
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
    <View style={styles.section}>
      <ThemedView style={[styles.teamCard, { borderColor: border }]}>
        <View style={styles.teamHeader}>
          <TeamAvatar name={team.name} />
          <View style={styles.teamHeaderText}>
            <ThemedText type="defaultSemiBold">{team.name}</ThemedText>
            <ThemedText style={styles.note}>{team.city ?? 'No city set'}</ThemedText>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <StatTile label="Played" value={team.played} />
          <StatTile label="Won" value={team.won} />
          <StatTile label="Drawn" value={team.drawn} />
          <StatTile label="Lost" value={team.lost} />
          <StatTile label="Goals" value={team.goals} />
          <StatTile label="XP" value={team.xp} accent />
          {winRate !== null ? <StatTile label="Win rate" value={`${winRate}%`} /> : null}
        </View>
      </ThemedView>

      {isCaptain ? <TeamPremiumSection team={team} /> : null}

      <IconLabel icon="person.2.fill" type="subtitle">
        Roster ({team.roster_size} {team.substitute_slots > 0 ? `+ ${team.substitute_slots} subs` : ''})
      </IconLabel>

      {error ? <ThemedText style={styles.note}>Could not load roster: {error}</ThemedText> : null}
      {!roster && !error ? <ActivityIndicator /> : null}

      {isCaptain && roster && (mainRemaining > 0 || subRemaining > 0) ? (
        <ThemedView style={[styles.teamCard, { borderColor: border }]}>
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
        </ThemedView>
      ) : null}

      {roster ? (
        <Pressable accessibilityRole="button" onPress={() => setShowRoster((v) => !v)}>
          <ThemedText type="link">{showRoster ? 'Hide team' : 'View team'}</ThemedText>
        </Pressable>
      ) : null}

      {showRoster && roster ? (
        <ThemedView style={[styles.rosterCard, { borderColor: border }]}>
          {roster.map((member) => (
            <View key={member.profile_id} style={styles.rosterRow}>
              <ThemedText>{member.username ?? 'unknown'}</ThemedText>
              <ThemedText style={styles.note}>{roleLabel(member.role)}</ThemedText>
            </View>
          ))}
        </ThemedView>
      ) : null}
    </View>
  );
}

export default function TeamScreen() {
  const myTeams = useMyTeams();
  // Lets app/account/activity/teams.tsx deep-link straight to one team
  // instead of always landing on whichever comes first.
  const { teamId } = useLocalSearchParams<{ teamId?: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(teamId ?? null);

  const teams = myTeams.status === 'ready' ? myTeams.teams : [];
  const selected = teams.find((t) => t.team.id === selectedId) ?? teams[0] ?? null;

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <IconLabel icon="shield.fill" type="title" iconSize={28}>Team</IconLabel>

        {myTeams.status === 'loading' ? <ActivityIndicator /> : null}

        {myTeams.status === 'error' ? (
          <ThemedText style={styles.note}>Could not load your teams: {myTeams.message}</ThemedText>
        ) : null}

        {myTeams.status === 'ready' && teams.length === 0 ? (
          <View style={styles.section}>
            <IconLabel icon="magnifyingglass" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
              You&apos;re not on a team yet.
            </IconLabel>
            <Pressable accessibilityRole="button" onPress={() => router.push('/leagues')}>
              <ThemedText type="link">Register one when you join a league</ThemedText>
            </Pressable>
          </View>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 12,
    padding: 16,
    paddingBottom: 48,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  section: {
    gap: 8,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  teamCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  teamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  teamHeaderText: {
    gap: 2,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statTile: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    minWidth: 68,
  },
  statTileAccent: {
    backgroundColor: FuttyColors.amber400 + '1a',
  },
  rosterCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  rosterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  premiumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  premiumActiveCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  refundLink: {
    fontSize: 11,
    color: FuttyColors.emerald700,
    textDecorationLine: 'underline',
  },
});
