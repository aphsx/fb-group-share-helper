/**
 * Node smoke test for pure helpers (no DOM / no Chrome).
 * Run: node test/helpers-smoke.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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

assert(H.extractGroupId('https://www.facebook.com/groups/12345') === '12345', 'extract from URL');
assert(H.extractGroupId('999888777') === '999888777', 'extract numeric');
assert(H.toGroupUrl('42').endsWith('/groups/42'), 'toGroupUrl');
const list = H.parseGroupList('https://www.facebook.com/groups/a\na\n#x\nb\n');
assert(list.length === 2, 'parse unique lines');
const d = H.randomDelayMs(10, 20);
assert(d >= 10000 && d <= 20000, 'randomDelayMs in range: ' + d);
assert(H.normalizeText('  Hello   WORLD ') === 'hello world', 'normalizeText');

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAll helper smoke tests passed.');
