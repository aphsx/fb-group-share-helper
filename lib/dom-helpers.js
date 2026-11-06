/**
 * Pure DOM helpers for best-effort Facebook UI interaction.
 * No credentials. Selectors prefer aria-label / role / text content
 * because Facebook's class names change often.
 * Usable from content scripts and from the offline mock test page.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.FbShareDomHelpers = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function normalizeText(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Find elements that look clickable and whose accessible name / text
   * contains any of the given needles (case-insensitive).
   */
  function findByText(needles, root) {
    root = root || document;
    var list = Array.isArray(needles) ? needles : [needles];
    var norms = list.map(normalizeText).filter(Boolean);
    if (!norms.length) return null;

    var candidates = root.querySelectorAll(
      'button, a, div[role="button"], span[role="button"], [aria-label], [role="menuitem"], [role="option"], [role="listitem"]'
    );
    var matches = [];

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isVisible(el)) continue;
      var label = normalizeText(
        el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.innerText ||
          el.textContent
      );
      for (var j = 0; j < norms.length; j++) {
        if (label.indexOf(norms[j]) !== -1) {
          matches.push(el);
          break;
        }
      }
    }
    return preferOnScreen(matches);
  }

  function elementRect(el) {
    try {
      return el.getBoundingClientRect();
    } catch (_) {
      return null;
    }
  }

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = elementRect(el);
    if (!r || r.width < 2 || r.height < 2) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0')) {
      return false;
    }
    return true;
  }

  /**
   * On-screen in CSS pixels. A second layout (narrow window, side panel, scaling)
   * often keeps an off-screen duplicate of the same button; prefer the one in view.
   */
  function intersectsViewport(el) {
    var r = elementRect(el);
    if (!r || r.width < 2 || r.height < 2) return false;
    var vw = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 0;
    var vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 0;
    if (!vw || !vh) return true;
    return r.right > 1 && r.bottom > 1 && r.left < vw - 1 && r.top < vh - 1;
  }

  function preferOnScreen(matches) {
    if (!matches || !matches.length) return null;
    for (var i = 0; i < matches.length; i++) {
      if (intersectsViewport(matches[i])) return matches[i];
    }
    return matches[0];
  }

  function revealForClick(el) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) {}
    var parent = el.parentElement;
    var hops = 0;
    while (parent && hops < 8) {
      var st = null;
      try {
        st = window.getComputedStyle(parent);
      } catch (_) {}
      var oy = st && (st.overflowY === 'auto' || st.overflowY === 'scroll');
      var ox = st && (st.overflowX === 'auto' || st.overflowX === 'scroll');
      if (oy || ox) {
        var pr = elementRect(parent);
        var er = elementRect(el);
        if (pr && er) {
          if (oy && er.top < pr.top) parent.scrollTop -= pr.top - er.top + 8;
          else if (oy && er.bottom > pr.bottom) parent.scrollTop += er.bottom - pr.bottom + 8;
          if (ox && er.left < pr.left) parent.scrollLeft -= pr.left - er.left + 8;
          else if (ox && er.right > pr.right) parent.scrollLeft += er.right - pr.right + 8;
        }
      }
      parent = parent.parentElement;
      hops++;
    }
  }

  /** Visible center of the control, so the hit does not stay at (0, 0) when the window moves. */
  function clickPoint(el) {
    var r = elementRect(el);
    var vw = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 0;
    var vh = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 0;
    if (!r) return { x: 1, y: 1 };
    var left = Math.max(r.left, 0);
    var right = Math.min(r.right, vw || r.right);
    var top = Math.max(r.top, 0);
    var bottom = Math.min(r.bottom, vh || r.bottom);
    if (right - left >= 2 && bottom - top >= 2) {
      return { x: left + (right - left) / 2, y: top + (bottom - top) / 2 };
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function clickEl(el) {
    if (!el) return false;
    revealForClick(el);
    try {
      el.focus();
    } catch (_) {}
    var p = clickPoint(el);
    var common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: p.x,
      clientY: p.y,
      screenX: p.x,
      screenY: p.y,
      button: 0,
      buttons: 1
    };
    try {
      if (typeof PointerEvent === 'function') {
        el.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: p.x,
            clientY: p.y,
            screenX: p.x,
            screenY: p.y,
            button: 0,
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
          })
        );
        el.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: p.x,
            clientY: p.y,
            screenX: p.x,
            screenY: p.y,
            button: 0,
            buttons: 0,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
          })
        );
      }
    } catch (_) {}
    try {
      el.dispatchEvent(new MouseEvent('mousedown', common));
      el.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: p.x,
          clientY: p.y,
          screenX: p.x,
          screenY: p.y,
          button: 0,
          buttons: 0
        })
      );
      el.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: p.x,
          clientY: p.y,
          screenX: p.x,
          screenY: p.y,
          button: 0,
          buttons: 0
        })
      );
    } catch (_) {
      try {
        el.click();
        return true;
      } catch (e2) {
        return false;
      }
    }
    return true;
  }

  var COMPOSER_PLACEHOLDER_NEEDLES = [
    'write something',
    'เขียนอะไร',
    "what's on your mind",
    'คุณกำลังคิดอะไร',
    'สร้างโพสต์',
    'create a public post',
    'create post',
    'เขียนโพสต์',
    'start a discussion'
  ];

  function composerLabelText(el) {
    if (!el) return '';
    return normalizeText(
      el.getAttribute('aria-placeholder') ||
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('data-placeholder') ||
        ''
    );
  }

  function looksLikeComposer(el) {
    if (!el) return false;
    if (isInsideCommentBox(el)) return false;
    var label = composerLabelText(el);
    if (!label) {
      // Lexical often puts placeholder on a sibling / parent
      var parent = el.parentElement;
      if (parent) {
        label = composerLabelText(parent);
        if (!label) {
          var ph = parent.querySelector('[aria-placeholder], [data-placeholder], [aria-label]');
          if (ph) label = composerLabelText(ph);
        }
      }
    }
    // Reject comment / reply placeholders
    if (label) {
      var commentNeedles = [
        'comment',
        'write a comment',
        'write a reply',
        'แสดงความคิดเห็น',
        'เขียนความคิดเห็น',
        'ตอบกลับ',
        'say something about this'
      ];
      for (var c = 0; c < commentNeedles.length; c++) {
        if (label.indexOf(commentNeedles[c]) !== -1) return false;
      }
    }
    if (!label) {
      // visible textbox — accept only if inside Create post dialog or no dialog
      var d = el.closest ? el.closest('[role="dialog"], [aria-modal="true"]') : null;
      if (d && isShareDialog(d)) return false;
      return true;
    }
    for (var i = 0; i < COMPOSER_PLACEHOLDER_NEEDLES.length; i++) {
      if (label.indexOf(COMPOSER_PLACEHOLDER_NEEDLES[i]) !== -1) return true;
    }
    // Also accept empty/generic textbox role inside Create post dialog
    if (el.getAttribute('role') === 'textbox' || el.isContentEditable) {
      var d2 = el.closest ? el.closest('[role="dialog"], [aria-modal="true"]') : null;
      if (d2 && isShareDialog(d2)) return false;
      return true;
    }
    return false;
  }

  function isInsideCommentBox(el) {
    if (!el || !el.closest) return false;
    // Create post composer often sits in a form whose page text also mentions comments.
    var dlg = el.closest('[role="dialog"], [aria-modal="true"]');
    if (dlg && isCreatePostDialog(dlg)) return false;
    var form = el.closest('form');
    if (!form) return false;
    var blob = normalizeText(
      (form.getAttribute('aria-label') || '') +
        ' ' +
        (form.innerText || form.textContent || '').slice(0, 200)
    );
    if (
      blob.indexOf('comment') !== -1 ||
      blob.indexOf('แสดงความคิดเห็น') !== -1 ||
      blob.indexOf('เขียนความคิดเห็น') !== -1
    ) {
      return true;
    }
    return false;
  }

  function dialogTitleText(dialog) {
    if (!dialog) return '';
    var parts = [];
    try {
      parts.push(dialog.getAttribute('aria-label') || '');
      parts.push(dialog.getAttribute('aria-labelledby') || '');
    } catch (_) {}
    try {
      var h = dialog.querySelector('h1, h2, h3, [role="heading"]');
      if (h) parts.push(h.innerText || h.textContent || '');
    } catch (_) {}
    // labelledby id resolution
    try {
      var lid = dialog.getAttribute('aria-labelledby');
      if (lid) {
        var ids = String(lid).split(/\s+/);
        for (var i = 0; i < ids.length; i++) {
          var node = document.getElementById(ids[i]);
          if (node) parts.push(node.innerText || node.textContent || '');
        }
      }
    } catch (_) {}
    return normalizeText(parts.join(' '));
  }

  /**
   * Share / แชร์ dialog (wrong for Auto Post — includes "Share now").
   */
  function isShareDialog(dialog) {
    if (!dialog) return false;
    var t = dialogTitleText(dialog);
    if (!t) {
      // Fallback: visible Share now button + Say something about this
      var hasShareNow = !!findByExactishLabels(
        dialog,
        ['share now', 'แชร์เลย', 'แชร์ทันที'],
        true
      );
      var hasSay = false;
      try {
        var blob = normalizeText(dialog.innerText || dialog.textContent || '').slice(0, 500);
        hasSay =
          blob.indexOf('say something about this') !== -1 ||
          blob.indexOf('พูดอะไรเกี่ยวกับสิ่งนี้') !== -1;
      } catch (_) {}
      return hasShareNow && hasSay;
    }
    // Title is Share / แชร์ but not Create post
    if (t.indexOf('create post') !== -1 || t.indexOf('สร้างโพสต์') !== -1) return false;
    if (t === 'share' || t === 'แชร์') return true;
    if (t.indexOf('share') === 0 || t.indexOf('แชร์') === 0) return true;
    if (t.indexOf('share now') !== -1) return true;
    return false;
  }

  /**
   * Create post / สร้างโพสต์ dialog (correct for Auto Post).
   */
  function isCreatePostDialog(dialog) {
    if (!dialog) return false;
    var t = dialogTitleText(dialog);
    if (
      t.indexOf('create post') !== -1 ||
      t.indexOf('สร้างโพสต์') !== -1 ||
      t.indexOf('create a public post') !== -1
    ) {
      return true;
    }
    // Composer placeholder inside dialog
    try {
      var ph = dialog.querySelector(
        '[aria-placeholder], [aria-label], [data-placeholder], [role="textbox"]'
      );
      if (ph) {
        var lab = composerLabelText(ph);
        for (var i = 0; i < COMPOSER_PLACEHOLDER_NEEDLES.length; i++) {
          if (lab.indexOf(COMPOSER_PLACEHOLDER_NEEDLES[i]) !== -1) return true;
        }
      }
    } catch (_) {}
    return false;
  }

  function findByExactishLabels(root, labels, asButton) {
    root = root || document;
    var norms = (labels || []).map(normalizeText).filter(Boolean);
    var sel = asButton
      ? 'button, div[role="button"], span[role="button"], [aria-label], a[role="button"]'
      : 'button, a, div[role="button"], span[role="button"], [aria-label], [role="menuitem"]';
    var candidates = root.querySelectorAll(sel);
    var matches = [];
    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];
      if (!isVisible(el)) continue;
      var label = normalizeText(
        el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent
      );
      for (var j = 0; j < norms.length; j++) {
        if (label === norms[j] || label.indexOf(norms[j]) === 0) {
          matches.push(el);
          break;
        }
      }
    }
    return preferOnScreen(matches);
  }

  function topmostDialog(root) {
    root = root || document;
    var dialogs = root.querySelectorAll('[role="dialog"], [aria-modal="true"]');
    var best = null;
    var bestZ = -1;
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (!isVisible(d)) continue;
      var z = 0;
      try {
        var st = window.getComputedStyle(d);
        z = parseInt(st && st.zIndex, 10) || 0;
      } catch (_) {}
      // Prefer later (usually topmost) when z equal
      if (!best || z >= bestZ) {
        best = d;
        bestZ = z;
      }
    }
    return best;
  }

  /**
   * Find the post composer (Lexical contenteditable). Prefer Create post dialog.
   * Pass a dialog element as root to scope typing to that dialog only.
   */
  function findComposer(root) {
    root = root || document;
    var scopes = [];
    // If caller passed a dialog element, use it directly
    var rootIsDialog = false;
    try {
      rootIsDialog =
        root &&
        root !== document &&
        root.getAttribute &&
        (root.getAttribute('role') === 'dialog' || root.getAttribute('aria-modal') === 'true');
    } catch (_) {}

    if (rootIsDialog) scopes.push(root);
    // Facebook nests a short role=dialog title strip (aria-label "Create post", ~60px,
    // no editor) inside the real modal. Always prefer the dialog that holds the composer.
    var createDlg = findCreatePostDialog(rootIsDialog ? document : root);
    if (createDlg && scopes.indexOf(createDlg) === -1) scopes.push(createDlg);
    if (!rootIsDialog) {
      var dialog = topmostDialog(root);
      if (dialog && scopes.indexOf(dialog) === -1 && !isShareDialog(dialog)) scopes.push(dialog);
    }
    if (scopes.indexOf(root) === -1) scopes.push(root);
    if (rootIsDialog && scopes.indexOf(document) === -1) scopes.push(document);

    var selectors = [
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="plaintext-only"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[role="textbox"][contenteditable="plaintext-only"]',
      '[contenteditable="true"][aria-placeholder]',
      '[contenteditable="true"][aria-label]',
      '[data-lexical-editor="true"]',
      'div[role="textbox"]',
      'textarea',
      'div[aria-label*="Write"]',
      'div[aria-label*="เขียน"]',
      'div[aria-placeholder*="Write"]',
      'div[aria-placeholder*="เขียน"]'
    ];

    for (var s = 0; s < scopes.length; s++) {
      var scope = scopes[s];
      if (!scope || !scope.querySelectorAll) continue;
      for (var i = 0; i < selectors.length; i++) {
        var nodes = scope.querySelectorAll(selectors[i]);
        for (var j = 0; j < nodes.length; j++) {
          var el = nodes[j];
          if (!isVisible(el)) continue;
          if (!looksLikeComposer(el)) continue;
          return el;
        }
      }
    }
    return null;
  }

  function dialogArea(dialog) {
    try {
      var r = dialog.getBoundingClientRect();
      return Math.max(0, r.width) * Math.max(0, r.height);
    } catch (_) {
      return 0;
    }
  }

  /**
   * True when this dialog actually contains the Write something editor.
   * Facebook's title strip is also role=dialog / aria-label "Create post" but has no editor.
   */
  function dialogHasComposerCandidate(dialog) {
    if (!dialog || !dialog.querySelectorAll) return false;
    var nodes;
    try {
      nodes = dialog.querySelectorAll(
        '[contenteditable="true"], [contenteditable="plaintext-only"], textarea, [data-lexical-editor="true"], [role="textbox"]'
      );
    } catch (_) {
      return false;
    }
    for (var i = 0; i < nodes.length; i++) {
      if (!isVisible(nodes[i])) continue;
      if (looksLikeComposer(nodes[i])) return true;
    }
    return false;
  }

  function findCreatePostDialog(root) {
    root = root || document;
    var dialogs = root.querySelectorAll
      ? root.querySelectorAll('[role="dialog"], [aria-modal="true"]')
      : [];
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (!isVisible(d)) continue;
      if (!isCreatePostDialog(d)) continue;
      var score = dialogArea(d);
      if (d.getAttribute && d.getAttribute('aria-modal') === 'true') score += 5000;
      if (dialogHasComposerCandidate(d)) score += 1000000;
      if (score > bestScore) {
        best = d;
        bestScore = score;
      }
    }
    return best;
  }

  function findShareDialog(root) {
    root = root || document;
    var dialogs = root.querySelectorAll
      ? root.querySelectorAll('[role="dialog"], [aria-modal="true"]')
      : [];
    for (var i = dialogs.length - 1; i >= 0; i--) {
      var d = dialogs[i];
      if (!isVisible(d)) continue;
      if (isShareDialog(d)) return d;
    }
    return null;
  }

  /**
   * Close Share (or any) dialog via Escape / Close (X). Best-effort.
   */
  function closeDialog(dialog) {
    if (!dialog) return false;
    var closeBtn =
      findByExactishLabels(dialog, ['close', 'ปิด'], true) ||
      dialog.querySelector('[aria-label="Close"], [aria-label="ปิด"], [aria-label*="Close"], [aria-label*="ปิด"]');
    if (closeBtn && isVisible(closeBtn)) {
      clickEl(closeBtn);
      return true;
    }
    try {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
      );
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true })
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  function composerPlainText(el) {
    if (!el) return '';
    if ('value' in el && typeof el.value === 'string' && el.tagName !== 'DIV') {
      return String(el.value || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .trim();
    }
    var raw = '';
    try {
      raw = el.innerText || el.textContent || '';
    } catch (_) {
      raw = el.textContent || '';
    }
    return String(raw)
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim();
  }

  function isPlaceholderOnly(raw) {
    var n = normalizeText(raw);
    if (!n) return true;
    for (var i = 0; i < COMPOSER_PLACEHOLDER_NEEDLES.length; i++) {
      var needle = COMPOSER_PLACEHOLDER_NEEDLES[i];
      if (n === needle) return true;
      if (n.indexOf(needle) === 0 && n.slice(needle.length).replace(/[.\u2026 ]/g, '') === '') return true;
    }
    return false;
  }

  /**
   * empty | exact | repeated | other
   * repeated means the desired sentence was inserted more than once (retry bug).
   */
  function composerTextState(el, desired) {
    var raw = composerPlainText(el);
    if (!raw || isPlaceholderOnly(raw)) return 'empty';
    var want = normalizeText(desired);
    var got = normalizeText(raw);
    if (!want) return 'other';
    if (got === want) return 'exact';
    var compactWant = want.replace(/ /g, '');
    var compactGot = got.replace(/ /g, '');
    if (
      compactWant &&
      compactGot.length > compactWant.length &&
      compactGot.split(compactWant).join('') === ''
    ) {
      return 'repeated';
    }
    return 'other';
  }

  /**
   * True if composer has real typed content (not just placeholder ghost text).
   */
  function composerHasText(el) {
    var raw = composerPlainText(el);
    return !!raw && !isPlaceholderOnly(raw);
  }

  function clearComposerContents(el) {
    try {
      el.focus();
    } catch (_) {}
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch (_) {}
    if (composerHasText(el)) {
      try {
        while (el.firstChild) el.removeChild(el.firstChild);
      } catch (_) {}
    }
  }

  function placeCaretIn(el) {
    try {
      el.focus();
    } catch (_) {}
    try {
      var sel = window.getSelection && window.getSelection();
      if (!sel) return;
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {}
  }

  /**
   * One insertion into a Lexical composer. Do not call another method until the
   * caller has waited and read composerTextState — Facebook applies the text
   * on a later frame, and a second method in the same turn appends a copy.
   * method: 'command' | 'beforeinput' | 'paste'
   */
  function insertComposerText(el, text, method) {
    if (!el) return false;
    var value = String(text || '');
    if (!value) return false;
    var state = composerTextState(el, value);
    if (state === 'exact') return true;
    if (state === 'repeated') return false;
    try {
      clickEl(el);
    } catch (_) {}
    placeCaretIn(el);
    var how = method || 'command';
    try {
      if (how === 'beforeinput') {
        fireInputEvents(el, value);
        return true;
      }
      if (how === 'paste') {
        tryPasteText(el, value);
        return true;
      }
      document.execCommand('insertText', false, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function fireInputEvents(el, data) {
    var value = String(data || '');
    try {
      el.dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value
        })
      );
    } catch (_) {
      try {
        el.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
      } catch (e2) {}
    }
    try {
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: 'insertText',
          data: value
        })
      );
    } catch (_) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function tryPasteText(el, value) {
    try {
      var dt = new DataTransfer();
      dt.setData('text/plain', value);
      var evt = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      // Some browsers ignore clipboardData on constructed ClipboardEvent — also set on window if needed
      el.dispatchEvent(evt);
      return composerHasText(el);
    } catch (_) {
      return false;
    }
  }

  /**
   * Set text on a contenteditable or textarea/input in a way Lexical/React often accepts.
   * Tries multiple strategies; returns true if any strategy ran (caller should verify with composerHasText).
   */
  function setInputText(el, text) {
    if (!el) return false;
    var value = String(text || '');
    if (!value) return false;

    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) {}
    try {
      clickEl(el);
    } catch (_) {}
    try {
      el.focus();
    } catch (_) {}

    // Native inputs / textareas
    if ('value' in el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
      var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    var isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
    if (!isEditable && el.getAttribute('role') === 'textbox') {
      // Sometimes role=textbox wraps the real editable
      var inner = el.querySelector('[contenteditable="true"]');
      if (inner) {
        return setInputText(inner, value);
      }
    }

    if (isEditable || el.getAttribute('role') === 'textbox') {
      return insertComposerText(el, value, 'command');
    }

    return false;
  }

  /**
   * Whether a Post/Share button looks enabled.
   */
  function isPostButtonEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    if (btn.getAttribute('tabindex') === '-1' && btn.getAttribute('aria-disabled') === 'true') return false;
    try {
      var st = window.getComputedStyle(btn);
      if (st && (st.pointerEvents === 'none' || Number(st.opacity) < 0.4)) {
        // FB greys out with low opacity sometimes — treat as disabled if also aria/tab
        if (btn.getAttribute('aria-disabled') === 'true') return false;
      }
    } catch (_) {}
    // Walk ancestors for disabled attribute / aria
    var p = btn.parentElement;
    var hops = 0;
    while (p && hops < 4) {
      if (p.getAttribute && p.getAttribute('aria-disabled') === 'true') return false;
      if (p.disabled) return false;
      p = p.parentElement;
      hops++;
    }
    // Heuristic: class names containing disabled
    var cls = String(btn.className || '').toLowerCase();
    if (cls.indexOf('disabled') !== -1 && btn.getAttribute('aria-disabled') !== 'false') {
      // only treat as disabled if also not clearly enabled
      if (btn.getAttribute('aria-disabled') === 'true') return false;
    }
    return true;
  }

  /**
   * Labels that must NEVER be treated as the Create-post submit button.
   * (Fixes false success when "Share now" matched indexOf('share')===0.)
   */
  var POST_BUTTON_EXCLUDE_NEEDLES = [
    'share now',
    'share',
    'แชร์',
    'send in messenger',
    'copy link',
    'say something',
    'post audience',
    'edit privacy',
    'who can see'
  ];

  /** Allowed Create-post submit labels only — never Share. */
  var POST_BUTTON_LABELS = ['post', 'โพสต์', 'เผยแพร่', 'publish'];

  /**
   * Pure label check: is this the Create-post submit (Post), not Share now?
   * Exported for Node smoke tests without a DOM.
   */
  function isAllowedPostButtonLabel(rawLabel) {
    var label = normalizeText(rawLabel);
    if (!label) return false;
    for (var i = 0; i < POST_BUTTON_EXCLUDE_NEEDLES.length; i++) {
      if (label.indexOf(POST_BUTTON_EXCLUDE_NEEDLES[i]) !== -1) return false;
    }
    for (var j = 0; j < POST_BUTTON_LABELS.length; j++) {
      var want = POST_BUTTON_LABELS[j];
      if (label === want) return true;
      // allow "post" at start only for short labels (e.g. "post") — not "post audience" (excluded above)
      if (label.indexOf(want) === 0 && label.length <= want.length + 4) return true;
    }
    return false;
  }

  /**
   * Find Post / โพสต์ / เผยแพร่ / Publish inside Create post dialog.
   * NEVER returns Share now / Share / แชร์.
   */
  function findPostButton(root) {
    root = root || document;
    var scopes = [];
    var createDlg = findCreatePostDialog(root);
    if (createDlg) scopes.push(createDlg);

    var rootIsDialog = false;
    try {
      rootIsDialog =
        root &&
        root !== document &&
        root.getAttribute &&
        (root.getAttribute('role') === 'dialog' || root.getAttribute('aria-modal') === 'true');
    } catch (_) {}
    if (rootIsDialog && !isShareDialog(root)) {
      if (scopes.indexOf(root) === -1) scopes.push(root);
    }

    var dialog = topmostDialog(root);
    if (dialog && !isShareDialog(dialog) && scopes.indexOf(dialog) === -1) {
      scopes.push(dialog);
    }
    // Do NOT add raw document if a Share dialog is topmost without Create post —
    // that would let Share now leak in via document-wide scan.
    if (!findShareDialog(root) || createDlg) {
      scopes.push(root);
    } else if (!scopes.length) {
      // Only Share dialog visible — intentionally return null (caller should fail)
      return null;
    }

    var enabledOnScreen = null;
    var enabled = null;
    var anyOnScreen = null;
    var any = null;

    for (var s = 0; s < scopes.length; s++) {
      var scope = scopes[s];
      if (!scope || !scope.querySelectorAll) continue;
      // Skip scanning inside Share dialogs
      if (scope.getAttribute && isShareDialog(scope)) continue;

      var candidates = scope.querySelectorAll(
        'button, div[role="button"], span[role="button"], [aria-label], a[role="button"]'
      );
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (!isVisible(el)) continue;
        // Skip if this button lives inside a Share dialog
        var ownerDlg = el.closest ? el.closest('[role="dialog"], [aria-modal="true"]') : null;
        if (ownerDlg && isShareDialog(ownerDlg)) continue;

        var label = normalizeText(
          el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.textContent
        );
        if (!isAllowedPostButtonLabel(label)) continue;

        if (isPostButtonEnabled(el)) {
          if (!enabled) enabled = el;
          if (!enabledOnScreen && intersectsViewport(el)) enabledOnScreen = el;
        } else {
          if (!any) any = el;
          if (!anyOnScreen && intersectsViewport(el)) anyOnScreen = el;
        }
      }
      if (enabledOnScreen) break;
    }

    return enabledOnScreen || enabled || anyOnScreen || any;
  }

  function extractGroupId(input) {
    var s = String(input || '').trim();
    if (!s) return '';
    if (/^\d{5,}$/.test(s)) return s;
    var m = s.match(/facebook\.com\/groups\/([^\/\?#]+)/i);
    if (m) return m[1];
    m = s.match(/groups\/([^\/\?#]+)/i);
    if (m) return m[1];
    return s;
  }

  function toGroupUrl(input) {
    var id = extractGroupId(input);
    if (!id) return '';
    if (/^https?:\/\//i.test(id)) return id;
    return 'https://www.facebook.com/groups/' + id;
  }

  /**
   * Parse textarea lines into unique group URL entries.
   */
  function parseGroupList(text) {
    var lines = String(text || '').split(/\r?\n/);
    var seen = {};
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      var url = toGroupUrl(line);
      if (!url) continue;
      if (seen[url]) continue;
      seen[url] = true;
      out.push({ raw: line, url: url, id: extractGroupId(line) });
    }
    return out;
  }

  function randomDelayMs(minSec, maxSec) {
    var min = Math.max(1, Number(minSec) || 60);
    var max = Math.max(min, Number(maxSec) || 120);
    var sec = min + Math.random() * (max - min);
    return Math.round(sec * 1000);
  }

  /**
   * Convert a data URL (base64) into a File object for input[type=file].
   */
  function dataUrlToFile(dataUrl, name, mime) {
    var parts = String(dataUrl || '').split(',');
    if (parts.length < 2) return null;
    var meta = parts[0] || '';
    var b64 = parts[1] || '';
    var type = mime || 'image/png';
    var m = meta.match(/data:([^;]+)/);
    if (m) type = m[1];
    var bin;
    try {
      bin = atob(b64);
    } catch (_) {
      return null;
    }
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    var fname = name || 'image.png';
    try {
      return new File([bytes], fname, { type: type });
    } catch (_) {
      try {
        var blob = new Blob([bytes], { type: type });
        blob.name = fname;
        return blob;
      } catch (e2) {
        return null;
      }
    }
  }

  /**
   * Assign File/Blob list onto an input[type=file] via DataTransfer so React/FB sees change.
   */
  function assignFilesToInput(input, files) {
    if (!input || !files || !files.length) return false;
    try {
      var dt = new DataTransfer();
      for (var i = 0; i < files.length; i++) {
        if (files[i]) dt.items.add(files[i]);
      }
      var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files');
      if (desc && desc.set) desc.set.call(input, dt.files);
      else input.files = dt.files;
      // Read length before change. Facebook's handler takes the files and clears the input,
      // so a check after the event looks like the assign failed even though the photos show.
      var accepted = !!(input.files && input.files.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return accepted;
    } catch (e) {
      return false;
    }
  }

  /**
   * Find a file input that accepts images, optionally after clicking Photo/Video control.
   */
  var NON_GROUP_SLUGS = { feed: 1, discover: 1, joins: 1, create: 1, search: 1 };

  /**
   * facebook.com/groups/<id> from a tab URL. Null when this is not a group page.
   */
  function parseOpenGroupUrl(href) {
    var m = String(href || '').match(/facebook\.com\/groups\/([^\/?#]+)/i);
    if (!m) return null;
    var id = m[1];
    try {
      id = decodeURIComponent(id);
    } catch (_) {}
    if (!id || NON_GROUP_SLUGS[String(id).toLowerCase()]) return null;
    return { id: id, url: 'https://www.facebook.com/groups/' + id };
  }

  function groupListKey(input) {
    var parsed = parseOpenGroupUrl(input);
    if (parsed) return String(parsed.id).toLowerCase();
    return String(extractGroupId(input) || '').trim().toLowerCase();
  }

  function groupListHas(text, url) {
    var key = groupListKey(url);
    if (!key) return false;
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t || t.charAt(0) === '#') continue;
      if (groupListKey(t) === key) return true;
    }
    return false;
  }

  /** Append a canonical group URL line. Leaves the text unchanged if that group is already listed. */
  function addGroupUrlLine(text, url) {
    var parsed = parseOpenGroupUrl(url);
    var canonical = parsed ? parsed.url : toGroupUrl(url) || String(url || '').trim();
    if (!canonical) return String(text || '');
    if (groupListHas(text, canonical)) return String(text || '');
    var base = String(text || '').replace(/\s+$/, '');
    return (base ? base + '\n' : '') + canonical;
  }

  /** Remove the line for this group. Other lines stay. */
  function removeGroupUrlLine(text, url) {
    var key = groupListKey(url);
    if (!key) return String(text || '');
    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t && t.charAt(0) !== '#' && groupListKey(t) === key) continue;
      out.push(lines[i]);
    }
    return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  }

  function findImageFileInput(root) {
    root = root || document;
    var inputs = root.querySelectorAll('input[type="file"]');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var accept = (inp.getAttribute('accept') || '').toLowerCase();
      if (!accept || accept.indexOf('image') !== -1 || accept.indexOf('video') !== -1 || accept === '*/*') {
        return inp;
      }
    }
    return null;
  }

  return {
    sleep: sleep,
    normalizeText: normalizeText,
    findByText: findByText,
    isVisible: isVisible,
    clickEl: clickEl,
    setInputText: setInputText,
    insertComposerText: insertComposerText,
    findComposer: findComposer,
    composerHasText: composerHasText,
    composerPlainText: composerPlainText,
    composerTextState: composerTextState,
    findPostButton: findPostButton,
    isPostButtonEnabled: isPostButtonEnabled,
    isAllowedPostButtonLabel: isAllowedPostButtonLabel,
    isShareDialog: isShareDialog,
    isCreatePostDialog: isCreatePostDialog,
    findCreatePostDialog: findCreatePostDialog,
    findShareDialog: findShareDialog,
    closeDialog: closeDialog,
    dialogTitleText: dialogTitleText,
    topmostDialog: topmostDialog,
    extractGroupId: extractGroupId,
    toGroupUrl: toGroupUrl,
    parseGroupList: parseGroupList,
    parseOpenGroupUrl: parseOpenGroupUrl,
    groupListKey: groupListKey,
    groupListHas: groupListHas,
    addGroupUrlLine: addGroupUrlLine,
    removeGroupUrlLine: removeGroupUrlLine,
    randomDelayMs: randomDelayMs,
    dataUrlToFile: dataUrlToFile,
    assignFilesToInput: assignFilesToInput,
    findImageFileInput: findImageFileInput
  };
});
