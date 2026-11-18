import '../account/mocks';

import { render, screen } from '@testing-library/react-native';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import PrivacyPolicyScreen from '@/app/account/privacy-policy';
import TermsOfUseScreen from '@/app/account/terms';

// The website (site/) is what App Store Connect and Google link to; the app
// shows its own screens. They must say the same thing. The terms are checked
// against spec 13's default rules (the app_rules migration), so a change to
// lib/terms.ts, the terms screen, the Team Premium flag or the default rules
// needs site/terms/index.html updated too. The Greek pages (site/el/privacy,
// site/el/terms) are checked the same way against the screens on a phone set
// to Greek: the Greek policy in app/account/privacy-policy.tsx and
// lib/terms-el.ts.
let mockLanguage: 'en' | 'el' = 'en';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/language', () => ({ deviceLanguage: () => mockLanguage }));
jest.mock('@/lib/use-rules', () => {
  const { SPEC_RULES: rules } = jest.requireActual<typeof import('@/lib/rules.fixtures')>('@/lib/rules.fixtures');
  return { useRules: () => ({ state: { status: 'ready', rules, fresh: true }, reload: jest.fn() }) };
});

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The page's text blocks (h2, p, li, div) inside <main>, in order. The h1 is
 *  the page title, which the app shows in its navigation bar instead. The
 *  privacy pages' "On this website" section (<section class="website-only">)
 *  is about the website, not the app: it is left out here and checked below. */
function sitePage(page: string): string {
  return readFileSync(join(__dirname, '..', '..', 'site', page, 'index.html'), 'utf8');
}

function siteBlocks(page: string): string[] {
  const source = sitePage(page);
  const main = source
    .slice(source.indexOf('<main>'), source.indexOf('</main>'))
    .replace(/<section class="website-only"[\s\S]*?<\/section>/, '');
  return [...main.matchAll(/<(h2|p|li|div)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) =>
    clean(
      m[2]
        .replace(/<[^>]+>/g, '')
        .replace(/&(\w+);/g, (whole, name: string) => ENTITIES[name] ?? whole)
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code))),
    ),
  );
}

/** The part of a rendered node (screen.toJSON()) the walk below reads. */
type RenderedNode = { type: string; children: (RenderedNode | string)[] | null };

/** Each piece of text the screen renders, in order. */
function appBlocks(): string[] {
  const blocks: string[] = [];
  const textOf = (node: RenderedNode | string): string =>
    typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('');
  const walk = (node: RenderedNode | RenderedNode[] | string | null) => {
    if (node === null || typeof node === 'string') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'Text') {
      blocks.push(clean(textOf(node)));
      return;
    }
    (node.children ?? []).forEach(walk);
  };
  walk(screen.toJSON());
  return blocks.filter(Boolean);
}

beforeEach(() => {
  mockLanguage = 'en';
});

describe('futty.app says what the app says', () => {
  it('privacy policy', async () => {
    await render(<PrivacyPolicyScreen />);
    expect(siteBlocks('privacy')).toEqual(appBlocks());
  });

  it('terms of use, with spec 13 amounts', async () => {
    await render(<TermsOfUseScreen />);
    const blocks = appBlocks();
    expect(blocks).toContain('Futty adds a service fee for each player: €0.80 when each player pays their own share, €0.55 when the booker pays for everyone in one payment. It is the same whatever the payment method.');
    expect(siteBlocks('terms')).toEqual(blocks);
  });
});

describe('futty.app/el says what the app says on a phone set to Greek', () => {
  beforeEach(() => {
    mockLanguage = 'el';
  });

  it('privacy policy', async () => {
    await render(<PrivacyPolicyScreen />);
    const blocks = appBlocks();
    expect(blocks).toContain('Τελευταία ενημέρωση: Νοέμβριος 2026');
    expect(siteBlocks('el/privacy')).toEqual(blocks);
  });

  it('terms of use (lib/terms-el.ts), with spec 13 amounts', async () => {
    await render(<TermsOfUseScreen />);
    const blocks = appBlocks();
    expect(blocks).toContain('Το Futty προσθέτει χρέωση υπηρεσίας για κάθε παίκτη: €0.80 όταν κάθε παίκτης πληρώνει το δικό του μερίδιο, €0.55 όταν ο διοργανωτής πληρώνει για όλους με μία πληρωμή. Είναι η ίδια με όποιον τρόπο κι αν πληρώσετε.');
    expect(siteBlocks('el/terms')).toEqual(blocks);
  });
});

describe('the English and Greek pages link to each other', () => {
  it.each([
    ['privacy', 'el/privacy', '../el/privacy/', '../../privacy/'],
    ['terms', 'el/terms', '../el/terms/', '../../terms/'],
  ])('%s', (en, el, toGreek, toEnglish) => {
    expect(sitePage(en)).toContain('<html lang="en">');
    expect(sitePage(el)).toContain('<html lang="el">');
    expect(sitePage(en)).toContain(`<a href="${toGreek}" lang="el" hreflang="el">Ελληνικά</a>`);
    expect(sitePage(el)).toContain(`<a href="${toEnglish}" lang="en" hreflang="en">English</a>`);
  });

  it('give support@futty.app as the contact', () => {
    for (const page of ['privacy', 'el/privacy', 'terms', 'el/terms']) {
      expect(sitePage(page)).toContain('<a href="mailto:support@futty.app">support@futty.app</a>');
    }
  });
});

describe('the website-only section', () => {
  it.each([
    ['privacy', 'On this website'],
    ['el/privacy', 'Σε αυτόν τον ιστότοπο'],
  ])('%s has it, naming the website data and its providers', (page, heading) => {
    const section = sitePage(page).match(/<section class="website-only"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(section).toContain(`<h2 id="on-this-website">${heading}</h2>`);
    expect(section).toContain('Formspree');
    expect(section).toContain('Google Analytics');
    // Four rows of website data: waitlist, venue form, analytics with consent, browser settings.
    expect(section.match(/<tr><td\b/g)).toHaveLength(4);
  });

  it('is on the privacy pages only', () => {
    for (const page of ['terms', 'el/terms', 'support', 'cookies']) {
      expect(sitePage(page)).not.toContain('website-only');
    }
  });
});
