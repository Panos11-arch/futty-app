import { DocBullet, DocEmailLink, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';

/** Native transcription of docs/privacy-policy.html — keep the two in sync;
 *  the HTML version is what App Store Connect's Privacy Policy URL field
 *  points at, this is what's shown inside the app itself. */
export default function PrivacyPolicyScreen() {
  return (
    <DocScreen updated="August 2026">
      <DocParagraph>
        Futty (&quot;the app&quot;, &quot;we&quot;, &quot;us&quot;) is a pitch-booking and
        5-a-side-to-11-a-side football community app for Cyprus. This page explains what
        information the app collects, why, and how it&apos;s used.
      </DocParagraph>

      <DocHeading>Information you provide</DocHeading>
      <DocBullet>Email address — account sign-in and password recovery.</DocBullet>
      <DocBullet>Username, full name — identifies you to other players/teammates.</DocBullet>
      <DocBullet>
        Phone number (optional) — only shown to other users if you turn on &quot;Show my number
        publicly&quot;, off by default.
      </DocBullet>
      <DocBullet>
        City, gender, date of birth, position, preferred foot, bio (optional) — shown on your
        player profile so teammates and opponents know who they&apos;re playing with.
      </DocBullet>

      <DocHeading>Information created by using the app</DocHeading>
      <DocBullet>Bookings — which pitch, date, and time you book.</DocBullet>
      <DocBullet>
        Teams and leagues — team membership, league standings, match results, XP and stats
        derived from games you play.
      </DocBullet>
      <DocBullet>
        Squad posts — &quot;need players&quot; / &quot;need opposition&quot; posts you create or
        respond to.
      </DocBullet>
      <DocBullet>
        Messages — chat messages sent between team captains to arrange a fixture, visible only to
        the two captains involved.
      </DocBullet>
      <DocBullet>Follows — which players or teams you choose to follow.</DocBullet>

      <DocHeading>Push notifications</DocHeading>
      <DocParagraph>
        If you enable push notifications, your device&apos;s push token is stored so we can notify
        you about relevant squad posts. You can turn this off at any time in Account &gt; Settings
        &gt; Notifications, which removes your stored token.
      </DocParagraph>

      <DocHeading>Biometric app lock</DocHeading>
      <DocParagraph>
        Face ID / fingerprint app-lock is handled entirely on your device by iOS/Android&apos;s own
        biometric APIs. Futty never receives, stores, or transmits your biometric data — the app is
        only ever told &quot;unlocked&quot; or &quot;not unlocked&quot;.
      </DocParagraph>

      <DocHeading>Payments</DocHeading>
      <DocParagraph>
        Personal and Team Premium purchases are handled entirely by Apple (via the App Store) or
        Google (via Google Play) — Futty never sees or stores your card details, only confirmation
        that a purchase was made. Pitch booking payments (including each player&apos;s split share)
        are processed by Stripe; Futty never stores your full card number.
      </DocParagraph>

      <DocHeading>Who your information is shared with</DocHeading>
      <DocBullet>
        Other users — your username, and any profile fields you&apos;ve chosen to make visible, are
        visible to other signed-in users (this is a community app; player/team browsing is a core
        feature). Your email and phone number (unless you opt in) are never shown to other users.
      </DocBullet>
      <DocBullet>
        Service providers — the app is built on Supabase (database, authentication, hosting),
        Stripe (pitch booking payments), and Expo/EAS (app infrastructure, push delivery). These
        providers process data on our behalf and don&apos;t use it for their own purposes.
      </DocBullet>
      <DocBullet>We do not sell your data, and we do not use third-party ad/tracking SDKs.</DocBullet>

      <DocHeading>Blocking and reporting</DocHeading>
      <DocParagraph>
        You can block another user from within the app, which hides their messages and posts from
        you. You can also report a user or piece of content; reports are reviewed by the app&apos;s
        developer.
      </DocParagraph>

      <DocHeading>Your choices</DocHeading>
      <DocBullet>You can edit or remove most profile fields at any time from Edit Profile.</DocBullet>
      <DocBullet>You can turn off push notifications and phone number visibility at any time.</DocBullet>
      <DocBullet>To request deletion of your account and associated data, contact us below.</DocBullet>

      <DocHeading>Changes to this policy</DocHeading>
      <DocParagraph>If this policy changes materially, we&apos;ll update the date above.</DocParagraph>

      <DocHeading>Contact</DocHeading>
      <DocEmailLink email="palepis@icloud.com" />
    </DocScreen>
  );
}
