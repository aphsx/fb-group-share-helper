/**
 * Auto Post smoke (no DOM) — validates list/body/image helpers used by post mode.
 * Full offline UI demo: open test/mock-share.html → "รัน Auto Post + รูปจาก canvas"
 * Run: node test/auto-post-smoke.mjs
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
assert(manifest.version === '1.2.10', 'manifest version 1.2.10');

const groups = H.parseGroupList(
  'https://www.facebook.com/groups/333\n111\n#skip\nhttps://www.facebook.com/groups/333\n'
);
assert(groups.length === 2, 'unique group list for Auto Post select');
assert(groups[0].id === '333' && groups[1].id === '111', 'ids 333 then 111');

const body = 'สวัสดีจาก Auto Post';
assert(String(body).trim().length > 0, 'post body required (non-empty)');
assert(!String('   ').trim(), 'empty body rejected by trim check');

// Text OR images validation (mirrors popup/background)
function hasPostContent(postBody, images) {
  return !!(String(postBody || '').trim() || (images && images.length));
}
assert(hasPostContent('', [{ name: 'a.png' }]), 'images alone satisfy post content');
assert(hasPostContent('hi', []), 'text alone satisfies post content');
assert(!hasPostContent('', []), 'empty text+images rejected');

assert(typeof H.dataUrlToFile === 'function', 'dataUrlToFile helper exported');
assert(typeof H.assignFilesToInput === 'function', 'assignFilesToInput helper exported');
assert(typeof H.findImageFileInput === 'function', 'findImageFileInput helper exported');

// Tiny 1x1 PNG data URL → File (needs File/Blob in Node 18+)
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const file = H.dataUrlToFile(tinyPng, 'dot.png', 'image/png');
assert(!!file, 'dataUrlToFile builds File/Blob');
assert(file && file.size > 0, 'file has bytes');
assert(file && (file.type === 'image/png' || !file.type), 'file type image/png');

const content = readFileSync(join(root, 'content/content.js'), 'utf8');
assert(content.includes('strategyPost_newInGroup'), 'content has strategyPost_newInGroup');
assert(content.includes("action === 'postToGroup'"), 'content wires postToGroup');
assert(content.includes('เขียนอะไรสักหน่อย'), 'Thai composer opener');
assert(content.includes('attachImagesToComposer'), 'content attaches images');
assert(content.includes('loadImagesFromStorage'), 'content loads images from storage');
assert(content.includes('รูปภาพ/วิดีโอ'), 'Thai photo control label');

const bg = readFileSync(join(root, 'background/service-worker.js'), 'utf8');
assert(bg.includes("mode: 'share'"), 'background default mode share');
assert(bg.includes("action: 'postToGroup'"), 'background sends postToGroup');
assert(bg.includes('postBody'), 'background persists postBody');
assert(bg.includes('images'), 'background persists images');
assert(bg.includes('MAX_IMAGES'), 'background has MAX_IMAGES');
assert(bg.includes('hasPostContent'), 'background allows text-or-images');
assert(bg.includes('hasImages'), 'background signals hasImages to content');

const popup = readFileSync(join(root, 'popup/popup.html'), 'utf8');
assert(popup.includes('โพสต์ใหม่'), 'popup mode label');
assert(popup.includes('ข้อความโพสต์'), 'popup post body field');
assert(popup.includes('modePost'), 'popup mode toggle');
assert(popup.includes('imageInput'), 'popup image file input');
assert(popup.includes('imagePreview'), 'popup image preview');
assert(popup.includes('btnClearImages'), 'popup clear images button');
assert(popup.includes('btnAddGroup'), 'popup add target group button');
assert(popup.includes('targetGroups'), 'popup target group checkboxes');
assert(popup.includes('เพิ่มกลุ่มเป้าหมาย'), 'popup add-target label');

const popupJs = readFileSync(join(root, 'popup/popup.js'), 'utf8');
assert(popupJs.includes('MAX_IMAGES'), 'popup MAX_IMAGES');
assert(popupJs.includes('selectedImages'), 'popup selectedImages state');
assert(popupJs.includes('readFileAsDataUrl') || popupJs.includes('readAsDataURL') || popupJs.includes('readFileAsDataUrl'), 'popup reads files as data URL');
assert(popupJs.includes('fieldDirty'), 'popup keeps unsaved field edits');
assert(popupJs.includes('applyStoredField'), 'popup skips overwriting dirty fields');
assert(popupJs.includes('getCurrentGroup'), 'popup asks the tab for the open group');
assert(popupJs.includes('adoptOpenGroup'), 'popup adds the open group without a click');
assert(popupJs.includes('resolveGroupName'), 'popup looks up a group name from a link');

const mock = readFileSync(join(root, 'test/mock-share.html'), 'utf8');
assert(mock.includes('strategyPost_newInGroup_mock'), 'mock has Auto Post simulator');
assert(mock.includes('runAutoPost'), 'mock has Auto Post button');
assert(mock.includes('เขียนอะไรสักหน่อย'), 'mock Thai composer');
assert(mock.includes('fakeFileInput'), 'mock fake file input');
assert(mock.includes('runAutoPostWithGen'), 'mock canvas image Auto Post');
assert(mock.includes('dataUrlToFile'), 'mock uses dataUrlToFile');
assert(mock.includes('assignFilesToInput'), 'mock uses assignFilesToInput');


assert(typeof H.composerHasText === 'function', 'composerHasText helper');
assert(typeof H.findPostButton === 'function', 'findPostButton helper');
assert(typeof H.isPostButtonEnabled === 'function', 'isPostButtonEnabled helper');

assert(content.includes('typeIntoComposer'), 'content typeIntoComposer');
assert(content.includes('composerHasText'), 'content verifies composerHasText');
assert(content.includes('findPostButton'), 'content uses findPostButton');
assert(content.includes('พิมพ์ข้อความเข้าช่อง Write something ไม่สำเร็จ'), 'Thai fail message when type fails');
assert(!content.includes('ส่งคำสั่งโพสต์ใหม่บนกลุ่มแล้ว (best-effort)'), 'old unverified success message removed');

assert(mock.includes('runEmptyFail'), 'mock empty-composer fail test');
assert(mock.includes('runLexicalType'), 'mock lexical type test');
assert(mock.includes('fakeCreateDialog'), 'mock Create post dialog');
assert(mock.includes('composerHasText'), 'mock uses composerHasText');
assert(mock.includes('isPostButtonEnabled'), 'mock uses isPostButtonEnabled');


assert(typeof H.isAllowedPostButtonLabel === 'function', 'isAllowedPostButtonLabel');
assert(H.isAllowedPostButtonLabel('Share now') === false, 'Share now not a Post label');
assert(H.isAllowedPostButtonLabel('Post') === true, 'Post is allowed label');
assert(content.includes('dismissShareDialogIfOpen'), 'content dismisses Share');
assert(content.includes('openCreatePostComposer'), 'content openCreatePostComposer');
assert(content.includes('getCurrentGroup'), 'content answers getCurrentGroup');
assert(content.includes('v1.2.10'), 'content logs v1.2.10');

const kept = 'https://www.facebook.com/groups/111\nhttps://www.facebook.com/groups/222';
const added = H.addGroupUrlLine(kept, 'https://www.facebook.com/groups/333?ref=share');
assert(H.groupListHas(added, '333') && H.groupListHas(added, '111'), 'checkbox adds group url');
assert(H.addGroupUrlLine(added, '333') === added, 'checkbox does not duplicate');
const removed = H.removeGroupUrlLine(added, 'https://www.facebook.com/groups/333');
assert(!H.groupListHas(removed, '333') && H.groupListHas(removed, '222'), 'uncheck removes only that group');
assert(H.parseOpenGroupUrl('https://www.facebook.com/') === null, 'feed is not a group');
assert(H.parseOpenGroupUrl('https://www.facebook.com/groups/feed') === null, 'groups/feed is not a group');
assert(
  H.parseOpenGroupUrl('https://www.facebook.com/groups/1503331745017751').url ===
    'https://www.facebook.com/groups/1503331745017751',
  'open group url parsed'
);
assert(mock.includes('runShareNowTrap'), 'mock Share now trap');

const readme = readFileSync(join(root, 'README.md'), 'utf8');
assert(readme.includes('1.2.10'), 'README mentions 1.2.10');
assert(popup.includes('imageChosen'), 'popup shows chosen image names');
assert(readme.includes('รูป') || readme.includes('ภาพ'), 'README mentions photos');

if (failed) {
  console.error('\n' + failed + ' failure(s)');
  process.exit(1);
}
console.log('\nAuto Post smoke passed (open mock-share.html for DOM demo).');
