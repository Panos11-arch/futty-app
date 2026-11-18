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
// needs site/terms/index.html updated too.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-rules', () => {
  const { SPEC_RULES: rules } = jest.requireActual<typeof import('@/lib/rules.fixtures')>('@/lib/rules.fixtures');
  return { useRules: () => ({ state: { status: 'ready', rules, fresh: true }, reload: jest.fn() }) };
});

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The page's text blocks (h2, p, li, div) inside <main>, in order. The h1 is
 *  the page title, which the app shows in its navigation bar instead. */
function siteBlocks(page: string): string[] {
  const source = readFileSync(join(__dirname, '..', '..', 'site', page, 'index.html'), 'utf8');
  const main = source.slice(source.indexOf('<main>'), source.indexOf('</main>'));
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
