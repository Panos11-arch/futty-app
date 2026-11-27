// The league join flow, moved unchanged from the old Play → Leagues screen
// (app/(tabs)/leagues.tsx before S9). S10's competition page shows it on its
// season card while sign-up is open; its standings now come from the server
// (get_competition_standings, components/competition/standings-tab.tsx).
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { AddPlayerRow } from '@/components/add-player-row';
import { Chip } from '@/components/chip';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { hairline, space } from '@/constants/futty-theme';
import { describeLeagueError } from '@/lib/league-errors';
import { registerTeamForLeague, startLeagueSeason, type League } from '@/lib/leagues';
import { ISLAND_WIDE, normaliseScope } from '@/lib/match/league-directory';
import { leagueFormatOpen } from '@/lib/premium';
import { supabase } from '@/lib/supabase';
import {
  createTeam,
  getTeamRoster,
  hasTeamPremium,
  isPremiumFormat,
  PREMIUM_FORMAT_PRICES,
  ROSTER_SIZE_PRESETS,
  type RosterMember,
  type Team,
} from '@/lib/teams';
import { makeStyles, useTheme } from '@/lib/theme';
import { useLeagueStandings } from '@/lib/use-league-standings';
import { useMyTeams } from '@/lib/use-my-teams';
import { useProfile } from '@/lib/use-profile';

const CITIES = ['Nicosia', 'Limassol', 'Larnaca', 'Paphos'];

function ErrorText({ children }: { children: string }) {
  return (
    <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

function Note({ children }: { children: string }) {
  return (
    <Text variant="callout" tone="inkMuted">
      {children}
    </Text>
  );
}

/**
 * Registers a team for a league — the one place team creation happens now,
 * rather than as a standalone "Team" feature. Lets the captain pick any of
 * their existing teams not already in this league, or create a new one and
 * populate its roster right here before finishing.
 */
function JoinLeagueControl({
  leagueId,
  format,
  joinLabel,
  registeredTeamIds,
  defaultCity,
  onJoined,
}: {
  leagueId: string;
  format: string;
  joinLabel: string;
  registeredTeamIds: Set<string>;
  defaultCity?: string;
  onJoined: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const myTeams = useMyTeams();
  const myProfile = useProfile();

  // '7-a-side' -> 7. Not a real database constraint (roster_size is just a
  // number a team is created with), but it's the same mapping the roster
  // size presets below use — matching a team to a format by its size keeps
  // an existing 11-a-side team from cluttering the 5-a-side join list as if
  // it were a real option, which was crowding out "Register a new team".
  const expectedRosterSize = Number(format.split('-')[0]) || null;

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [city, setCity] = useState(defaultCity ?? CITIES[0]);
  const [rosterSize, setRosterSize] = useState(expectedRosterSize ?? ROSTER_SIZE_PRESETS[3]);
  const [subSlots, setSubSlots] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A team you're actively filling the roster for — either just created, or
  // an existing-but-incomplete team resumed via "Finish register" below.
  const [justCreated, setJustCreated] = useState<Team | null>(null);
  const [justCreatedRoster, setJustCreatedRoster] = useState<RosterMember[] | null>(null);

  const loadJustCreatedRoster = useCallback((teamId: string) => {
    getTeamRoster(teamId).then(({ data }) => setJustCreatedRoster(data ?? []));
  }, []);

  useEffect(() => {
    if (!justCreated) {
      setJustCreatedRoster(null);
      return;
    }
    loadJustCreatedRoster(justCreated.id);
  }, [justCreated?.id, loadJustCreatedRoster]);

  if (myTeams.status === 'loading') return <SkeletonText lines={2} />;
  if (myTeams.status === 'error') {
    return (
      <Banner
        tone="danger"
        message={`Could not load your teams: ${myTeams.message}`}
        action={{ label: 'Try again', onPress: myTeams.reload }}
      />
    );
  }

  const inviterUsername = myProfile.status === 'ready' ? myProfile.profile.username : null;
  const eligibleTeams = myTeams.teams.filter(
    ({ team }) =>
      !registeredTeamIds.has(team.id) &&
      (expectedRosterSize === null || team.roster_size === expectedRosterSize)
  );
  const premiumGated = isPremiumFormat(format);
  const price = premiumGated ? PREMIUM_FORMAT_PRICES[format] : 0;

  // One team per captain per league — enforced again server-side
  // (already_have_team_in_league), this just avoids offering an action
  // that would only bounce back as an error.
  const alreadyHaveTeamHere = myTeams.teams.some(
    ({ team, role }) => role === 'captain' && registeredTeamIds.has(team.id)
  );

  if (alreadyHaveTeamHere && !justCreated) {
    return <Note>You’re already in this league.</Note>;
  }

  // 9-a-side and 11-a-side need Team Premium, which is off for the release
  // (lib/premium.ts): registration opens with it.
  if (!leagueFormatOpen(format)) {
    return <Note>{`${format} leagues are coming soon.`}</Note>;
  }

  if (justCreated) {
    // roster_size counts the captain as the first main-squad slot
    // (teams.sql), and the fetched roster already includes that row, so no
    // manual "-1" is needed here the way a session-only added-count would.
    const mainCount = justCreatedRoster ? justCreatedRoster.filter((m) => m.role !== 'substitute').length : 0;
    const subCount = justCreatedRoster ? justCreatedRoster.filter((m) => m.role === 'substitute').length : 0;
    const mainRemaining = justCreated.roster_size - mainCount;
    const subRemaining = justCreated.substitute_slots - subCount;
    const rosterReady = justCreatedRoster !== null && mainRemaining <= 0;
    const needsPremium = premiumGated && !hasTeamPremium(justCreated, format);
    const canRegister = rosterReady && !needsPremium;

    const justCreatedId = justCreated.id;
    function onMemberAdded() {
      loadJustCreatedRoster(justCreatedId);
    }

    async function finishRegistration() {
      if (!justCreated || !canRegister || busy) return;
      setBusy(true);
      setError(null);

      const { error: joinError } = await registerTeamForLeague(leagueId, justCreated.id);
      setBusy(false);

      if (joinError) {
        setError(describeLeagueError(joinError));
        return;
      }

      setJustCreated(null);
      setCreating(false);
      onJoined();
    }

    return (
      <Card style={styles.section}>
        <Note>
          {!justCreatedRoster
            ? 'Loading roster…'
            : !rosterReady
              ? `${mainRemaining} more player${mainRemaining === 1 ? '' : 's'} needed.`
              : needsPremium
                ? `Squad ready — but ${format} needs Team Premium (€${PREMIUM_FORMAT_PRICES[format]}/season) first.`
                : 'Squad ready — register below.'}
        </Note>

        {needsPremium ? (
          <Button label="Buy Team Premium" variant="secondary" onPress={() => router.push('/team')} disabled={busy} />
        ) : null}

        {justCreatedRoster ? (
          <>
            <AddPlayerRow
              teamId={justCreated.id}
              teamName={justCreated.name}
              inviterUsername={inviterUsername}
              role="player"
              remaining={mainRemaining}
              onAdded={onMemberAdded}
            />
            <AddPlayerRow
              teamId={justCreated.id}
              teamName={justCreated.name}
              inviterUsername={inviterUsername}
              role="substitute"
              remaining={subRemaining}
              onAdded={onMemberAdded}
            />
          </>
        ) : (
          <SkeletonText lines={2} />
        )}

        {error ? <ErrorText>{error}</ErrorText> : null}

        <Button label={joinLabel} fullWidth onPress={finishRegistration} disabled={!canRegister} loading={busy} />
        <Button
          label="Finish squad later (won't register yet)"
          variant="secondary"
          fullWidth
          onPress={() => {
            setJustCreated(null);
            setCreating(false);
            myTeams.reload();
          }}
          disabled={busy}
        />
      </Card>
    );
  }

  async function createTeamOnly() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);

    const { data: team, error: createError } = await createTeam(name.trim(), city, rosterSize, subSlots);
    setBusy(false);

    if (createError || !team) {
      setError(describeLeagueError(createError!));
      return;
    }

    myTeams.reload();
    setJustCreated(team as unknown as Team);
  }

  if (!creating) {
    return (
      <View style={styles.section}>
        <Button label="Register a new team" onPress={() => setCreating(true)} disabled={busy} />

        {error ? <ErrorText>{error}</ErrorText> : null}

        {/* Every row here is one of the CURRENT user's own teams not yet in
         *  this league — i.e. an incomplete registration by definition, so
         *  "Finish register" is the one action every row needs (it opens the
         *  same roster/register screen either way: still filling the roster,
         *  or already full and ready to hit Register). No separate "Join" —
         *  it duplicated this with a button that just bounced back with
         *  roster_incomplete for anything not already full. */}
        {eligibleTeams.length > 0 ? (
          <Card padded={false}>
            {eligibleTeams.map(({ team }) => {
              const needsPremium = premiumGated && !hasTeamPremium(team, format);
              return (
                <ListRow
                  key={team.id}
                  title={team.name}
                  leading={needsPremium ? { icon: 'lock.fill' } : undefined}
                  trailing={
                    <Button
                      label={needsPremium ? 'Buy Team Premium' : 'Finish register'}
                      variant="secondary"
                      onPress={() => (needsPremium ? router.push('/team') : setJustCreated(team))}
                      disabled={busy}
                    />
                  }
                />
              );
            })}
          </Card>
        ) : null}
      </View>
    );
  }

  return (
    <Card style={styles.section}>
      <Note>Squad size (including you)</Note>
      <View style={styles.wrapRow}>
        {ROSTER_SIZE_PRESETS.map((size) => (
          <Chip
            key={size}
            label={String(size)}
            selected={size === rosterSize}
            onPress={() => setRosterSize(size)}
          />
        ))}
      </View>

      <Note>Substitutes (optional)</Note>
      <View style={styles.wrapRow}>
        {[0, 1, 2, 3, 4].map((count) => (
          <Chip
            key={count}
            label={count === 0 ? 'None' : String(count)}
            selected={count === subSlots}
            onPress={() => setSubSlots(count)}
          />
        ))}
      </View>

      <TextField label="Team name" value={name} onChangeText={setName} placeholder="Team name" editable={!busy} />

      <Note>City</Note>
      <View style={styles.wrapRow}>
        {CITIES.map((c) => (
          <Chip key={c} label={c} selected={c === city} onPress={() => setCity(c)} />
        ))}
      </View>

      {premiumGated ? (
        <View style={styles.iconRow}>
          <IconSymbol name="lock.fill" size={ICON.small} color={colors.inkMuted} />
          <Text variant="callout" tone="inkMuted" style={styles.flex}>
            {format} needs Team Premium (€{price}/season) to register — buy it from the Team tab once this
            squad is created
          </Text>
        </View>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <View style={styles.buttonRow}>
        <Button label="Create team" onPress={createTeamOnly} disabled={!name.trim()} loading={busy} />
        <Button label="Cancel" variant="secondary" onPress={() => setCreating(false)} disabled={busy} />
      </View>
    </Card>
  );
}

/**
 * The join flow on the competition page's season card (S10), while sign-up
 * is open: "Join" for an island-wide league, "Register" for a city league in
 * sign-up, "Join waiting pool" once it is in divisions. The teams already
 * anywhere under the league (the pool and every division) aren't offered.
 */
export function CompetitionJoin({
  hub,
  leagues,
  onChanged,
}: {
  hub: League;
  leagues: League[];
  onChanged: () => void;
}) {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treeTeamIds, setTreeTeamIds] = useState<Set<string>>(new Set());
  const [loadKey, setLoadKey] = useState(0);
  const standard = normaliseScope(hub.scope) === ISLAND_WIDE;
  const treeIds = [hub.id, ...leagues.filter((l) => l.parent_league_id === hub.id).map((l) => l.id)];
  const treeKey = treeIds.join(',');

  useEffect(() => {
    supabase
      .from('league_teams')
      .select('team_id')
      .in('league_id', treeKey.split(','))
      .then(({ data }) => setTreeTeamIds(new Set((data ?? []).map((row) => row.team_id))));
  }, [treeKey, loadKey]);

  const changed = useCallback(() => {
    setLoadKey((k) => k + 1);
    onChanged();
  }, [onChanged]);

  if (!standard && hub.stage === 'season') return null;

  async function startSeason() {
    setBusy(true);
    setError(null);
    const { error: actionError } = await startLeagueSeason(hub.id);
    setBusy(false);
    if (actionError) setError(describeLeagueError(actionError));
    else changed();
  }

  return (
    <View style={styles.section}>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <JoinLeagueControl
        leagueId={hub.id}
        format={hub.format}
        joinLabel={standard ? 'Join' : hub.stage === 'divisions' ? 'Join waiting pool' : 'Register'}
        registeredTeamIds={treeTeamIds}
        defaultCity={standard ? undefined : hub.scope.trim()}
        onJoined={changed}
      />
      {/* Dev-only: for real users a signup-stage league only moves to
       *  'season' once its capacity fills (see register_team_for_league) —
       *  there's no legitimate reason to skip that early, so this manual
       *  trigger must never reach production. */}
      {__DEV__ && !standard && hub.stage === 'signup' ? (
        <Button label="Start season (dev only)" variant="secondary" onPress={startSeason} loading={busy} />
      ) : null}
    </View>
  );
}

/** The waiting pool of a city league in divisions: its team names. */
export function WaitingPool({ hubId }: { hubId: string }) {
  const standings = useLeagueStandings(hubId);
  if (standings.status !== 'ready' || standings.rows.length === 0) return null;
  return (
    <Card testID="standings-waiting-pool">
      <Text variant="headline">Waiting pool</Text>
      {standings.rows.map((r) => (
        <Text key={r.team_id} variant="body">
          {r.team_name}
        </Text>
      ))}
    </Card>
  );
}

const useStyles = makeStyles(({ colors, type }) => ({
  flex: { flex: 1 },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  section: { gap: space.sm },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.xs,
  },
  tableRowDivider: { borderTopWidth: hairline, borderTopColor: colors.border },
  tableRowMine: { backgroundColor: colors.brandSoft },
  tableTeam: { flex: 1 },
  tableStat: { minWidth: space.xxl, textAlign: 'right' },
  tablePts: { fontFamily: type.title.fontFamily },
}));
