
import { DocBullet, DocEmailLink, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';
import { Banner } from '@/components/ui/banner';
import { SkeletonText } from '@/components/ui/skeleton';
import { TEAM_PREMIUM_ENABLED } from '@/lib/premium';
import { TERMS_UPDATED, termsSections } from '@/lib/terms';
import { useRules } from '@/lib/use-rules';

/** The Terms of use, from spec 13 (lib/terms.ts). Every amount and time
 *  limit is the rules' (app_rules), so the terms wait for the rules rather
 *  than show a guessed number. */
export default function TermsOfUseScreen() {
  const { state, reload } = useRules();

  return (
    <DocScreen updated={TERMS_UPDATED}>
      <DocParagraph>These terms govern your use of Futty. By creating an account, you agree to them.</DocParagraph>

      {state.status === 'loading' ? <SkeletonText lines={6} /> : null}
      {state.status === 'error' ? (
        <Banner
          tone="danger"
          message="The booking and payment terms couldn’t be loaded. Check your connection and try again."
          action={{ label: 'Try again', onPress: reload }}
        />
      ) : null}
      {state.status === 'ready'
        ? termsSections(state.rules, { teamPremium: TEAM_PREMIUM_ENABLED }).map((section) => (
            <TermsSectionView key={section.heading} {...section} />
          ))
        : null}

      <DocHeading>Contact</DocHeading>
      <DocEmailLink email="support@futty.app" />
    </DocScreen>
  );
}

function TermsSectionView({ heading, paragraphs = [], bullets = [] }: ReturnType<typeof termsSections>[number]) {
  return (
    <>
      <DocHeading>{heading}</DocHeading>
      {paragraphs.map((text) => (
        <DocParagraph key={text}>{text}</DocParagraph>
      ))}
      {bullets.map((text) => (
        <DocBullet key={text}>{text}</DocBullet>
      ))}
    </>
  );
}
