// The futty.app website (site/): one header and footer on every page, links
// by path, support@futty.app as the only contact address, https://futty.app/
// as the primary domain, no external scripts or fonts, no launch date, and
// the Formspree and Google Analytics IDs in one place, with the forms hidden
// and analytics off until they're set.
//
// While Futty isn't launched, the website is private (decided by Panos, 22
// November): https://futty.app/ is a plain "Coming soon" page, and only the
// pages App Store Connect and Google need (privacy, terms, their Greek
// versions, cookies, support) stay public. The marketing homepage and its
// app screenshots are kept in site-marketing/, which is not deployed. To go
// public again, move site-marketing/index.html and site-marketing/img/* back
// into site/ and drop the "private website" tests.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SITE = join(ROOT, 'site');

function read(page: string): string {
  return readFileSync(join(SITE, page, 'index.html'), 'utf8');
}

const MARKETING = join(ROOT, 'site-marketing');
/** The marketing homepage, kept out of the website while it is private. */
const home = readFileSync(join(MARKETING, 'index.html'), 'utf8');
/** What https://futty.app/ serves today. */
const comingSoon = read('');
const PAGES = ['privacy', 'terms', 'el/privacy', 'el/terms', 'support', 'cookies'];
const GREEK = new Set(['el/privacy', 'el/terms']);

/** The page without its inline script (the homepage's dictionaries and code). */
function markup(source: string): string {
  return source.replace(/<script>[\s\S]*?<\/script>/g, '');
}

function hrefs(source: string): string[] {
  return [...markup(source).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

/** Every text file under site/ (pages, stylesheet), by path. */
function siteTextFiles(dir: string = SITE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return siteTextFiles(path);
    return /\.(html|css|js|json|txt|xml|svg|webmanifest)$/.test(entry.name) ? [path] : [];
  });
}

describe('the whole site', () => {
  const files = siteTextFiles();

  it('has text files to check', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((f) => [f.slice(SITE.length + 1)]))('%s never contains mail@futty.app', (file) => {
    expect(readFileSync(join(SITE, file), 'utf8')).not.toContain('mail@futty.app');
  });

  it.each(files.map((f) => [f.slice(SITE.length + 1)]))('%s uses https://futty.app/, never www.futty.app', (file) => {
    expect(readFileSync(join(SITE, file), 'utf8')).not.toContain('www.futty.app');
  });
});

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

  it('every image and font the pages use is served from site/ (or kept with the marketing homepage)', () => {
    // Hidden on the homepage until the image exists (noted in the PR).
    const missingOnPurpose = new Set(['img/venue-dashboard.webp']);
    const css = readFileSync(join(SITE, 'style.css'), 'utf8');
    const refs = [home, comingSoon, css, ...PAGES.map(read)].flatMap((s) => [
      ...[...s.matchAll(/(?:src|href|data-src)="\/?((?:img|fonts)\/[^"]+)"/g)].map((m) => m[1]),
      ...[...s.matchAll(/url\(\/?((?:img|fonts)\/[^)]+)\)/g)].map((m) => m[1]),
    ]);
    expect(refs.length).toBeGreaterThan(20);
    for (const ref of new Set(refs)) {
      if (missingOnPurpose.has(ref)) continue;
      expect(existsSync(join(SITE, ref)) || existsSync(join(MARKETING, ref))).toBe(true);
    }
  });
});

describe('the private website (coming soon)', () => {
  const page = markup(comingSoon);

  it('says Coming soon and asks search engines not to list it', () => {
    expect(comingSoon).toContain('<title>Futty — Coming soon</title>');
    expect(comingSoon).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain('<h1>Coming soon</h1>');
  });

  it('shows no app screens, forms, scripts or languages', () => {
    expect(comingSoon).not.toMatch(/<script|<form|<iframe/);
    const images = [...comingSoon.matchAll(/(?:src|href)="\/?(img\/[^"]+)"/g)].map((m) => m[1]);
    for (const img of images) expect(img).toMatch(/^img\/(logo\.png|favicon[^/]*|apple-touch-icon[^/]*)$/);
    expect(comingSoon).not.toContain('og:image');
  });

  it('links the public pages and support@futty.app', () => {
    const links = hrefs(comingSoon);
    for (const link of ['/privacy/', '/terms/', '/cookies/', '/support/', 'mailto:support@futty.app']) {
      expect(links).toContain(link);
    }
    expect(comingSoon).toContain('<link rel="stylesheet" href="/style.css">');
  });

  it('keeps the marketing homepage out of site/', () => {
    expect(home).toContain("var LANGS=");
    for (const file of siteTextFiles()) {
      expect(readFileSync(file, 'utf8')).not.toContain('var LANGS=');
    }
  });

  it('serves only the logo and icons from site/img (the app screenshots stay with the marketing homepage)', () => {
    for (const file of readdirSync(join(SITE, 'img'))) {
      expect(file).toMatch(/^(logo\.png|favicon[^/]*|apple-touch-icon[^/]*)$/);
    }
    for (const shot of ['s1-home.webp', '01-book.webp', 'player-card.webp', 'og-image.png']) {
      expect(existsSync(join(MARKETING, 'img', shot))).toBe(true);
    }
  });
});

describe('the marketing homepage (site-marketing/, not deployed while the website is private)', () => {
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

  it('gives support@futty.app everywhere, venues included', () => {
    const page = markup(home);
    const venues = page.slice(page.indexOf('<section class="venues'), page.indexOf('</section>', page.indexOf('<section class="venues')));
    expect(venues).toContain('<a href="mailto:support@futty.app">support@futty.app</a>');
    expect(page).toContain('More questions? <a href="mailto:support@futty.app">support@futty.app</a>');
    expect(page.match(/href="mailto:[^"]*"/g)).toEqual(Array(3).fill('href="mailto:support@futty.app"'));
    // A failed form send points to support@ too, in every language.
    expect(home).toContain(".catch(function(){ formMsg(f,T('Something went wrong. Please try again or email support@futty.app.'),false); })");
  });

  it('names https://futty.app/ as its address: canonical, og:url and every hreflang', () => {
    expect(home).toContain('<link rel="canonical" href="https://futty.app/">');
    expect(home).toContain('<meta property="og:url" content="https://futty.app/">');
    expect(home).toContain('<link rel="alternate" hreflang="x-default" href="https://futty.app/">');
    expect(home).toContain('<link rel="alternate" hreflang="el" href="https://futty.app/?lang=el">');
    expect(home.match(/hreflang="[a-z-]+" href="https:\/\/futty\.app\//g)).toHaveLength(15);
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
    expect(external.filter((h) => !['futty.app', 'www.instagram.com', 'www.facebook.com'].includes(h))).toEqual(
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
