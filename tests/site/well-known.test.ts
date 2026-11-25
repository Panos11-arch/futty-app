// S16: futty.app/p/<username> opens the app. The website serves Apple's
// apple-app-site-association and Android's assetlinks.json from
// /.well-known/, as JSON. The Apple Team ID is filled in (5Y987W9KDK); the
// Android signing certificate's SHA-256 fingerprint is a placeholder until
// Panos fills it in; the tests fail loudly if a placeholder is mistyped.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'site');
// A Windows checkout (core.autocrlf=true) has CRLF line endings.
const read = (path: string) => readFileSync(join(SITE, path), 'utf8').replace(/\r\n/g, '\n');

const APPLE_TEAM_ID = '5Y987W9KDK';
const FINGERPRINT_PLACEHOLDER = 'REPLACE_WITH_ANDROID_SHA256_FINGERPRINT';

describe('apple-app-site-association', () => {
  const aasa = JSON.parse(read('.well-known/apple-app-site-association'));

  it('links futty.app/p/* to the app, and nothing else', () => {
    expect(aasa).toEqual({
      applinks: {
        details: [
          {
            appIDs: [`${APPLE_TEAM_ID}.com.panosalepis.futtyapp`],
            components: [{ '/': '/p/*', comment: 'A player card: futty.app/p/<username>' }],
          },
        ],
      },
    });
  });

  it('the app ID is the 10-character Team ID and the bundle ID, with no placeholder left', () => {
    const [appId] = aasa.applinks.details[0].appIDs as string[];
    expect(appId).toMatch(/^[A-Z0-9]{10}\.com\.panosalepis\.futtyapp$/);
    expect(read('.well-known/apple-app-site-association')).not.toContain('REPLACE_WITH');
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
