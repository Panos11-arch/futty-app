import { router } from 'expo-router';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MenuRow, MenuSection } from '@/components/menu-row';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/lib/use-profile';

/** The account menu (opened from the person icon in Home's header, separate
 *  from the bell). Deliberately flat: every leaf here is one tap from this
 *  screen, and no section goes deeper than section → one more page — see
 *  AGENTS.md's "avoid nested menus deeper than what's specified" rule this
 *  hierarchy was written against. */
export default function AccountMenuScreen() {
  const { signOut } = useAuth();
  const profile = useProfile();

  async function shareProfile() {
    const name = profile.status === 'ready' ? profile.profile.username ?? profile.profile.full_name : null;
    await Share.share({
      message: name
        ? `Play with me on Futty — find me as @${name}.`
        : 'Play with me on Futty — book pitches, join squads, and track your games.',
    });
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MenuSection>
          <MenuRow icon="crown.fill" label="Go Premium" onPress={() => router.push('/account/premium')} />
          <MenuRow icon="square.and.arrow.up" label="Share Profile" onPress={shareProfile} />
        </MenuSection>

        <MenuSection title="Your Account">
          <MenuRow icon="pencil" label="Edit Profile" onPress={() => router.push('/edit-profile')} />
          <MenuRow icon="sportscourt.fill" label="My Bookings" onPress={() => router.push('/my-bookings')} />
          <MenuRow icon="flag.checkered" label="Your Activity" onPress={() => router.push('/account/activity')} />
          <MenuRow icon="creditcard.fill" label="Your Payments" onPress={() => router.push('/account/payments')} />
          <MenuRow icon="gearshape.fill" label="Settings" onPress={() => router.push('/account/settings')} />
        </MenuSection>

        {profile.status === 'ready' && profile.profile.role === 'venue_owner' ? (
          <MenuSection title="Venue Owner">
            <MenuRow
              icon="building.columns.fill"
              label="Venue Dashboard"
              onPress={() => router.push('/venue-dashboard')}
            />
          </MenuSection>
        ) : null}

        <MenuSection title="Support">
          <MenuRow icon="questionmark.circle.fill" label="Help" onPress={() => router.push('/account/help')} />
          <MenuRow icon="info.circle.fill" label="How Futty Works" onPress={() => router.push('/account/how-it-works')} />
        </MenuSection>

        <MenuSection title="Legal Information">
          <MenuRow icon="doc.text.fill" label="Terms of Use" onPress={() => router.push('/account/terms')} />
          <MenuRow icon="lock.shield.fill" label="Privacy Policy" onPress={() => router.push('/account/privacy-policy')} />
        </MenuSection>

        <View style={styles.logoutSection}>
          <MenuSection>
            <MenuRow icon="rectangle.portrait.and.arrow.right" label="Log Out" destructive onPress={signOut} />
          </MenuSection>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 20,
    padding: 16,
    paddingBottom: 48,
  },
  logoutSection: {
    marginTop: 16,
  },
});
