/**
 * Content script — best-effort Facebook share / auto-post automation.
 * Strategy A: Share → Share to a group → pick group
 * Strategy B: navigate to group, open composer, paste caption + post link
 * Strategy Post: navigate to group, open composer, type new body, attach images, Post
 *
 * Facebook DOM changes often. All selectors are resilient (aria/text) and wrapped
 * in try/catch. Never reads or stores passwords.
 *
 * v1.2.2: Never treat Share now as Post; close Share dialog; type only in Create post.
 * v1.2.3: Prefer the Create post dialog that contains the composer, not the title strip.
 * v1.2.4: Report the open group name/URL; do not wipe unsaved side-panel text.
 * v1.2.5: Type the caption once. Do not append it again when Lexical already has the text.
 * v1.2.6: Click Post when the button enables, wait until the dialog closes, attach photos from the panel.
 * v1.2.7: Insert the caption with one command. Lexical hides the text until the next frame, so extra paste/beforeinput calls were appending copies.
 * v1.2.8: Attach photos first (they remount the editor and wipe text), then type once and wait. Treat a cleared file input as success. Close the composer before the queue leaves the page.
 * v1.2.9: Count a post as done only after Facebook shows its own "โพสต์สำเร็จ" toast. Dialog close alone is not success.
 * v1.2.10: The success toast is often not in an alert node. A closed composer, or the new post on the feed ("Just now"), also counts.
 */
(function () {
  'use strict';

  // Avoid double-inject
  if (window.__FGSH_CONTENT__) return;
  window.__FGSH_CONTENT__ = true;

  const H = self.FbShareDomHelpers;
  if (!H) {
    console.warn('[FGSH] dom-helpers missing');
  }

  const sleep = H ? H.sleep : (ms) => new Promise((r) => setTimeout(r, ms));

  const COMPOSER_OPENERS = [
    'Write something',
    'เขียนอะไรบางอย่าง',
    'เขียนอะไรสักหน่อย',
    'Create a public post',
    'สร้างโพสต์สาธารณะ',
    'Create post',
    'สร้างโพสต์',
    "What's on your mind",
    'คุณกำลังคิดอะไรอยู่',
    'เขียนโพสต์',
    'Start a discussion',
    'เริ่มการสนทนา'
  ];

  const PHOTO_CONTROL_LABELS = [
    'Photo/video',
    'Photo / video',
    'Photo',
    'Add photo',
    'Add photos',
    'รูปภาพ/วิดีโอ',
    'รูปภาพ / วิดีโอ',
    'รูปภาพ',
    'เพิ่มรูปภาพ',
    'Photo/Video',
    'Photos/Videos'
  ];

  function getCreatePostDialog() {
    if (!H) return null;
    if (H.findCreatePostDialog) return H.findCreatePostDialog(document);
    const d = H.topmostDialog && H.topmostDialog(document);
    if (d && H.isCreatePostDialog && H.isCreatePostDialog(d)) return d;
    return null;
  }

  function getShareDialog() {
    if (!H) return null;
    if (H.findShareDialog) return H.findShareDialog(document);
    const d = H.topmostDialog && H.topmostDialog(document);
    if (d && H.isShareDialog && H.isShareDialog(d)) return d;
    return null;
  }

  /**
   * If Share dialog is open (wrong for Auto Post), close it.
   */
  async function dismissShareDialogIfOpen() {
    const share = getShareDialog();
    if (!share) return false;
    if (H.closeDialog) H.closeDialog(share);
    else {
      try {
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
        );
      } catch (_) {}
    }
    await sleep(600);
    return true;
  }

  /**
   * Open group Create post composer (Write something…), not Share.
   */
  async function openCreatePostComposer() {
    // Dismiss wrong Share dialog first
    await dismissShareDialogIfOpen();
    await sleep(200);

    let create = getCreatePostDialog();
    if (create) return create;

    const opener = H.findByText(COMPOSER_OPENERS, document);
    if (opener) {
      H.clickEl(opener);
      await sleep(1800);
    } else {
      await sleep(600);
    }

    // If Share opened instead, close and retry opener once
    if (getShareDialog() && !getCreatePostDialog()) {
      await dismissShareDialogIfOpen();
      await sleep(400);
      const opener2 = H.findByText(COMPOSER_OPENERS, document);
      if (opener2) {
        H.clickEl(opener2);
        await sleep(1600);
      }
    }

    create = getCreatePostDialog();
    if (create) return create;

    // Fallback: any non-share top dialog
    const top = H.topmostDialog && H.topmostDialog(document);
    if (top && !(H.isShareDialog && H.isShareDialog(top))) return top;
    return null;
  }

  async function waitForComposer(attempts, delayMs, dialogRoot) {
    const n = attempts || 5;
    const d = delayMs || 500;
    let composer = null;
    for (let i = 0; i < n; i++) {
      const scope = getCreatePostDialog() || dialogRoot || document;
      composer = H.findComposer(scope);
      if (composer) return composer;
      await sleep(d);
    }
    return null;
  }

  /**
   * Type into composer with retries / re-find. Prefer Create post dialog root.
   * Returns { ok, composer, message }.
   */
  async function typeIntoComposer(desiredText, dialogRoot) {
    const text = String(desiredText || '');
    if (!text.trim()) {
      return { ok: false, composer: null, message: 'ไม่มีข้อความที่จะพิมพ์' };
    }

    // Never type into Share dialog
    if (getShareDialog() && !getCreatePostDialog()) {
      await dismissShareDialogIfOpen();
    }

    let scope = getCreatePostDialog() || dialogRoot || null;
    let composer = await waitForComposer(5, 450, scope);
    if (!composer) {
      return {
        ok: false,
        composer: null,
        message: 'ไม่พบช่อง Write something / composer ใน Create post'
      };
    }

    const methods = ['command', 'beforeinput', 'paste'];
    for (let attempt = 0; attempt < methods.length; attempt++) {
      scope = getCreatePostDialog() || dialogRoot || scope;
      if (getShareDialog() && !getCreatePostDialog()) {
        return {
          ok: false,
          composer: null,
          message: 'เจอไดอะล็อก Share แทน Create post — ไม่พิมพ์'
        };
      }
      composer = H.findComposer(scope) || composer;
      const before = readComposerState(scope, text);
      composer = before.el || composer;
      if (before.state === 'exact') {
        return { ok: true, composer, message: 'พิมพ์ข้อความสำเร็จ' };
      }
      if (before.state === 'repeated') {
        return {
          ok: false,
          composer,
          message: 'ข้อความถูกพิมพ์ซ้ำในช่อง — ไม่กดโพสต์'
        };
      }
      if (before.state !== 'empty') break;
      if (H.insertComposerText) H.insertComposerText(composer, text, methods[attempt]);
      else H.setInputText(composer, text);
      await sleep(900);
      const after = readComposerState(scope, text);
      if (after.state === 'exact') {
        return { ok: true, composer: after.el || composer, message: 'พิมพ์ข้อความสำเร็จ' };
      }
      if (after.state === 'repeated') {
        return {
          ok: false,
          composer: after.el || composer,
          message: 'ข้อความถูกพิมพ์ซ้ำในช่อง — ไม่กดโพสต์'
        };
      }
    }

    const finalScope = getCreatePostDialog() || dialogRoot || document;
    const finalEl = H.findComposer(finalScope) || composer;
    if (H.composerTextState && H.composerTextState(finalEl, text) === 'exact') {
      return { ok: true, composer: finalEl, message: 'พิมพ์ข้อความสำเร็จ' };
    }
    if (H.composerTextState && H.composerTextState(finalEl, text) === 'repeated') {
      return {
        ok: false,
        composer: finalEl,
        message: 'ข้อความถูกพิมพ์ซ้ำในช่อง — ไม่กดโพสต์'
      };
    }
    return {
      ok: false,
      composer: finalEl,
      message: 'พิมพ์ข้อความเข้าช่อง Write something ไม่สำเร็จ'
    };
  }

  function readComposerState(scope, text) {
    const root = scope && scope.querySelectorAll ? scope : document;
    const els = [];
    const add = (el) => {
      if (el && els.indexOf(el) === -1) els.push(el);
    };
    try {
      add(H.findComposer(root));
    } catch (_) {}
    try {
      const nodes = root.querySelectorAll(
        '[data-lexical-editor="true"], [contenteditable="true"][role="textbox"]'
      );
      for (let i = 0; i < nodes.length; i++) add(nodes[i]);
    } catch (_) {}
    try {
      if (document.activeElement && document.activeElement.isContentEditable) add(document.activeElement);
    } catch (_) {}
    let repeated = null;
    let other = null;
    for (let i = 0; i < els.length; i++) {
      const state = H.composerTextState ? H.composerTextState(els[i], text) : '';
      if (state === 'exact') return { state: 'exact', el: els[i] };
      if (state === 'repeated' && !repeated) repeated = els[i];
      else if (state === 'other' && !other) other = els[i];
    }
    if (repeated) return { state: 'repeated', el: repeated };
    if (other) return { state: 'other', el: other };
    return { state: 'empty', el: els[0] || null };
  }

  function composingDialogOpen() {
    const d = getCreatePostDialog();
    if (!d || !d.getBoundingClientRect) return false;
    try {
      if (d.querySelector('[contenteditable="true"], textarea, [data-lexical-editor="true"]')) return true;
    } catch (_) {}
    let h = 0;
    try {
      h = d.getBoundingClientRect().height;
    } catch (_) {}
    // Title strip is short and has no editor. A short window must not look "already closed".
    return h > 280;
  }

  function pageHas(needle) {
    let blob = '';
    try {
      blob = H.normalizeText(document.body ? document.body.innerText : '');
    } catch (_) {}
    return blob.indexOf(needle) !== -1;
  }

  function publishToastState() {
    if (pageHas('โพสต์สำเร็จ') || pageHas('post published') || pageHas('your post is published')) {
      return { ok: true, text: 'โพสต์สำเร็จ' };
    }
    const nodes = document.querySelectorAll('[role="alert"], [role="status"], [aria-live]');
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (H.isVisible && !H.isVisible(n)) continue;
      const t = H.normalizeText(n.innerText || n.textContent || '');
      if (!t || t.length > 180) continue;
      if (t.indexOf('ไม่สำเร็จ') !== -1 || t.indexOf('could not') !== -1 || t.indexOf("couldn't") !== -1) {
        return { ok: false, text: t };
      }
      if (t === 'posted') return { ok: true, text: t };
    }
    return null;
  }

  function freshFeedHasCaption(text) {
    const want = H.normalizeText(text);
    if (!want) return false;
    const articles = document.querySelectorAll('[role="article"]');
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      if (a.closest && a.closest('[role="dialog"]')) continue;
      const t = H.normalizeText(a.innerText || '');
      if (t.indexOf(want) === -1) continue;
      if (t.indexOf('just now') !== -1 || t.indexOf('เมื่อสักครู่') !== -1) return true;
    }
    return false;
  }

  function hasVisibleImagePreview() {
    // Best-effort: attached image preview in dialog
    const dialog = H.topmostDialog ? H.topmostDialog(document) : null;
    const root = dialog || document;
    const imgs = root.querySelectorAll(
      'img[src^="blob:"], img[src^="data:"], div[aria-label*="Photo"], div[aria-label*="รูป"]'
    );
    for (let i = 0; i < imgs.length; i++) {
      if (H.isVisible(imgs[i])) return true;
    }
    const fileInput = H.findImageFileInput(root);
    if (fileInput && fileInput.files && fileInput.files.length > 0) return true;
    return false;
  }

  /**
   * Click Post only if enabled and content exists (text and/or images).
   * NEVER clicks Share now. Fails if only Share dialog is visible.
   */
  async function clickPostIfReady(opts) {
    const options = opts || {};
    const requireText = !!options.requireText;
    const allowImagesOnly = !!options.allowImagesOnly;

    if (getShareDialog() && !getCreatePostDialog()) {
      return {
        ok: false,
        message: 'เจอไดอะล็อก Share / Share now — ไม่ใช่ Create post จึงไม่กดโพสต์'
      };
    }

    const createDlg = getCreatePostDialog();
    const scope = createDlg || document;
    const composer = H.findComposer(scope);
    const hasText = composer && H.composerHasText(composer);
    const hasImages = allowImagesOnly && hasVisibleImagePreview();

    let postBtn = null;
    for (let i = 0; i < 8; i++) {
      postBtn = H.findPostButton(getCreatePostDialog() || scope);
      if (postBtn && H.isPostButtonEnabled(postBtn)) break;
      await sleep(350);
    }

    if (requireText && !hasText && !hasImages && !(postBtn && H.isPostButtonEnabled(postBtn))) {
      return {
        ok: false,
        message: 'พิมพ์ข้อความเข้าช่อง Write something ไม่สำเร็จ'
      };
    }

    if (!postBtn) postBtn = H.findPostButton(scope);
    if (!postBtn) {
      // Extra guard: if Share now exists, explain clearly
      const shareDlg = getShareDialog();
      if (shareDlg) {
        return {
          ok: false,
          message: 'เจอไดอะล็อก Share / Share now — ไม่ใช่ Create post จึงไม่กดโพสต์'
        };
      }
      return { ok: false, message: 'ไม่พบปุ่ม Post / โพสต์ ในไดอะล็อก Create post' };
    }

    // Belt-and-suspenders: refuse if label is share-like
    try {
      const lab = H.normalizeText(
        postBtn.getAttribute('aria-label') || postBtn.innerText || postBtn.textContent || ''
      );
      if (H.isAllowedPostButtonLabel && !H.isAllowedPostButtonLabel(lab)) {
        return {
          ok: false,
          message: 'ปุ่มที่พบไม่ใช่ Post (น่าจะเป็น Share) — ยกเลิก'
        };
      }
      if (lab.indexOf('share') !== -1 || lab.indexOf('แชร์') !== -1) {
        return {
          ok: false,
          message: 'ปุ่มที่พบเป็น Share / แชร์ — ไม่กด'
        };
      }
    } catch (_) {}

    if (!H.isPostButtonEnabled(postBtn)) {
      return {
        ok: false,
        message: 'ปุ่ม Post ยังไม่พร้อม (disabled) — ข้อความอาจยังไม่เข้า composer'
      };
    }

    const caption = String(options.caption || '');
    H.clickEl(postBtn);

    let closedStreak = 0;
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      const toast = publishToastState();
      if (toast && toast.ok) {
        return { ok: true, message: 'โพสต์แล้ว (Facebook ขึ้นว่าโพสต์สำเร็จ)' };
      }
      if (freshFeedHasCaption(caption)) {
        return { ok: true, message: 'โพสต์แล้ว (เห็นโพสต์บนฟีด เมื่อสักครู่)' };
      }
      if (getShareDialog() && !getCreatePostDialog()) {
        return {
          ok: false,
          message: 'หลังกดปุ่มแล้วขึ้นไดอะล็อก Share — โพสต์ไม่สำเร็จ'
        };
      }
      if (!composingDialogOpen()) {
        closedStreak += 1;
        if (closedStreak >= 2) {
          return { ok: true, message: 'โพสต์แล้ว (กล่อง Create post ปิด)' };
        }
      } else {
        closedStreak = 0;
      }
      if (toast && !toast.ok) {
        return { ok: false, message: 'Facebook แจ้งว่าโพสต์ไม่สำเร็จ' };
      }
    }

    if (pageHas("something's gone wrong")) {
      return {
        ok: false,
        message: 'Facebook ขึ้น Something\'s gone wrong ในกล่องโพสต์ — โพสต์ไม่สำเร็จ'
      };
    }

    return {
      ok: false,
      message: 'กด Post แล้วแต่ไม่เห็นข้อความโพสต์สำเร็จจาก Facebook — ไม่นับสำเร็จ'
    };
  }

  async function strategyA_shareFromPost(groupUrl, caption) {
    const shareBtn = H.findByText(['Share', 'แชร์', 'Send', 'ส่ง'], document);
    if (!shareBtn) {
      return { ok: false, message: 'A: ไม่พบปุ่ม Share บนหน้านี้' };
    }
    H.clickEl(shareBtn);
    await sleep(900);

    const toGroup = H.findByText(
      [
        'Share to a group',
        'Share in a group',
        'แชร์ไปยังกลุ่ม',
        'แชร์ในกลุ่ม',
        'Group',
        'กลุ่ม'
      ],
      document
    );
    if (!toGroup) {
      return { ok: false, message: 'A: ไม่พบเมนู Share to a group' };
    }
    H.clickEl(toGroup);
    await sleep(1200);

    const groupKey = extractSearchKey(groupUrl);
    const search =
      document.querySelector(
        'input[type="search"], input[placeholder*="Search"], input[placeholder*="ค้นหา"], input[aria-label*="Search"], input[aria-label*="ค้นหา"]'
      ) || H.findByText(['Search', 'ค้นหา'], document);

    if (search && search.tagName === 'INPUT') {
      H.setInputText(search, groupKey);
      await sleep(1100);
    } else if (search) {
      H.clickEl(search);
      await sleep(300);
      const inp = document.querySelector('input[type="search"], input[role="combobox"]');
      if (inp) {
        H.setInputText(inp, groupKey);
        await sleep(1100);
      }
    }

    let groupRow = H.findByText([groupKey], document);
    if (!groupRow && groupKey.length > 3) {
      groupRow = H.findByText([groupKey.slice(0, Math.min(12, groupKey.length))], document);
    }
    if (!groupRow) {
      return { ok: false, message: 'A: ไม่พบกลุ่มในรายการเลือก (' + groupKey + ')' };
    }
    H.clickEl(groupRow);
    await sleep(1000);

    if (caption && String(caption).trim()) {
      const typed = await typeIntoComposer(caption);
      if (!typed.ok) {
        return { ok: false, message: 'A: ' + typed.message };
      }
      await sleep(400);
    }

    // Strategy A share can post without caption — but if caption was requested, require it
    if (caption && String(caption).trim()) {
      const click = await clickPostIfReady({ requireText: true });
      if (!click.ok) return { ok: false, message: 'A: ' + click.message };
      return { ok: true, message: 'A: ' + click.message };
    }

    const postBtn = H.findPostButton(document);
    if (!postBtn) {
      return { ok: false, message: 'A: ไม่พบปุ่ม Post ในไดอะล็อก' };
    }
    if (!H.isPostButtonEnabled(postBtn)) {
      return {
        ok: false,
        message: 'A: ปุ่ม Post ยัง disabled — อาจยังไม่ได้เลือกกลุ่มหรือใส่เนื้อหา'
      };
    }
    H.clickEl(postBtn);
    await sleep(1500);
    return { ok: true, message: 'A: กด Post แล้ว (best-effort)' };
  }

  function extractSearchKey(groupUrl) {
    try {
      const u = new URL(groupUrl);
      const parts = u.pathname.split('/').filter(Boolean);
      const gi = parts.indexOf('groups');
      if (gi >= 0 && parts[gi + 1]) return decodeURIComponent(parts[gi + 1]);
    } catch (_) {}
    return String(groupUrl || '').replace(/^.*\//, '');
  }

  async function strategyB_groupComposer(groupUrl, caption, postUrl) {
    if (!location.href.startsWith(groupUrl.split('?')[0])) {
      try {
        sessionStorage.setItem(
          '__fgsh_pending',
          JSON.stringify({
            kind: 'shareB',
            groupUrl,
            caption: caption || '',
            postUrl: postUrl || '',
            at: Date.now()
          })
        );
      } catch (_) {}
      location.assign(groupUrl);
      return { ok: false, message: 'B: กำลังไปหน้ากลุ่ม — จะลองโพสต์หลังโหลด (retry)', retry: true };
    }

    return await tryComposeOnGroup(caption, postUrl);
  }

  async function tryComposeOnGroup(caption, postUrl) {
    await sleep(1200);

    await openCreatePostComposer();

    const body = [caption || '', postUrl || ''].filter(Boolean).join('\n\n');
    if (!String(body).trim()) {
      return { ok: false, message: 'B: ไม่มีข้อความ/ลิงก์ที่จะโพสต์' };
    }

    const typed = await typeIntoComposer(body, getCreatePostDialog());
    if (!typed.ok) {
      return { ok: false, message: 'B: ' + typed.message };
    }

    await sleep(500);
    const click = await clickPostIfReady({ requireText: true });
    if (!click.ok) {
      return { ok: false, message: 'B: ' + click.message };
    }
    return { ok: true, message: 'B: ' + click.message };
  }

  /**
   * Load images from chrome.storage.local (survives group navigations).
   */
  async function loadImagesFromStorage() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(['images'], (data) => {
          const imgs = (data && data.images) || [];
          resolve(Array.isArray(imgs) ? imgs : []);
        });
      } catch (_) {
        resolve([]);
      }
    });
  }

  async function attachImagesToComposer(images) {
    if (!images || !images.length) {
      return { ok: true, attached: 0, message: '' };
    }

    const files = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      if (!img || !img.dataUrl) continue;
      const f = H.dataUrlToFile(img.dataUrl, img.name || 'image' + (i + 1) + '.png', img.type);
      if (f) files.push(f);
    }
    if (!files.length) {
      return { ok: false, attached: 0, message: 'Post: สร้างไฟล์รูปจาก storage ไม่ได้' };
    }

    const dialog = getCreatePostDialog();
    const searchRoot = dialog || document;
    const before = new Set(document.querySelectorAll('input[type="file"]'));
    let fileInput = dialog ? H.findImageFileInput(dialog) : null;

    const photoBtn =
      H.findByText(PHOTO_CONTROL_LABELS, searchRoot) ||
      (dialog ? null : H.findByText(PHOTO_CONTROL_LABELS, document));
    if (!fileInput && photoBtn) {
      H.clickEl(photoBtn);
      for (let w = 0; w < 6 && !fileInput; w++) {
        await sleep(400);
        const inputs = document.querySelectorAll('input[type="file"]');
        for (let i = 0; i < inputs.length; i++) {
          if (!before.has(inputs[i])) fileInput = inputs[i];
        }
        if (!fileInput && dialog) fileInput = H.findImageFileInput(dialog);
      }
    }

    if (!fileInput) {
      const any = dialog.querySelector ? dialog.querySelector('input[type="file"]') : null;
      if (any) fileInput = any;
    }

    if (!fileInput) {
      return {
        ok: false,
        attached: 0,
        message: 'Post: ไม่พบ input แนบรูป (Photo/Video)'
      };
    }

    const assigned = H.assignFilesToInput(fileInput, files);
    let preview = false;
    for (let w = 0; w < 8; w++) {
      await sleep(400);
      if (dialogShowsPhotos(getCreatePostDialog() || dialog)) {
        preview = true;
        break;
      }
    }
    if (!assigned && !preview) {
      return { ok: false, attached: 0, message: 'Post: ใส่ไฟล์ลง input ไม่สำเร็จ' };
    }

    return {
      ok: true,
      attached: files.length,
      message: 'แนบรูป ' + files.length + ' ใบ'
    };
  }

  function dialogShowsPhotos(dialog) {
    if (!dialog || !dialog.querySelectorAll) return false;
    try {
      const edit = H.findByText(['Edit all', 'แก้ไขทั้งหมด', 'Edit photo', 'แก้ไขรูป'], dialog);
      if (edit) return true;
    } catch (_) {}
    const imgs = dialog.querySelectorAll('img');
    for (let i = 0; i < imgs.length; i++) {
      const r = imgs[i].getBoundingClientRect();
      if (r.width >= 36 && r.height >= 36) return true;
    }
    return false;
  }

  async function abandonOpenComposer() {
    const dlg = getCreatePostDialog();
    if (!dlg) return;
    try {
      if (H.closeDialog) H.closeDialog(dlg);
    } catch (_) {}
    await sleep(500);
    try {
      const discard = H.findByText(
        ['Discard', 'Discard post', 'ทิ้งโพสต์', 'ทิ้ง', 'ไม่บันทึก'],
        document
      );
      if (discard) H.clickEl(discard);
    } catch (_) {}
    await sleep(400);
  }

  async function strategyPost_newInGroup(groupUrl, body, options) {
    const text = String(body || '').trim();
    const opts = options || {};
    let images = opts.images;
    if (!images || !images.length) {
      images = await loadImagesFromStorage();
    }
    const hasImages = !!(images && images.length);

    if (!text && !hasImages) {
      return { ok: false, message: 'Post: ต้องมีข้อความหรือรูปอย่างน้อยอย่างใดอย่างหนึ่ง' };
    }

    const base = (groupUrl || '').split('?')[0].replace(/\/?$/, '');
    const onGroup =
      location.href.indexOf('/groups/') !== -1 &&
      (!groupUrl ||
        location.href.indexOf(extractSearchKey(groupUrl)) !== -1 ||
        (base && location.href.indexOf(base) === 0));

    if (groupUrl && !onGroup) {
      try {
        sessionStorage.setItem(
          '__fgsh_pending',
          JSON.stringify({
            kind: 'post',
            groupUrl,
            body: text,
            hasImages: hasImages,
            at: Date.now()
          })
        );
      } catch (_) {}
      location.assign(groupUrl);
      return {
        ok: false,
        message: 'Post: กำลังไปหน้ากลุ่ม — จะลองโพสต์หลังโหลด (retry)',
        retry: true
      };
    }

    return await tryPostNewBody(text, images);
  }

  async function tryPostNewBody(text, images) {
    await sleep(1200);

    const createDlg = await openCreatePostComposer();
    if (getShareDialog() && !getCreatePostDialog()) {
      return {
        ok: false,
        message: 'Post: เปิดได้แค่ไดอะล็อก Share — ไม่โพสต์ (ปิด Share แล้วลองใหม่)'
      };
    }

    const wantText = String(text || '').trim();
    let attachNote = '';
    let attachedOk = false;
    const dialogRoot = getCreatePostDialog() || createDlg || null;

    if (images && images.length) {
      const att = await attachImagesToComposer(images);
      if (att.ok && att.attached) {
        attachedOk = true;
        attachNote += ' · ' + att.message;
        await sleep(600);
      } else if (!wantText) {
        await abandonOpenComposer();
        return { ok: false, message: att.message };
      } else {
        attachNote += ' (แนบรูปไม่สำเร็จ: ' + att.message + ')';
      }
    }

    if (wantText) {
      const typed = await typeIntoComposer(wantText, getCreatePostDialog() || dialogRoot);
      if (!typed.ok) {
        await abandonOpenComposer();
        return { ok: false, message: 'Post: ' + (typed.message || 'พิมพ์ไม่สำเร็จ') };
      }
    } else {
      const composer = await waitForComposer(5, 400, dialogRoot);
      if (!composer && !attachedOk) {
        await abandonOpenComposer();
        return { ok: false, message: 'Post: ไม่พบช่องเขียนโพสต์บนกลุ่ม' };
      }
    }

    const scope = getCreatePostDialog() || document;
    const composer = H.findComposer(scope);
    const hasText = composer && H.composerHasText(composer);
    if (wantText && H.composerTextState && H.composerTextState(composer, wantText) === 'repeated') {
      await abandonOpenComposer();
      return { ok: false, message: 'Post: ข้อความถูกพิมพ์ซ้ำในช่อง — ไม่กดโพสต์' };
    }
    if (!hasText && !attachedOk) {
      await abandonOpenComposer();
      return {
        ok: false,
        message: 'Post: พิมพ์ข้อความเข้าช่อง Write something ไม่สำเร็จ'
      };
    }

    const click = await clickPostIfReady({
      requireText: !!wantText,
      allowImagesOnly: attachedOk,
      caption: wantText
    });
    if (!click.ok) {
      await abandonOpenComposer();
      return { ok: false, message: 'Post: ' + click.message };
    }
    return { ok: true, message: 'Post: ' + click.message + attachNote };
  }

  async function shareToGroup(payload) {
    const groupUrl = payload.groupUrl;
    const caption = payload.caption || '';
    const postUrl = payload.postUrl || location.href;

    if (!groupUrl) {
      return { ok: false, message: 'ไม่มี groupUrl' };
    }

    const onPostish =
      /\/posts\//i.test(location.href) ||
      /\/permalink\//i.test(location.href) ||
      /story_fbid=/i.test(location.href) ||
      !!H.findByText(['Share', 'แชร์'], document);

    if (onPostish && !location.href.includes('/groups/')) {
      try {
        const a = await strategyA_shareFromPost(groupUrl, caption);
        if (a.ok) return a;
        console.info('[FGSH] Strategy A failed:', a.message);
      } catch (e) {
        console.warn('[FGSH] Strategy A error', e);
      }
    }

    try {
      return await strategyB_groupComposer(groupUrl, caption, postUrl);
    } catch (e) {
      return { ok: false, message: 'B error: ' + String(e.message || e) };
    }
  }

  // Resume after navigation (Strategy B share or Auto Post)
  (async function resumePending() {
    let pending = null;
    try {
      const raw = sessionStorage.getItem('__fgsh_pending');
      if (!raw) return;
      pending = JSON.parse(raw);
      sessionStorage.removeItem('__fgsh_pending');
    } catch (_) {
      return;
    }
    if (!pending || !pending.groupUrl) return;
    if (Date.now() - (pending.at || 0) > 120000) return;
    const onGroup =
      location.href.indexOf('/groups/') !== -1 &&
      location.href.indexOf(extractSearchKey(pending.groupUrl)) !== -1;
    if (!onGroup) return;

    await sleep(1500);
    let result;
    if (pending.kind === 'post') {
      const images = await loadImagesFromStorage();
      result = await tryPostNewBody(pending.body || '', images);
    } else {
      result = await tryComposeOnGroup(pending.caption, pending.postUrl);
    }
    try {
      chrome.runtime.sendMessage({
        type: 'CONTENT_RESUME_RESULT',
        groupUrl: pending.groupUrl,
        result
      });
    } catch (_) {}
  })();

  function readOpenGroup() {
    const href = location.href || '';
    const parsed = H && H.parseOpenGroupUrl ? H.parseOpenGroupUrl(href) : null;
    if (!parsed) return { ok: true, onGroup: false, name: '', url: '' };
    let name = '';
    try {
      const title = document.title || '';
      if (/\|\s*facebook\s*$/i.test(title)) name = title.split('|')[0].trim();
    } catch (_) {}
    if (!name) {
      try {
        const hs = document.querySelectorAll('h1');
        for (let i = 0; i < hs.length; i++) {
          const h = hs[i];
          if (h.closest && h.closest('[role="dialog"], [aria-modal="true"]')) continue;
          const t = (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim();
          if (t && t.length < 180) {
            name = t;
            break;
          }
        }
      } catch (_) {}
    }
    if (/^(facebook|log in|login)$/i.test(name)) name = '';
    return { ok: true, onGroup: true, name: name, url: parsed.url };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.action) return;

    if (msg.action === 'getCurrentGroup') {
      try {
        sendResponse(readOpenGroup());
      } catch (e) {
        sendResponse({ ok: false, onGroup: false, name: '', url: '', message: String(e.message || e) });
      }
      return false;
    }

    if (msg.action === 'shareToGroup') {
      shareToGroup(msg)
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, message: String(e.message || e) }));
      return true;
    }

    if (msg.action === 'postToGroup') {
      strategyPost_newInGroup(msg.groupUrl, msg.body, {
        images: msg.images,
        hasImages: msg.hasImages
      })
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ ok: false, message: String(e.message || e) }));
      return true;
    }
  });

  console.log('[FGSH] content script ready on', location.hostname, '(v1.2.10)');
})();
