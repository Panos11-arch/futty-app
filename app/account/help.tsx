import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { DocEmailLink, DocFAQ, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';
import { MenuRow, MenuSection } from '@/components/menu-row';
import { space } from '@/constants/futty-theme';
import { FUTTY_AI_HREF } from '@/lib/futty-ai';

/** Help (S2, spec 15 section 0.9): Futty AI (its chats, S13A), How Futty
 *  works, Terms and Privacy policy live here, then the support email and the
 *  FAQ. The FAQ is also on the website, site/support/index.html: keep the
 *  two in sync. */
export default function HelpScreen() {
  return (
    <DocScreen>
      <MenuSection>
        <MenuRow testID="help-futty-ai" icon="bubble.left.fill" label="Ask Futty AI" onPress={() => router.push(FUTTY_AI_HREF)} />
        <MenuRow
          testID="help-how-it-works"
          icon="info.circle.fill"
          label="How Futty works"
          onPress={() => router.push('/account/how-it-works')}
        />
        <MenuRow testID="help-terms" icon="doc.text.fill" label="Terms of use" onPress={() => router.push('/account/terms')} />
        <MenuRow
          testID="help-privacy"
          icon="lock.shield.fill"
          label="Privacy policy"
          onPress={() => router.push('/account/privacy-policy')}
        />
      </MenuSection>

      <DocParagraph>
        Pitch booking, squads, and leagues for 5/7/9/11-a-side football in Cyprus.
      </DocParagraph>

      <DocHeading>Need help, found a bug, or have feedback?</DocHeading>
      <DocParagraph>Email us and we&apos;ll get back to you as soon as we can.</DocParagraph>
      <DocEmailLink email="support@futty.app" subject="Futty Support" />

      <DocHeading>Common questions</DocHeading>
      <View style={styles.faqs}>
        <DocFAQ question="How do I book a pitch?">
          Tap Book a pitch on Home, pick a day, city, format, and duration, then tap an open slot on
          any venue to reserve it.
        </DocFAQ>
        <DocFAQ question="How do I find players or opposition for a game?">
          From your booking, or from the Players/Match quick actions on Home, you can post that you
          need more players or need an opposing team, and other users can respond.
        </DocFAQ>
        <DocFAQ question="How do league fixtures and scores work?">
          Once your team is registered in a league, fixtures are scheduled by agreement between team
          captains, and either captain logs the result after the match. If both sides&apos; submitted
          scores match, the result is confirmed automatically.
        </DocFAQ>
        <DocFAQ question="How do I report a problem with another user?">
          You can block a user or report content directly from the app. If you need to escalate
          something urgently, email us above.
        </DocFAQ>
        <DocFAQ question="How do I delete my account?">
          Go to Account &gt; Settings &gt; Delete account. You&apos;ll need to cancel any upcoming bookings first. If you can&apos;t sign in, email us at the address above and we&apos;ll do it for you.
        </DocFAQ>
      </View>
    </DocScreen>
  );
}

const styles = StyleSheet.create({
  faqs: { gap: space.sm },
});
