import { DocBullet, DocEmailLink, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';

/** No pre-existing terms.html to transcribe (only privacy-policy.html and
 *  support.html existed) — this is a plain, standard set of terms for a
 *  pitch-booking/community app, matching the same sections and tone as
 *  privacy-policy.tsx. Have a lawyer review before this is the terms an App
 *  Store listing actually links to. */
export default function TermsOfUseScreen() {
  return (
    <DocScreen updated="August 2026">
      <DocParagraph>
        These terms govern your use of Futty. By creating an account, you agree to them.
      </DocParagraph>

      <DocHeading>Your account</DocHeading>
      <DocBullet>You must be at least 16 years old to use Futty.</DocBullet>
      <DocBullet>You&apos;re responsible for the activity on your account and for keeping your login secure.</DocBullet>
      <DocBullet>Information you provide (name, username, profile details) must be accurate.</DocBullet>

      <DocHeading>Bookings and payments</DocHeading>
      <DocBullet>
        A booking reserves a pitch for the time slot shown; venue availability and pricing are set
        by the venue, not Futty.
      </DocBullet>
      <DocBullet>
        For a shared booking, each player pays their own split share. The booking is confirmed once
        the booker&apos;s share is paid; it is automatically cancelled and every paid player fully
        refunded if any player&apos;s share is still unpaid 3 hours before kickoff.
      </DocBullet>
      <DocBullet>
        Cancellation cutoffs and refund eligibility are shown in the app at the time you book or
        cancel.
      </DocBullet>

      <DocHeading>Premium</DocHeading>
      <DocParagraph>
        Personal and Team Premium are auto-renewing (personal) or one-time (team) purchases billed
        through the App Store or Google Play, governed by their respective terms in addition to
        these.
      </DocParagraph>

      <DocHeading>Conduct</DocHeading>
      <DocBullet>Treat other players, captains, and venue staff with respect.</DocBullet>
      <DocBullet>Don&apos;t post false availability, impersonate another person or team, or abuse the reporting/blocking tools.</DocBullet>
      <DocBullet>We can suspend or remove an account for behaviour that harms other users or the app.</DocBullet>

      <DocHeading>Content you post</DocHeading>
      <DocParagraph>
        You&apos;re responsible for squad posts, chat messages, and profile content you submit.
        Don&apos;t post anything illegal, abusive, or that infringes someone else&apos;s rights.
      </DocParagraph>

      <DocHeading>Disclaimer</DocHeading>
      <DocParagraph>
        Futty connects players, teams, and venues — it isn&apos;t a party to the game itself.
        We&apos;re not liable for injuries, disputes, or losses arising from a match or booking
        arranged through the app.
      </DocParagraph>

      <DocHeading>Changes</DocHeading>
      <DocParagraph>If these terms change materially, we&apos;ll update the date above.</DocParagraph>

      <DocHeading>Contact</DocHeading>
      <DocEmailLink email="palepis@icloud.com" />
    </DocScreen>
  );
}
