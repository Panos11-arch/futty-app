import { DocBullet, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';

export default function HowFuttyWorksScreen() {
  return (
    <DocScreen>
      <DocParagraph>
        Futty is built around one loop: book a pitch, get the right number of players there, and
        the app tracks what happened.
      </DocParagraph>

      <DocHeading>1. Book a pitch</DocHeading>
      <DocParagraph>
        Pick a day, city, format (5/7/9/11-a-side) and duration on the Book tab, then reserve an
        open slot at any venue. Pricier venues charge per pitch/hour; the total is split evenly
        across the format&apos;s players.
      </DocParagraph>

      <DocHeading>2. Fill the game</DocHeading>
      <DocBullet>
        Need players? Post it from your booking or Home — anyone can respond and join.
      </DocBullet>
      <DocBullet>
        Need opposition? Post it as a team and another captain can offer their team as the match.
      </DocBullet>
      <DocBullet>Squads is where every open post across the app shows up in one place.</DocBullet>

      <DocHeading>3. Leagues and fixtures</DocHeading>
      <DocParagraph>
        Register a team into a league from the League tab. Fixtures are scheduled by both captains
        agreeing a date/venue in Matchmaking, and either captain logs the score after the match —
        it&apos;s confirmed once both sides agree.
      </DocParagraph>

      <DocHeading>4. XP, stats and Premium</DocHeading>
      <DocParagraph>
        Every logged result feeds your profile&apos;s games/goals/win-rate and XP tier. Premium
        unlocks booking further ahead and a verified badge; Team Premium unlocks the 9- and
        11-a-side leagues for your team.
      </DocParagraph>
    </DocScreen>
  );
}
