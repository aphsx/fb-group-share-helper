'use strict';

const $ = (id) => document.getElementById(id);

const MAX_IMAGES = 5;
/** Warn when total base64 payload exceeds this (bytes of dataUrl strings). */
const WARN_TOTAL_BYTES = 4 * 1024 * 1024;
/** Soft per-file warn before encoding (raw file size). */
const WARN_FILE_BYTES = 2 * 1024 * 1024;

let currentMode = 'post';
/** In-memory selected images for post mode: [{name,type,dataUrl}] */
let selectedImages = [];
/** Unsaved edits must survive the 2s refresh that reloads storage into the form. */
const fieldDirty = {
  groups: false,
  caption: false,
  postBody: false,
  delayMin: false,
  delayMax: false
};
/** Group open in the active Facebook tab: { onGroup, name, url } */
let currentGroup = { onGroup: false, name: '', url: '' };
/** Last group seen on a tab, kept after the user leaves that page. */
let rememberedGroup = { name: '', url: '' };
/** Group keys the user unchecked, so a later refresh does not put them back. */
const dismissedGroupKeys = Object.create(null);

const H = self.FbShareDomHelpers || {};

async function send(type, extra) {
  return chrome.runtime.sendMessage(Object.assign({ type }, extra || {}));
}

function applyModeUI(mode) {
  currentMode = mode === 'post' ? 'post' : 'share';
  const isPost = currentMode === 'post';

  $('modeShare').classList.toggle('active', !isPost);
  $('modePost').classList.toggle('active', isPost);

  $('pageTitle').textContent = isPost ? 'โพสต์ใหม่ → กลุ่ม' : 'แชร์โพสต์ → กลุ่ม';
  $('groupsLabel').textContent = 'เพิ่มกลุ่มเป้าหมาย';

  $('captionSection').hidden = isPost;
  $('postBodySection').hidden = !isPost;
  $('imagesSection').hidden = !isPost;

  $('footerHint').textContent = isPost
    ? 'เปิด facebook.com (ล็อกอินแล้ว) · ใส่ข้อความและ/หรือรูป · เลือกกลุ่มแล้วกดเริ่ม · เคารพ Meta ToS'
    : 'เปิดโพสต์บน facebook.com ก่อนกดเริ่ม · เคารพ Meta ToS · selector อาจพังได้';
}

function renderQueue(queue) {
  const ul = $('queueList');
  ul.innerHTML = '';
  const list = queue || [];
  const total = list.length;
  const ok = list.filter((q) => q.status === 'success').length;
  const fail = list.filter((q) => q.status === 'fail').length;
  const done = ok + fail;
  const pct = total ? Math.round((done / total) * 100) : 0;
  if ($('statTotal')) $('statTotal').textContent = String(total);
  if ($('statOk')) $('statOk').textContent = String(ok);
  if ($('statFail')) $('statFail').textContent = String(fail);
  if ($('runProgressBar')) $('runProgressBar').style.width = pct + '%';
  if ($('runProgressLabel')) {
    $('runProgressLabel').textContent = total
      ? (done === total ? 'ครบแล้ว (' + pct + '%)' : 'กำลังทำงาน… (' + pct + '%) · ' + done + '/' + total)
      : 'ยังไม่เริ่ม';
  }
  list.forEach((q) => {
    const li = document.createElement('li');
    li.className = q.status || 'pending';
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = statusLabel(q.status);
    const body = document.createElement('span');
    body.textContent = (q.raw || q.url) + (q.message ? ' — ' + q.message : '');
    li.appendChild(st);
    li.appendChild(body);
    ul.appendChild(li);
  });
}

function statusLabel(s) {
  switch (s) {
    case 'success':
      return 'สำเร็จ';
    case 'fail':
      return 'ล้มเหลว';
    case 'running':
      return 'กำลังทำ';
    default:
      return 'รอ';
  }
}

function renderLog(log) {
  const lines = (log || [])
    .slice(-40)
    .map((e) => {
      const t = (e.at || '').slice(11, 19);
      return '[' + t + '] ' + (e.level || 'info') + ': ' + (e.message || '');
    })
    .join('\n');
  $('log').textContent = lines || '(ยังไม่มีบันทึก)';
}

function setRunningBadge(running) {
  const b = $('runBadge');
  if (running) {
    b.textContent = 'กำลังรัน';
    b.className = 'badge run';
  } else {
    b.textContent = 'หยุด';
    b.className = 'badge stop';
  }
  $('btnStart').disabled = !!running;
  $('btnStop').disabled = !running;
  $('modeShare').disabled = !!running;
  $('modePost').disabled = !!running;
  $('imageInput').disabled = !!running;
  $('btnClearImages').disabled = !!running;
  if ($('btnAddGroup')) $('btnAddGroup').disabled = !!running;
  if ($('groupLinkInput')) $('groupLinkInput').disabled = !!running;
}

function estimateImagesBytes(images) {
  let n = 0;
  (images || []).forEach((img) => {
    n += (img.dataUrl && img.dataUrl.length) || 0;
  });
  return n;
}

function renderImagePreview() {
  const box = $('imagePreview');
  box.innerHTML = '';
  selectedImages.forEach((img) => {
    const wrap = document.createElement('div');
    wrap.className = 'thumb';
    const el = document.createElement('img');
    el.src = img.dataUrl;
    el.alt = img.name || 'image';
    const name = document.createElement('div');
    name.className = 'tname';
    name.textContent = img.name || 'image';
    wrap.appendChild(el);
    wrap.appendChild(name);
    box.appendChild(wrap);
  });

  const hint = $('imageHint');
  const chosen = $('imageChosen');
  const bytes = estimateImagesBytes(selectedImages);
  if (chosen) {
    chosen.textContent = selectedImages.length
      ? 'เลือกแล้ว ' + selectedImages.map((img) => img.name || 'image').join(', ')
      : 'ยังไม่ได้เลือกรูป';
  }
  if (!selectedImages.length) {
    hint.textContent = '';
    hint.className = 'image-hint';
  } else {
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    hint.textContent = selectedImages.length + ' รูป · ~' + mb + ' MB ใน storage';
    hint.className = bytes > WARN_TOTAL_BYTES ? 'image-hint warn' : 'image-hint';
    if (bytes > WARN_TOTAL_BYTES) {
      hint.textContent += ' — ใหญ่เกินไป อาจบันทึกไม่สำเร็จ';
    }
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function addFilesFromInput(fileList) {
  const files = Array.from(fileList || []).filter((f) => f && /^image\//i.test(f.type));
  if (!files.length) {
    $('log').textContent = 'เลือกได้เฉพาะไฟล์รูปภาพ';
    return;
  }

  const room = MAX_IMAGES - selectedImages.length;
  if (room <= 0) {
    $('log').textContent = 'แนบรูปได้สูงสุด ' + MAX_IMAGES + ' ใบ';
    return;
  }

  const take = files.slice(0, room);
  const warnings = [];
  for (const f of take) {
    if (f.size > WARN_FILE_BYTES) {
      warnings.push(f.name + ' ใหญ่ (~' + (f.size / (1024 * 1024)).toFixed(1) + ' MB)');
    }
    try {
      const dataUrl = await readFileAsDataUrl(f);
      selectedImages.push({
        name: f.name || 'image.png',
        type: f.type || 'image/png',
        dataUrl: String(dataUrl)
      });
    } catch (e) {
      warnings.push('อ่าน ' + (f.name || 'ไฟล์') + ' ไม่ได้');
    }
  }

  if (files.length > room) {
    warnings.push('ตัดเหลือ ' + MAX_IMAGES + ' ใบ (สูงสุด)');
  }

  renderImagePreview();
  try {
    await chrome.storage.local.set({ images: selectedImages.slice() });
    window.__FGSH_IMAGES_DIRTY__ = false;
  } catch (e) {
    warnings.push('บันทึกรูปไม่สำเร็จ');
  }
  if (warnings.length) {
    $('log').textContent = 'คำเตือน: ' + warnings.join(' · ');
  } else {
    $('log').textContent = 'เพิ่มรูปแล้ว ' + take.length + ' ใบ — จะแนบตอนโพสต์';
  }
}

function clearImages() {
  selectedImages = [];
  $('imageInput').value = '';
  renderImagePreview();
  chrome.storage.local.set({ images: [] }).catch(() => {});
  window.__FGSH_IMAGES_DIRTY__ = false;
  $('log').textContent = 'ล้างรูปแล้ว';
}

function hasPostContent(payload) {
  const text = String(payload.postBody || '').trim();
  return !!(text || (selectedImages && selectedImages.length));
}

function markDirty(id) {
  if (Object.prototype.hasOwnProperty.call(fieldDirty, id)) fieldDirty[id] = true;
}

function clearFieldDirty() {
  Object.keys(fieldDirty).forEach((id) => {
    fieldDirty[id] = false;
  });
}

function applyStoredField(id, value) {
  const el = $(id);
  if (!el) return;
  if (document.activeElement === el) return;
  if (fieldDirty[id]) return;
  const next = value == null ? '' : String(value);
  if (el.value !== next) el.value = next;
}

function groupKeyOf(url) {
  if (H.groupListKey) return H.groupListKey(url);
  return String(url || '');
}

/** Saved target rows: { url, name, selected }. Checked rows are what the queue posts to. */
let targets = [];
let persistTargetsTimer = null;

function canonicalGroupUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (H.parseOpenGroupUrl) {
    const direct = H.parseOpenGroupUrl(raw);
    if (direct) return direct.url;
  }
  const id = H.extractGroupId ? H.extractGroupId(raw) : '';
  if (!id || /^(feed|discover|joins|create|search)$/i.test(id)) return '';
  const built = 'https://www.facebook.com/groups/' + id;
  if (H.parseOpenGroupUrl) {
    const again = H.parseOpenGroupUrl(built);
    return again ? again.url : '';
  }
  return built;
}

function cleanGroupTitle(raw) {
  let name = String(raw || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  name = name.replace(/^\(\d+\)\s*/, '');
  name = name.replace(/\s*[|\-–]\s*facebook\s*$/i, '').trim();
  if (!name || /^(facebook|log in|login|เข้าสู่ระบบ)$/i.test(name)) return '';
  return name;
}

function nameFromHtml(html) {
  const text = String(html || '');
  const title = (text.match(/<title[^>]*>([^<]{1,240})<\/title>/i) || [])[1] || '';
  let name = cleanGroupTitle(title);
  if (name) return name;
  const og =
    (text.match(/property="og:title"\s+content="([^"]{1,240})"/i) || [])[1] ||
    (text.match(/content="([^"]{1,240})"\s+property="og:title"/i) || [])[1] ||
    '';
  return cleanGroupTitle(og);
}

async function resolveGroupName(url) {
  const key = groupKeyOf(url);
  if (currentGroup.onGroup && groupKeyOf(currentGroup.url) === key && currentGroup.name) {
    return currentGroup.name;
  }
  if (groupKeyOf(rememberedGroup.url) === key && rememberedGroup.name) return rememberedGroup.name;
  try {
    const res = await fetch(url, { credentials: 'include' });
    const html = await res.text();
    return nameFromHtml(html);
  } catch (_) {
    return '';
  }
}

function syncTextFromTargets() {
  const el = $('groups');
  if (!el) return;
  el.value = targets
    .filter((t) => t.selected)
    .map((t) => t.url)
    .join('\n');
}

function renderTargets() {
  const box = $('targetGroups');
  if (!box) return;
  box.innerHTML = '';
  if (!targets.length) {
    const empty = document.createElement('p');
    empty.className = 'target-empty';
    empty.textContent = 'ยังไม่มีกลุ่มเป้าหมาย วางลิงก์แล้วกดเพิ่ม';
    box.appendChild(empty);
    return;
  }
  targets.forEach((row) => {
    const label = document.createElement('label');
    label.className = 'target-row';
    const boxInput = document.createElement('input');
    boxInput.type = 'checkbox';
    boxInput.checked = !!row.selected;
    boxInput.addEventListener('change', () => {
      const key = groupKeyOf(row.url);
      row.selected = boxInput.checked;
      if (key) {
        if (row.selected) delete dismissedGroupKeys[key];
        else dismissedGroupKeys[key] = true;
      }
      syncTextFromTargets();
      markDirty('groups');
      persistTargetsSoon();
    });
    const text = document.createElement('span');
    const name = document.createElement('span');
    name.className = 'name';
    const id = (H.extractGroupId && H.extractGroupId(row.url)) || row.url;
    name.textContent = row.name || 'กลุ่ม ' + id;
    const url = document.createElement('span');
    url.className = 'url';
    url.textContent = row.url;
    text.appendChild(name);
    text.appendChild(url);
    label.appendChild(boxInput);
    label.appendChild(text);
    box.appendChild(label);
  });
}

function upsertTarget(url, name, selected) {
  const canonical = canonicalGroupUrl(url) || url;
  const key = groupKeyOf(canonical);
  let row = targets.find((t) => groupKeyOf(t.url) === key);
  if (!row) {
    row = { url: canonical, name: name || '', selected: selected !== false };
    targets.push(row);
  } else {
    row.url = canonical;
    if (name) row.name = name;
    if (selected != null) row.selected = !!selected;
  }
  syncTextFromTargets();
  renderTargets();
  markDirty('groups');
  persistTargetsSoon();
}

function persistTargetsSoon() {
  persistGroupsTextSoon();
  clearTimeout(persistTargetsTimer);
  persistTargetsTimer = setTimeout(() => {
    chrome.storage.local.set({ groupTargets: targets }).catch(() => {});
  }, 400);
}

async function loadTargets() {
  if (fieldDirty.groups) {
    renderTargets();
    return;
  }
  let saved = [];
  try {
    const data = await chrome.storage.local.get(['groupTargets']);
    saved = Array.isArray(data.groupTargets) ? data.groupTargets : [];
  } catch (_) {}
  const map = new Map();
  saved.forEach((t) => {
    if (!t || !t.url) return;
    const url = canonicalGroupUrl(t.url) || t.url;
    map.set(groupKeyOf(url), { url: url, name: t.name || '', selected: !!t.selected });
  });
  const parsed = H.parseGroupList ? H.parseGroupList($('groups').value) : [];
  parsed.forEach((item) => {
    const key = groupKeyOf(item.url);
    const prev = map.get(key);
    if (prev) {
      prev.selected = true;
      prev.url = item.url;
    } else {
      map.set(key, { url: item.url, name: '', selected: true });
    }
  });
  targets = Array.from(map.values());
  renderTargets();
}

async function addTargetFromInput() {
  const status = $('addGroupStatus');
  const raw = ($('groupLinkInput') && $('groupLinkInput').value) || '';
  const url = canonicalGroupUrl(raw);
  if (!url) {
    if (status) status.textContent = 'ลิงก์นี้ไม่ใช่หน้ากลุ่ม';
    return;
  }
  if ($('runBadge') && $('runBadge').classList.contains('run')) return;
  if (status) status.textContent = 'กำลังอ่านชื่อกลุ่ม…';
  $('btnAddGroup').disabled = true;
  const name = await resolveGroupName(url);
  const key = groupKeyOf(url);
  if (key) delete dismissedGroupKeys[key];
  upsertTarget(url, name, true);
  $('groupLinkInput').value = '';
  if (status) {
    status.textContent = name
      ? 'เพิ่มแล้ว: ' + name
      : 'เพิ่มลิงก์แล้ว แต่อ่านชื่อจาก Facebook ไม่ได้ ยังติ๊กโพสต์ได้';
  }
  $('btnAddGroup').disabled = !!($('runBadge') && $('runBadge').classList.contains('run'));
}

/**
 * Put the open group into the list without a click.
 * Share and auto-post both read this same list, then open the group even if the tab has left it.
 */
function adoptOpenGroup() {
  if (!currentGroup.onGroup || !currentGroup.url) return;
  rememberedGroup = { name: currentGroup.name || '', url: currentGroup.url };
  if ($('runBadge') && $('runBadge').classList.contains('run')) return;
  const key = groupKeyOf(currentGroup.url);
  if (key && dismissedGroupKeys[key]) return;
  const existing = targets.find((t) => groupKeyOf(t.url) === key);
  if (existing) {
    if (currentGroup.name && existing.name !== currentGroup.name) {
      existing.name = currentGroup.name;
      renderTargets();
      persistTargetsSoon();
    }
    return;
  }
  upsertTarget(currentGroup.url, currentGroup.name || '', true);
}

let persistGroupsTimer = null;
function persistGroupsTextSoon() {
  clearTimeout(persistGroupsTimer);
  persistGroupsTimer = setTimeout(() => {
    const el = $('groups');
    if (!el) return;
    chrome.storage.local.set({ groupsText: el.value }).catch(() => {});
  }, 400);
}

async function findFacebookTab() {
  const queries = [
    { active: true, currentWindow: true },
    { active: true, lastFocusedWindow: true }
  ];
  for (const q of queries) {
    try {
      const tabs = await chrome.tabs.query(q);
      const tab = (tabs || []).find((t) =>
        /https?:\/\/([a-z0-9-]+\.)?facebook\.com\//i.test(t.url || '')
      );
      if (tab) return tab;
    } catch (_) {}
  }
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.facebook.com/*' });
    return (tabs || []).find((t) => t.active) || (tabs || [])[0] || null;
  } catch (_) {
    return null;
  }
}

function probeGroupInPage() {
  const href = location.href || '';
  const m = href.match(/facebook\.com\/groups\/([^\/?#]+)/i);
  if (!m) return { ok: true, onGroup: false, name: '', url: '' };
  let id = m[1];
  try {
    id = decodeURIComponent(id);
  } catch (_) {}
  if (!id || /^(feed|discover|joins|create|search)$/i.test(id)) {
    return { ok: true, onGroup: false, name: '', url: '' };
  }
  const url = 'https://www.facebook.com/groups/' + id;
  let name = '';
  const title = document.title || '';
  if (/\|\s*facebook\s*$/i.test(title)) {
    name = title.split('|')[0].trim();
  }
  if (!name) {
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
  }
  if (/^(facebook|log in|login)$/i.test(name)) name = '';
  return { ok: true, onGroup: true, name: name, url: url };
}

async function refreshCurrentGroup() {
  const empty = { onGroup: false, name: '', url: '' };
  try {
    const tab = await findFacebookTab();
    if (!tab || !tab.id) {
      currentGroup = empty;
      return;
    }
    let res = null;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { action: 'getCurrentGroup' });
    } catch (_) {
      res = null;
    }
    if (!res || !res.ok) {
      try {
        const injected = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: probeGroupInPage
        });
        res = injected && injected[0] && injected[0].result;
      } catch (_) {
        res = null;
      }
    }
    if (res && res.onGroup && res.url) {
      currentGroup = { onGroup: true, name: res.name || '', url: res.url };
    } else {
      currentGroup = empty;
    }
  } catch (_) {
    currentGroup = empty;
  }
  adoptOpenGroup();
}

function collectPayload() {
  const payload = {
    mode: currentMode,
    groupsText: $('groups').value,
    caption: $('caption').value,
    postBody: $('postBody').value,
    delayMin: Number($('delayMin').value),
    delayMax: Number($('delayMax').value)
  };
  // Only touch images storage from post mode (share save must not wipe photos).
  if (currentMode === 'post') {
    payload.images = selectedImages.slice();
  }
  return payload;
}

async function refresh() {
  const res = await send('GET_STATE');
  if (!res || !res.ok) return;
  const s = res.state;
  applyStoredField('groups', s.groupsText || '');
  applyStoredField('caption', s.caption || '');
  applyStoredField('postBody', s.postBody || '');
  applyStoredField('delayMin', s.delayMin != null ? s.delayMin : 60);
  applyStoredField('delayMax', s.delayMax != null ? s.delayMax : 120);
  await loadTargets();

  // Sync images from storage unless user is mid-picking (input focused)
  if (document.activeElement !== $('imageInput')) {
    const stored = Array.isArray(s.images) ? s.images : [];
    // Only replace local cache when counts/names differ to avoid wiping unsaved picks
    // during a save cycle we already set selectedImages; compare lightly.
    const same =
      selectedImages.length === stored.length &&
      selectedImages.every(
        (img, i) =>
          stored[i] &&
          img.name === stored[i].name &&
          img.dataUrl === stored[i].dataUrl
      );
    if (!same && !window.__FGSH_IMAGES_DIRTY__) {
      selectedImages = stored.map((img) => ({
        name: img.name,
        type: img.type,
        dataUrl: img.dataUrl
      }));
      renderImagePreview();
    }
  }

  if (!s.running) applyModeUI(s.mode || 'share');
  else applyModeUI(s.mode || currentMode);
  renderQueue(s.queue);
  renderLog(s.log);
  setRunningBadge(!!s.running);
  await refreshCurrentGroup();
}

async function switchMode(mode) {
  if ($('runBadge').classList.contains('run')) {
    $('log').textContent = 'กำลังรันอยู่ — กดหยุดก่อนเปลี่ยนโหมด';
    return;
  }
  applyModeUI(mode);
  // Persist mode only — do not require post text/images yet
  try {
    const res = await send('SET_MODE', { mode });
    if (res && !res.ok) {
      $('log').textContent = res.message || 'เปลี่ยนโหมดไม่สำเร็จ';
    }
  } catch (_) {}
}

$('modeShare').addEventListener('click', () => {
  switchMode('share');
});

$('modePost').addEventListener('click', () => {
  switchMode('post');
});

$('imageInput').addEventListener('change', async (e) => {
  window.__FGSH_IMAGES_DIRTY__ = true;
  await addFilesFromInput(e.target.files);
});

$('btnClearImages').addEventListener('click', () => {
  window.__FGSH_IMAGES_DIRTY__ = true;
  clearImages();
});

$('btnSave').addEventListener('click', async () => {
  const payload = collectPayload();
  if (payload.mode === 'post' && !hasPostContent(payload)) {
    $('log').textContent = 'โหมดโพสต์ใหม่ต้องมีข้อความหรือรูปอย่างน้อยอย่างใดอย่างหนึ่ง';
    return;
  }
  const bytes = estimateImagesBytes(payload.images);
  if (bytes > WARN_TOTAL_BYTES) {
    $('log').textContent =
      'รูปใหญ่เกินไป (~' +
      (bytes / (1024 * 1024)).toFixed(1) +
      ' MB) — ลดจำนวน/ขนาดรูปก่อนบันทึก (แนะนำรวม < 4 MB)';
    return;
  }
  const res = await send('SAVE_LIST', payload);
  if (res && res.ok) {
    window.__FGSH_IMAGES_DIRTY__ = false;
    clearFieldDirty();
    const imgNote =
      payload.mode === 'post' ? ' · รูป ' + (payload.images || []).length + ' ใบ' : '';
    $('log').textContent =
      'บันทึกแล้ว ' +
      res.count +
      ' กลุ่ม · โหมด ' +
      (payload.mode === 'post' ? 'โพสต์ใหม่' : 'แชร์') +
      imgNote;
    await refresh();
  } else {
    $('log').textContent = 'บันทึกไม่สำเร็จ: ' + ((res && res.message) || '');
  }
});

$('btnStart').addEventListener('click', async () => {
  const payload = collectPayload();
  if (payload.mode === 'post' && !hasPostContent(payload)) {
    $('log').textContent = 'โหมดโพสต์ใหม่ต้องมีข้อความหรือรูปอย่างน้อยอย่างใดอย่างหนึ่ง';
    return;
  }
  const bytes = estimateImagesBytes(payload.images);
  if (payload.mode === 'post' && bytes > WARN_TOTAL_BYTES) {
    $('log').textContent = 'รูปใหญ่เกินไป — ลดขนาดก่อนเริ่ม';
    return;
  }
  const res = await send('START', Object.assign({}, payload, { resetStatuses: true }));
  if (!res || !res.ok) {
    $('log').textContent = (res && res.message) || 'เริ่มไม่สำเร็จ';
  } else {
    window.__FGSH_IMAGES_DIRTY__ = false;
    clearFieldDirty();
  }
  await refresh();
});

$('btnStop').addEventListener('click', async () => {
  await send('STOP');
  await refresh();
});

['groups', 'caption', 'postBody', 'delayMin', 'delayMax'].forEach((id) => {
  $(id).addEventListener('input', () => {
    markDirty(id);
    if (id === 'groups') persistGroupsTextSoon();
  });
});

$('btnAddGroup').addEventListener('click', () => {
  addTargetFromInput();
});

$('groupLinkInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addTargetFromInput();
  }
});

chrome.storage.onChanged.addListener(() => {
  refresh();
});

refresh();
setInterval(refresh, 2000);
