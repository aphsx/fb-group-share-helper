/**
 * Ensures Share now is NEVER chosen as Post (false-success regression).
 * Run: node test/post-button-smoke.mjs
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
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
assert(manifest.version === '1.2.10', 'manifest 1.2.10');

assert(typeof H.isAllowedPostButtonLabel === 'function', 'isAllowedPostButtonLabel exported');
assert(typeof H.isShareDialog === 'function', 'isShareDialog exported');
assert(typeof H.isCreatePostDialog === 'function', 'isCreatePostDialog exported');
assert(typeof H.closeDialog === 'function', 'closeDialog exported');

// --- Pure label matrix (no DOM) ---
assert(H.isAllowedPostButtonLabel('Post') === true, 'Post allowed');
assert(H.isAllowedPostButtonLabel('โพสต์') === true, 'โพสต์ allowed');
assert(H.isAllowedPostButtonLabel('เผยแพร่') === true, 'เผยแพร่ allowed');
assert(H.isAllowedPostButtonLabel('Publish') === true, 'Publish allowed');

assert(H.isAllowedPostButtonLabel('Share now') === false, 'Share now REJECTED');
assert(H.isAllowedPostButtonLabel('Share') === false, 'Share REJECTED');
assert(H.isAllowedPostButtonLabel('แชร์') === false, 'แชร์ REJECTED');
assert(H.isAllowedPostButtonLabel('แชร์เลย') === false, 'แชร์เลย REJECTED');
assert(H.isAllowedPostButtonLabel('Send in Messenger') === false, 'Send in Messenger REJECTED');
assert(H.isAllowedPostButtonLabel('Copy link') === false, 'Copy link REJECTED');
assert(H.isAllowedPostButtonLabel('Say something about this...') === false, 'Say something REJECTED');
assert(H.isAllowedPostButtonLabel('Post audience') === false, 'Post audience REJECTED');

// Critical regression: old bug was label.indexOf('share')===0 matching "share now"
assert(
  !('share now'.indexOf('share') === 0 && H.isAllowedPostButtonLabel('Share now')),
  'Share now must not pass even though it starts with share'
);

const helpersSrc = readFileSync(join(root, 'lib/dom-helpers.js'), 'utf8');
assert(!/labels = \[[^\]]*['"]share['"]/.test(helpersSrc), 'findPostButton labels array has no share string');
assert(helpersSrc.includes('isAllowedPostButtonLabel'), 'helpers use isAllowedPostButtonLabel');
assert(helpersSrc.includes('isShareDialog'), 'helpers define isShareDialog');
assert(helpersSrc.includes('dialogHasComposerCandidate'), 'helpers prefer the dialog that contains the composer');
assert(helpersSrc.includes('clientX'), 'clicks use the button center, not a fixed screen point');
assert(helpersSrc.includes('intersectsViewport'), 'clicks prefer the button that is on screen');
assert(helpersSrc.includes('Share now'), 'helpers mention Share now exclusion');

const content = readFileSync(join(root, 'content/content.js'), 'utf8');
assert(content.includes('dismissShareDialogIfOpen'), 'content dismisses Share dialog');
assert(content.includes('openCreatePostComposer'), 'content opens Create post');
assert(content.includes('เจอไดอะล็อก Share'), 'Thai Share-dialog fail message');
assert(content.includes('v1.2.10'), 'content logs v1.2.10');
assert(!content.includes('postBtn.click()'), 'Post is clicked once, at the button');
assert(content.includes('r.width >= 36'), 'photo preview check does not require a large thumbnail');
assert(
  content.includes('ไม่นับสำเร็จ') || content.includes('ยืนยันไม่ได้ว่าโพสต์ขึ้น'),
  'no false success on ambiguous click'
);

const mock = readFileSync(join(root, 'test/mock-share.html'), 'utf8');
assert(mock.includes('Share now') || mock.includes('runShareNowTrap'), 'mock has Share now trap test');

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nPost-button smoke passed (Share now cannot be Post).');
