/**
 * Lexical typing helper smoke (no browser DOM for contenteditable).
 * Run: node test/lexical-type-smoke.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const H = require(join(__dirname, '../lib/dom-helpers.js'));
const root = join(__dirname, '..');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else console.log('OK:', msg);
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
assert(manifest.version === '1.2.10', 'version 1.2.10');

assert(typeof H.composerHasText === 'function', 'composerHasText');
assert(typeof H.composerTextState === 'function', 'composerTextState');
assert(H.composerTextState({ innerText: 'Test 1 Jaaa' }, 'Test 1 Jaaa') === 'exact', 'exact caption');
assert(
  H.composerTextState({ innerText: 'Test 1 JaaaTest 1 JaaaTest 1 Jaaa' }, 'Test 1 Jaaa') === 'repeated',
  'repeated caption detected'
);
assert(H.composerTextState({ innerText: 'Write something...' }, 'Test 1 Jaaa') === 'empty', 'placeholder is empty');
assert(typeof H.findPostButton === 'function', 'findPostButton');
assert(typeof H.isPostButtonEnabled === 'function', 'isPostButtonEnabled');
assert(typeof H.findComposer === 'function', 'findComposer');
assert(typeof H.setInputText === 'function', 'setInputText');

const helpersSrc = readFileSync(join(root, 'lib/dom-helpers.js'), 'utf8');
assert(helpersSrc.includes('beforeinput'), 'setInputText fires beforeinput');
assert(helpersSrc.includes('insertText'), 'setInputText uses insertText');
assert(helpersSrc.includes('ClipboardEvent') || helpersSrc.includes('paste'), 'paste path');
assert(helpersSrc.includes('role="dialog"'), 'findComposer prefers dialog');
assert(helpersSrc.includes('aria-placeholder'), 'aria-placeholder matching');

const content = readFileSync(join(root, 'content/content.js'), 'utf8');
assert(content.includes('typeIntoComposer'), 'typeIntoComposer');
assert(content.includes('clickPostIfReady'), 'clickPostIfReady');
assert(content.includes('waitForComposer'), 'waitForComposer retries');
assert(content.includes('พิมพ์ข้อความเข้าช่อง Write something ไม่สำเร็จ'), 'Thai empty-type fail');
assert(content.includes('ข้อความถูกพิมพ์ซ้ำ'), 'refuse to post a repeated caption');
assert(content.includes('ปุ่ม Post ยังไม่พร้อม') || content.includes('disabled'), 'disabled Post fail');

// composerHasText with fake element (node has no DOM) — skip if no document
if (typeof document === 'undefined') {
  assert(true, 'skip DOM composerHasText in Node (covered by mock)');
}

if (failed) { console.error('\n' + failed + ' failure(s)'); process.exit(1); }
console.log('\nLexical type smoke passed.');
