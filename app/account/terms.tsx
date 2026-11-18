import { DocBullet, DocEmailLink, DocHeading, DocParagraph, DocScreen } from '@/components/doc-screen';
import { Banner } from '@/components/ui/banner';
import { SkeletonText } from '@/components/ui/skeleton';
import { CONTACT_EMAIL } from '@/lib/contact';
import { deviceLanguage, type Language } from '@/lib/language';
import { TEAM_PREMIUM_ENABLED } from '@/lib/premium';
import { TERMS_UPDATED, termsSections, type TermsSection } from '@/lib/terms';
import { TERMS_UPDATED_EL, termsSectionsEl } from '@/lib/terms-el';
import { useRules } from '@/lib/use-rules';

/** The screen's own words, in English and in Greek (lib/language.ts). */
const WORDS: Record<
  Language,
  { updated: string; updatedLabel: string; intro: string; error: string; retry: string; contact: string; sections: typeof termsSections }
> = {
  en: {
    updated: TERMS_UPDATED,
    updatedLabel: 'Last updated',
    intro: 'These terms govern your use of Futty. By creating an account, you agree to them.',
    error: 'The booking and payment terms couldn’t be loaded. Check your connection and try again.',
    retry: 'Try again',
    contact: 'Contact',
    sections: termsSections,
  },
  el: {
    updated: TERMS_UPDATED_EL,
    updatedLabel: 'Τελευταία ενημέρωση',
    intro: 'Αυτοί οι όροι διέπουν τη χρήση του Futty. Δημιουργώντας λογαριασμό, τους αποδέχεστε.',
    error: 'Οι όροι κρατήσεων και πληρωμών δεν φόρτωσαν. Ελέγξτε τη σύνδεσή σας και δοκιμάστε ξανά.',
    retry: 'Δοκιμάστε ξανά',
    contact: 'Επικοινωνία',
    sections: termsSectionsEl,
  },
};

/** The Terms of use, from spec 13 (lib/terms.ts, and lib/terms-el.ts on a
 *  phone set to Greek). Every amount and time limit is the rules'
 *  (app_rules), so the terms wait for the rules rather than show a guessed
 *  number. */
export default function TermsOfUseScreen() {
  const { state, reload } = useRules();
  const words = WORDS[deviceLanguage()];

  return (
    <DocScreen updated={words.updated} updatedLabel={words.updatedLabel}>
      <DocParagraph>{words.intro}</DocParagraph>

      {state.status === 'loading' ? <SkeletonText lines={6} /> : null}
      {state.status === 'error' ? (
        <Banner tone="danger" message={words.error} action={{ label: words.retry, onPress: reload }} />
      ) : null}
      {state.status === 'ready'
        ? words.sections(state.rules, { teamPremium: TEAM_PREMIUM_ENABLED }).map((section) => (
            <TermsSectionView key={section.heading} {...section} />
          ))
        : null}

      <DocHeading>{words.contact}</DocHeading>
      <DocEmailLink email={CONTACT_EMAIL} />
    </DocScreen>
  );
}

function TermsSectionView({ heading, paragraphs = [], bullets = [] }: TermsSection) {
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
