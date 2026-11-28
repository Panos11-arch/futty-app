import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { NightHeader } from '@/components/match/night-header';
import { Button } from '@/components/ui/button';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { competitionBadge, competitionName, ISLAND_WIDE, normaliseScope, scopeLabel } from '@/lib/match/league-directory';
import { tournamentBadge } from '@/lib/match/tournament-api';
import { makeStyles, useTheme } from '@/lib/theme';

type Params = { kind?: string; name?: string; scope?: string; format?: string; teams?: string };

/** Back to the Leagues screen, or open it when this was the first screen. */
function backToLeagues() {
  if (router.canGoBack()) router.back();
  else router.replace('/leagues');
}

/**
 * S9: a league with no season in sign-up or running (image 16), or a
 * tournament before its sign-up opens (image 17, used by S10A): name, area
 * and format, one line, and Back to leagues.
 */
export default function ComingSoonScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const params = useLocalSearchParams<Params>();
  const tournament = params.kind === 'tournament';
  const scope = normaliseScope(params.scope ?? '');
  const format = params.format ?? '';
  const area = scope === ISLAND_WIDE ? 'Island-wide' : scopeLabel(scope);
  const name = params.name || competitionName(scope, format);
  const teams = tournament && params.teams ? `${params.teams} teams` : null;
  const subtitle = [area, `${format} ${tournament ? 'tournament' : 'league'}`, teams].filter(Boolean).join(' · ');

  return (
    <View testID="coming-soon-screen" style={styles.screen}>
      <NightHeader
        title={name}
        subtitle={subtitle}
        badge={tournament ? tournamentBadge(name) : competitionBadge(scope || name, format)}
        back={{ label: 'Leagues', onPress: backToLeagues, testID: 'coming-soon-header-back' }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.icon}>
          <IconSymbol name="trophy.fill" size={ICON.regular} color={colors.ink} />
        </View>
        <Text variant="display" accessibilityRole="header">
          Coming soon
        </Text>
        <Text variant="body" tone="inkMuted" style={styles.line}>
          {tournament
            ? 'Sign-up hasn’t opened yet. Check back here for dates and sign-up.'
            : 'This league hasn’t started yet. Check back here for sign-up.'}
        </Text>
        <View style={styles.button}>
          <Button label="Back to leagues" variant="secondary" fullWidth onPress={backToLeagues} testID="coming-soon-back" />
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { alignItems: 'center', gap: space.lg, padding: space.xl, paddingTop: space.xxl * 2 },
  icon: {
    width: space.xxl * 3,
    height: space.xxl * 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { textAlign: 'center' },
  button: { alignSelf: 'stretch', paddingTop: space.sm },
}));
