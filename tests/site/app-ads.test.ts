// G4a: AdMob only serves ads to apps whose developer website lists the
// publisher in /app-ads.txt (IAB format). futty.app/app-ads.txt must hold
// exactly Futty's AdMob publisher line, served as plain text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SITE = join(__dirname, '..', '..', 'site');
const read = (path: string) => readFileSync(join(SITE, path), 'utf8').replace(/\r\n/g, '\n');

describe('app-ads.txt', () => {
  it("lists Futty's AdMob publisher, and nothing else", () => {
    const lines = read('app-ads.txt').split('\n').filter((l) => l.trim() !== '');
    expect(lines).toEqual(['google.com, pub-2436288039660225, DIRECT, f08c47fec0942fa0']);
  });

  it('uses the same publisher as the AdMob app IDs in app.json', () => {
    const appJson = readFileSync(join(__dirname, '..', '..', 'app.json'), 'utf8');
    const ids = appJson.match(/ca-app-pub-(\d{16})~\d+/g) ?? [];
    for (const id of ids) {
      // Google's public test IDs (pub-3940256099942544) are allowed until the real ones are set.
      if (!id.startsWith('ca-app-pub-3940256099942544')) expect(id).toContain('2436288039660225');
    }
  });

  it('is served as plain text', () => {
    expect(read('_headers')).toMatch(/\/app-ads\.txt\n\s+Content-Type: text\/plain/);
  });
});
