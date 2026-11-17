import { ActivityIndicator } from 'react-native';

import { DocBullet, DocEmailLink, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';
import { AuthButton } from '@/components/auth-form';
import { TEAM_PREMIUM_ENABLED } from '@/lib/premium';
import { TERMS_UPDATED, termsSections } from '@/lib/terms';
import { useRules } from '@/lib/use-rules';

/** The Terms of Use, from spec 13 (lib/terms.ts). Every amount and time
 *  limit is the rules' (app_rules), so the terms wait for the rules rather
 *  than show a guessed number. */
export default function TermsOfUseScreen() {
  const { state, reload } = useRules();

  return (
    <DocScreen updated={TERMS_UPDATED}>
      <DocParagraph>These terms govern your use of Futty. By creating an account, you agree to them.</DocParagraph>

      {state.status === 'loading' ? <ActivityIndicator /> : null}
      {state.status === 'error' ? (
        <>
          <DocParagraph>The booking and payment terms couldn’t be loaded. Check your connection and try again.</DocParagraph>
          <AuthButton label="Try again" variant="secondary" onPress={reload} compact />
        </>
      ) : null}
      {state.status === 'ready'
        ? termsSections(state.rules, { teamPremium: TEAM_PREMIUM_ENABLED }).map((section) => (
            <TermsSectionView key={section.heading} {...section} />
          ))
        : null}

      <DocHeading>Contact</DocHeading>
      <DocEmailLink email="palepis@icloud.com" />
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
