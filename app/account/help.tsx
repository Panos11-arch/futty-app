import { View } from 'react-native';

import { DocEmailLink, DocFAQ, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';

/** Native transcription of docs/support.html's FAQ — see that file for the
 *  source content this is kept in sync with. */
export default function HelpScreen() {
  return (
    <DocScreen>
      <DocParagraph>
        Pitch booking, squads, and leagues for 5/7/9/11-a-side football in Cyprus.
      </DocParagraph>

      <DocHeading>Need help, found a bug, or have feedback?</DocHeading>
      <DocParagraph>Email us and we&apos;ll get back to you as soon as we can.</DocParagraph>
      <DocEmailLink email="palepis@icloud.com" subject="Futty Support" />

      <DocHeading>Common questions</DocHeading>
      <View style={{ gap: 8 }}>
        <DocFAQ question="How do I book a pitch?">
          Open the Book tab, pick a day, city, format, and duration, then tap an open slot on any
          venue to reserve it.
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
