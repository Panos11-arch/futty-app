import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { useMyTeams } from '@/lib/use-my-teams';

export default function TeamsScreen() {
  const myTeams = useMyTeams();
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {myTeams.status === 'loading' ? <ActivityIndicator /> : null}
        {myTeams.status === 'error' ? (
          <ThemedText style={styles.note}>Could not load your teams: {myTeams.message}</ThemedText>
        ) : null}
        {myTeams.status === 'ready' && myTeams.teams.length === 0 ? (
          <IconLabel icon="shield.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            You&apos;re not on a team yet — register one from the League tab.
          </IconLabel>
        ) : null}
        {myTeams.status === 'ready'
          ? myTeams.teams.map(({ team, role }) => (
              <Pressable
                key={team.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/(tabs)/team', params: { teamId: team.id } })}>
                <ThemedView style={[styles.card, { borderColor: border }]}>
                  <View style={styles.rowMain}>
                    <IconSymbol name="shield.fill" size={18} color={FuttyColors.emerald950} />
                    <View style={styles.textBlock}>
                      <ThemedText type="defaultSemiBold" style={styles.name}>
                        {team.name}
                      </ThemedText>
                      <ThemedText style={styles.meta}>
                        {role === 'captain' ? 'Captain' : role === 'substitute' ? 'Substitute' : 'Player'}
                        {team.city ? ` · ${team.city}` : ''}
                      </ThemedText>
                    </View>
                  </View>
                  <ThemedText style={styles.record}>
                    {team.played}P {team.won}W {team.drawn}D {team.lost}L
                  </ThemedText>
                  <IconSymbol name="chevron.right" size={16} color={FuttyColors.stone400} />
                </ThemedView>
              </Pressable>
            ))
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 10,
    padding: 16,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  textBlock: {
    gap: 1,
  },
  name: {
    fontSize: 14,
  },
  meta: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    color: FuttyColors.stone500,
  },
  record: {
    fontFamily: FuttyFonts.monoSemiBold,
    fontSize: 11,
    color: FuttyColors.stone500,
  },
});
