import { ErrorCode, useIAP } from 'expo-iap';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddPlayerRow } from '@/components/add-player-row';
import { AuthButton, AuthError } from '@/components/auth-form';
import { Chip } from '@/components/chip';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { describeFunctionError } from '@/lib/edge-functions';
import {
  getTeamRoster,
  hasTeamPremium,
  PREMIUM_FORMAT_PRICES,
  TEAM_PREMIUM_SKUS,
  verifyTeamPurchaseOnServer,
  type RosterMember,
  type Team,
} from '@/lib/teams';
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
 *  after a real Apple purchase (supabase/team-premium-payments.sql) — this
 *  just triggers that flow. Purely presentational; the actual useIAP
 *  connection lives one level up in TeamPremiumSection so it's only mounted
 *  once per team, not once per format row. */
function TeamPremiumRow({
  team,
  format,
  connected,
  busyFormat,
  onBuy,
}: {
  team: Team;
  format: PremiumFormat;
  connected: boolean;
  busyFormat: PremiumFormat | null;
  onBuy: (format: PremiumFormat) => void;
}) {
  const enabled = hasTeamPremium(team, format);
  const busy = busyFormat === format;

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
          onPress={() => onBuy(format)}
          disabled={!connected || (busyFormat !== null && !busy)}
          busy={busy}
        />
      ) : (
        <IconLabel icon="wrench.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
          iOS only for now
        </IconLabel>
      )}
    </View>
  );
}

/** Owns the one useIAP connection for this team's Premium purchases —
 *  captain-only, so this whole section (and the StoreKit connection it
 *  opens) only mounts for captains. */
function TeamPremiumSection({ team, onTeamChanged }: { team: Team; onTeamChanged: () => void }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const [buyingFormat, setBuyingFormat] = useState<PremiumFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { connected, requestPurchase, finishTransaction } = useIAP({
    onPurchaseSuccess: async (purchase) => {
      const format = (Object.keys(TEAM_PREMIUM_SKUS) as PremiumFormat[]).find(
        (f) => TEAM_PREMIUM_SKUS[f] === purchase.productId
      );
      if (!format || !purchase.transactionId) return;

      setError(null);
      const { data, error: verifyError } = await verifyTeamPurchaseOnServer(
        purchase.transactionId,
        purchase.productId,
        team.id
      );

      if (verifyError || !data?.active) {
        // Left unfinished on purpose — see app/premium.tsx's identical note.
        setBuyingFormat(null);
        setError(verifyError ? await describeFunctionError(verifyError) : 'Apple could not verify this purchase.');
        return;
      }

      await finishTransaction({ purchase, isConsumable: false });
      setBuyingFormat(null);
      onTeamChanged();
    },
    onPurchaseError: (purchaseError) => {
      setBuyingFormat(null);
      if (purchaseError.code === ErrorCode.UserCancelled) return;
      setError(purchaseError.message);
    },
  });

  async function buy(format: PremiumFormat) {
    setBuyingFormat(format);
    setError(null);
    try {
      await requestPurchase({ request: { apple: { sku: TEAM_PREMIUM_SKUS[format] } }, type: 'in-app' });
    } catch (requestError) {
      setBuyingFormat(null);
      setError(requestError instanceof Error ? requestError.message : 'Could not start purchase.');
    }
  }

  return (
    <ThemedView style={[styles.teamCard, { borderColor: border }]}>
      <IconLabel icon="star.fill" type="defaultSemiBold" iconColor={FuttyColors.amber400}>
        Team Premium
      </IconLabel>
      <ThemedText style={styles.note}>Needed for 9-a-side and 11-a-side leagues.</ThemedText>
      <TeamPremiumRow team={team} format="9-a-side" connected={connected} busyFormat={buyingFormat} onBuy={buy} />
      <TeamPremiumRow team={team} format="11-a-side" connected={connected} busyFormat={buyingFormat} onBuy={buy} />
      {error ? <AuthError>{error}</AuthError> : null}
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

      {isCaptain ? <TeamPremiumSection team={team} onTeamChanged={onTeamChanged} /> : null}

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
