// S16: futty.app/p/<username> opens the app; S20A: so do futty.app/i/...
// invite links. The website serves Apple's apple-app-site-association and
// Android's assetlinks.json from /.well-known/, as JSON. The Apple Team ID is
// 5Y987W9KDK; the Android fingerprint is EAS's production signing key (from
// Panos, 27 November). Google Play's app signing key is added once the app is
// on Play.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'site');
// A Windows checkout (core.autocrlf=true) has CRLF line endings.
const read = (path: string) => readFileSync(join(SITE, path), 'utf8').replace(/\r\n/g, '\n');

const APPLE_TEAM_ID = '5Y987W9KDK';
// EAS's production keystore for com.panosalepis.futtyapp (eas credentials).
const EAS_SHA256 = '72:06:0E:E5:8A:AB:C4:AB:F0:EC:C0:45:B4:42:EA:22:A9:C2:AC:E9:3E:20:DD:27:AE:D8:D4:97:6B:DD:52:89';

describe('apple-app-site-association', () => {
  const aasa = JSON.parse(read('.well-known/apple-app-site-association'));

  it('links futty.app/p/* and futty.app/i/* to the app, and nothing else', () => {
    expect(aasa).toEqual({
      applinks: {
        details: [
          {
            appIDs: [`${APPLE_TEAM_ID}.com.panosalepis.futtyapp`],
            components: [
              { '/': '/p/*', comment: 'A player card: futty.app/p/<username>' },
              { '/': '/i/*', comment: 'An invite link (S20A): futty.app/i/<code>' },
            ],
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
          sha256_cert_fingerprints: [EAS_SHA256],
        },
      },
    ]);
  });

  it('each fingerprint is 32 colon-separated upper-case hex bytes, with no placeholder left', () => {
    for (const fp of links[0].target.sha256_cert_fingerprints as string[]) {
      expect(fp).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
    expect(read('.well-known/assetlinks.json')).not.toContain('REPLACE_WITH');
  });
});

describe('Netlify headers', () => {
  it('serves both files as JSON (Apple needs it for the file with no extension)', () => {
    const headers = read('_headers');
    expect(headers).toContain('/.well-known/apple-app-site-association\n  Content-Type: application/json');
    expect(headers).toContain('/.well-known/assetlinks.json\n  Content-Type: application/json');
  });
});
