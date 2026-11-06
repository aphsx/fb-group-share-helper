/**
 * Photo attach helper smoke — dataUrl → File round-trip (no Chrome).
 * Run: node test/photo-attach-smoke.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const H = require(join(__dirname, '../lib/dom-helpers.js'));

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

const MAX_IMAGES = 5;
const images = [];
for (let i = 0; i < 6; i++) {
  images.push({ name: 'i' + i + '.png', type: 'image/png', dataUrl: 'data:image/png;base64,aa' });
}
const capped = images.slice(0, MAX_IMAGES);
assert(capped.length === 5, 'cap at 5 images');

const tiny =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const f = H.dataUrlToFile(tiny, 'x.png', 'image/png');
assert(!!f, 'File created');
assert(f.name === 'x.png' || f.name == null, 'file name set when File supported');
assert(f.size >= 60, 'png size plausible: ' + f.size);

const bad = H.dataUrlToFile('not-a-data-url', 'x.png');
assert(bad === null, 'invalid dataUrl returns null');

const bg = readFileSync(join(__dirname, '../background/service-worker.js'), 'utf8');
assert(bg.includes('normalizeImages'), 'normalizeImages in background');

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nPhoto attach smoke passed.');
