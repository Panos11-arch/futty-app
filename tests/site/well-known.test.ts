// S16: futty.app/p/<username> opens the app. The website serves Apple's
// apple-app-site-association and Android's assetlinks.json from
// /.well-known/, as JSON. The Apple Team ID and the Android signing
// certificate's SHA-256 fingerprint are placeholders until Panos fills them
// in (the PR says how); the tests fail loudly if a placeholder is mistyped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'site');
// A Windows checkout (core.autocrlf=true) has CRLF line endings.
const read = (path: string) => readFileSync(join(SITE, path), 'utf8').replace(/
/g, '
');

const TEAM_PLACEHOLDER = 'REPLACE_WITH_APPLE_TEAM_ID';
const FINGERPRINT_PLACEHOLDER = 'REPLACE_WITH_ANDROID_SHA256_FINGERPRINT';

describe('apple-app-site-association', () => {
  const aasa = JSON.parse(read('.well-known/apple-app-site-association'));

  it('links futty.app/p/* to the app, and nothing else', () => {
    expect(aasa).toEqual({
      applinks: {
        details: [
          {
            appIDs: [`${TEAM_PLACEHOLDER}.com.panosalepis.futtyapp`],
            components: [{ '/': '/p/*', comment: 'A player card: futty.app/p/<username>' }],
          },
        ],
      },
    });
  });

  it('the app ID is the Team ID (10 characters once filled in) and the bundle ID', () => {
    const [appId] = aasa.applinks.details[0].appIDs as string[];
    expect(appId).toMatch(new RegExp(`^(${TEAM_PLACEHOLDER}|[A-Z0-9]{10})\\.com\\.panosalepis\\.futtyapp$`));
  });
});

describe('assetlinks.json', () => {
  const links = JSON.parse(read('.well-known/assetlinks.json'));

  it('lets the Android app handle futty.app links', () => {
    expect(links).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.panosalepis.futtyapp',
          sha256_cert_fingerprints: [FINGERPRINT_PLACEHOLDER],
        },
      },
    ]);
  });

  it('each fingerprint is the placeholder or 32 colon-separated hex bytes', () => {
    for (const fp of links[0].target.sha256_cert_fingerprints as string[]) {
      expect(fp).toMatch(new RegExp(`^(${FINGERPRINT_PLACEHOLDER}|([0-9A-F]{2}:){31}[0-9A-F]{2})$`));
    }
  });
});

describe('Netlify headers', () => {
  it('serves both files as JSON (Apple needs it for the file with no extension)', () => {
    const headers = read('_headers');
    expect(headers).toContain('/.well-known/apple-app-site-association\n  Content-Type: application/json');
    expect(headers).toContain('/.well-known/assetlinks.json\n  Content-Type: application/json');
  });
});
