// The futty.app website (site/): one header and footer on every page, links
// by path, support@futty.app as the contact (mail@futty.app only where the
// homepage talks to venues), no external scripts or fonts, no launch date,
// and the Formspree and Google Analytics IDs in one place, with the forms
// hidden and analytics off until they're set.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SITE = join(ROOT, 'site');

function read(page: string): string {
  return readFileSync(join(SITE, page, 'index.html'), 'utf8');
}

const home = read('');
const PAGES = ['privacy', 'terms', 'el/privacy', 'el/terms', 'support', 'cookies'];
const GREEK = new Set(['el/privacy', 'el/terms']);

/** The page without its inline script (the homepage's dictionaries and code). */
function markup(source: string): string {
  return source.replace(/<script>[\s\S]*?<\/script>/g, '');
}

function hrefs(source: string): string[] {
  return [...markup(source).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

describe('every page', () => {
  it.each(PAGES)('%s has the shared header and footer', (page) => {
    const source = read(page);
    const homeUrl = GREEK.has(page) ? '/?lang=el' : '/';
    const legal = GREEK.has(page) ? '/el/' : '/';
    expect(source).toContain('<link rel="stylesheet" href="/style.css">');
    expect(source).toContain(`<a class="brandmark" href="${homeUrl}"><img src="/img/logo.png" alt="">Futty</a>`);
    for (const anchor of ['features', 'programme', 'venues']) {
      expect(source).toContain(`<a class="lnk" href="${homeUrl}#${anchor}">`);
    }
    for (const link of [`${legal}terms/`, `${legal}privacy/`, '/cookies/', '/support/']) {
      expect(source).toContain(`<a class="foot-link" href="${link}">`);
    }
    expect(source).toContain('<a class="foot-link" href="mailto:support@futty.app">support@futty.app</a>');
  });

  it.each(['', ...PAGES])('%s links the site by path, never to .html files', (page) => {
    for (const href of hrefs(read(page))) {
      expect(href).not.toMatch(/\.html($|[?#])/);
    }
  });

  it.each(['', ...PAGES])('%s loads no external script, stylesheet or font', (page) => {
    const source = read(page);
    expect(source).not.toMatch(/<script[^>]+src=/);
    expect(source).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https?:/);
    expect(source).not.toMatch(/fonts\.googleapis|fonts\.gstatic|@import/);
  });

  it.each(PAGES)('%s gives support@futty.app, never mail@futty.app', (page) => {
    expect(read(page)).not.toContain('mail@futty.app"');
    expect(read(page)).not.toContain('>mail@futty.app<');
  });

  it('every image and font the pages use is served from site/', () => {
    // Hidden on the homepage until the image exists (noted in the PR).
    const missingOnPurpose = new Set(['img/venue-dashboard.webp']);
    const css = readFileSync(join(SITE, 'style.css'), 'utf8');
    const refs = [home, css, ...PAGES.map(read)].flatMap((s) => [
      ...[...s.matchAll(/(?:src|href|data-src)="\/?((?:img|fonts)\/[^"]+)"/g)].map((m) => m[1]),
      ...[...s.matchAll(/url\(\/?((?:img|fonts)\/[^)]+)\)/g)].map((m) => m[1]),
    ]);
    expect(refs.length).toBeGreaterThan(20);
    for (const ref of new Set(refs)) {
      if (missingOnPurpose.has(ref)) continue;
      expect(existsSync(join(SITE, ref))).toBe(true);
    }
  });
});

describe('the homepage', () => {
  it('links privacy, terms, cookies and support by path; privacy and terms follow the language', () => {
    const links = hrefs(home);
    for (const link of ['/privacy/', '/terms/', '/cookies/', '/support/']) expect(links).toContain(link);
    expect(markup(home)).toContain('<a class="foot-link" href="/terms/" data-legal="terms">');
    // Greek (?lang=el) points them at /el/privacy/ and /el/terms/.
    expect(home).toContain(
      "document.querySelectorAll('a[data-legal]').forEach(function(a){ a.setAttribute('href',(lang==='el'?'/el/':'/')+a.getAttribute('data-legal')+'/'); });",
    );
  });

  it('keeps its 14 languages', () => {
    expect(home).toContain("var LANGS=['da','de','en','es','fr','it','nl','pl','pt','sv','el','ru','uk','ar'];");
  });

  it('says "Coming soon", with no launch date', () => {
    expect(home).not.toMatch(/Launch|Lancering|new Date\(2026|23\/11\/2026/);
    expect(home).toContain("var soon=T('· coming soon')");
  });

  it('gives mail@futty.app only to venues', () => {
    const page = markup(home);
    expect(page.match(/mailto:mail@futty\.app/g)).toHaveLength(1);
    const venues = page.slice(page.indexOf('<section class="venues'), page.indexOf('</section>', page.indexOf('<section class="venues')));
    expect(venues).toContain('<a href="mailto:mail@futty.app">mail@futty.app</a>');
    expect(page).toContain('More questions? <a href="mailto:support@futty.app">support@futty.app</a>');
  });

  it('sets the Formspree and Google Analytics IDs in one place, empty until filled in', () => {
    expect(home.match(/var FORMSPREE=/g)).toHaveLength(1);
    expect(home.match(/var GA_ID=/g)).toHaveLength(1);
    expect(home).toContain("var FORMSPREE={ waitlist:'', venue:'' };");
    expect(home).toContain("var GA_ID='';");
    expect(home).toContain('SETTINGS TO FILL IN');
  });

  it('hides both forms until their Formspree ID is set, with no email fallback', () => {
    const page = markup(home);
    expect(page).toContain('<form class="waitlist" id="waitlist" data-form="waitlist" novalidate hidden>');
    expect(page).toContain('<a class="wl-link" href="#waitlist" id="wlLink" hidden>');
    expect(page).toMatch(/<button class="btn btn-green rv" id="venueOpen" type="button" hidden/);
    expect(page).toMatch(/<form class="vform" id="venueForm" data-form="venue" hidden/);
    expect(home).toContain("if(FORMSPREE.waitlist){ $('waitlist').hidden=false; $('wlLink').hidden=false; }");
    expect(home).toContain("if(FORMSPREE.venue){ $('venueOpen').hidden=false; }");
    expect(home).toContain('if(!FORMSPREE[kind]) return;');
    expect(home).not.toContain('mailtoFallback');
    // Anything hidden stays hidden, whatever its class sets.
    expect(home).toContain('[hidden]{display:none !important}');
  });

  it('loads Google Analytics only after the visitor accepts, and talks to nothing else but Formspree', () => {
    const external = [...home.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]);
    const scripts = (home.match(/<script>[\s\S]*?<\/script>/g) ?? []).join('\n');
    const calledFromScript = [...scripts.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]);
    expect(new Set(calledFromScript)).toEqual(new Set(['formspree.io', 'www.googletagmanager.com']));
    expect(external.filter((h) => !['www.futty.app', 'www.instagram.com', 'www.facebook.com'].includes(h))).toEqual(
      calledFromScript,
    );
    // The tag is only added inside loadGA, which runs on Accept (or a stored yes) and needs an ID.
    const loadGA = scripts.slice(scripts.indexOf('function loadGA'), scripts.indexOf('function clearGACookies'));
    expect(loadGA).toContain("if(!GA_ID || window.gtag) return;");
    expect(loadGA).toContain('googletagmanager.com/gtag/js');
    expect(scripts.match(/googletagmanager/g)).toHaveLength(1);
    expect(scripts).toContain("if(v==='yes') loadGA();");
    expect(scripts).toContain("var cv=getConsent(); if(cv==='yes') loadGA(); else if(cv!=='no') $('cookieBar').hidden=false;");
  });

  it('hides the venue dashboard image until it exists', () => {
    expect(home).toContain('<div class="venue-shot rv d2" hidden>');
  });
});

describe('the cookies page', () => {
  const cookies = read('cookies');
  it('has no draft banner and no placeholders', () => {
    const main = cookies.slice(cookies.indexOf('<main>'), cookies.indexOf('</main>'));
    expect(main).not.toMatch(/Draft|\[/);
    expect(main).toContain('<td data-label="Name">_ga, _ga_&lt;ID&gt;</td>');
    expect(main).toContain("Up to 2 years (Google's own documentation)");
  });
});

it('site-new/ is gone: site/ is the website', () => {
  expect(existsSync(join(ROOT, 'site-new'))).toBe(false);
});
