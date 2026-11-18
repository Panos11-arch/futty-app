#!/usr/bin/env node
// Makes the Premium logo images (U9) from the mint F in
// assets/images/splash-icon.png. See logo.ts. Runs logo.ts directly, so it
// needs Node 22.18 or later.
//
//   node scripts/logo/run.mjs
//
// Writes assets/images/logo-premium.png and assets/images/logo-mark.png.
// The colours come from constants/futty-theme.ts (logoMint, logoBlack).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodePng, encodePng, makeMark, makePremium, readLogoTokens } from './logo.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const images = path.join(root, 'assets', 'images');

const tokens = readLogoTokens(fs.readFileSync(path.join(root, 'constants', 'futty-theme.ts'), 'utf8'));
const splash = decodePng(fs.readFileSync(path.join(images, 'splash-icon.png')));

const outputs = {
  'logo-premium.png': makePremium(splash, tokens),
  'logo-mark.png': makeMark(splash),
};
for (const [name, image] of Object.entries(outputs)) {
  fs.writeFileSync(path.join(images, name), encodePng(image));
  console.log(`wrote assets/images/${name} (${image.width} x ${image.height})`);
}
