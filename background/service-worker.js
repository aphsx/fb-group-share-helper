/**
 * Background service worker — queue runner for group shares / auto-posts.
 * Persists list / status / stop flag / mode in chrome.storage.local.
 * Never stores passwords or session tokens beyond what Chrome already has.
 */
'use strict';

const STORAGE_KEYS = {
  groupsText: 'groupsText',
  caption: 'caption',
  postBody: 'postBody',
  mode: 'mode',
  delayMin: 'delayMin',
  delayMax: 'delayMax',
  queue: 'queue',
  running: 'running',
  stopRequested: 'stopRequested',
  log: 'log',
  postUrl: 'postUrl',
  images: 'images'
};

/** Max images persisted for Auto Post (popup enforces too). */
const MAX_IMAGES = 5;

const DEFAULTS = {
  groupsText: '',
  caption: '',
  postBody: '',
  mode: 'share', // 'share' | 'post'
  delayMin: 60,
  delayMax: 120,
  queue: [],
  running: false,
  stopRequested: false,
  log: [],
  postUrl: '',
  images: [] // [{ name, type, dataUrl }]
};

function parseGroupList(text) {
  const lines = String(text || '').split(/\r?\n/);
  const seen = Object.create(null);
  const out = [];
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) continue;
    let url = raw;
    if (/^\d{5,}$/.test(raw)) {
      url = 'https://www.facebook.com/groups/' + raw;
    } else if (!/^https?:\/\//i.test(raw)) {
      if (/^groups\//i.test(raw)) {
        url = 'https://www.facebook.com/' + raw.replace(/^\/+/, '');
      } else {
        url = 'https://www.facebook.com/groups/' + raw.replace(/^\/+/, '');
      }
    }
    try {
      const u = new URL(url);
      if (!/\.facebook\.com$/i.test(u.hostname) && u.hostname !== 'facebook.com') continue;
    } catch (_) {
      continue;
    }
    if (seen[url]) continue;
    seen[url] = true;
    out.push({
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8),
      raw,
      url,
      status: 'pending',
      message: ''
    });
  }
  return out;
}


function hasPostContent(postBody, images) {
  const text = String(postBody || '').trim();
  const imgs = Array.isArray(images) ? images : [];
  return !!(text || imgs.length);
}

function normalizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((img) => img && img.dataUrl)
    .slice(0, MAX_IMAGES)
    .map((img) => ({
      name: String(img.name || 'image.png').slice(0, 200),
      type: String(img.type || 'image/png').slice(0, 80),
      dataUrl: String(img.dataUrl)
    }));
}

function randomDelayMs(minSec, maxSec) {
  const min = Math.max(1, Number(minSec) || 60);
  const max = Math.max(min, Number(maxSec) || 120);
  return Math.round((min + Math.random() * (max - min)) * 1000);
}

async function getState() {
  const data = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return Object.assign({}, DEFAULTS, data);
}

async function setState(partial) {
  await chrome.storage.local.set(partial);
}

async function appendLog(entry) {
  const { log } = await getState();
  const next = (log || []).slice(-199);
  next.push(
    Object.assign(
      {
        at: new Date().toISOString()
      },
      entry
    )
  );
  await setState({ log: next });
  return next;
}

async function findFacebookTab() {
  const tabs = await chrome.tabs.query({ url: ['https://*.facebook.com/*', 'https://facebook.com/*'] });
  const active = tabs.find((t) => t.active);
  if (active) return active;
  if (tabs.length) return tabs[0];
  return null;
}

/**
 * Ask the content script to act. Falls back to injecting if not listening.
 */
async function sendToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['lib/dom-helpers.js', 'content/content.js']
      });
      await new Promise((r) => setTimeout(r, 400));
      return await chrome.tabs.sendMessage(tabId, payload);
    } catch (err2) {
      return { ok: false, message: 'ไม่ติดต่อ content script ได้: ' + String(err2.message || err2) };
    }
  }
}

async function updateQueueItem(itemId, patch) {
  const { queue } = await getState();
  const next = (queue || []).map((q) => (q.id === itemId ? Object.assign({}, q, patch) : q));
  await setState({ queue: next });
  return next;
}

/**
 * Navigate a tab to url and wait briefly for load (best-effort).
 */
async function navigateTab(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  // Wait for complete status (max ~25s)
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const t = await chrome.tabs.get(tabId);
      if (t.status === 'complete' && t.url && t.url.indexOf('facebook.com') !== -1) {
        await new Promise((r) => setTimeout(r, 800));
        return true;
      }
    } catch (_) {
      return false;
    }
  }
  return false;
}

async function scheduleNextDelay(state) {
  const delayMs = randomDelayMs(state.delayMin, state.delayMax);
  await appendLog({
    level: 'info',
    message: 'รอ ' + Math.round(delayMs / 1000) + ' วินาที ก่อนกลุ่มถัดไป / waiting'
  });
  await chrome.alarms.clear('fgsh-next');
  chrome.alarms.create('fgsh-next', { when: Date.now() + delayMs });
}

async function finishOrContinue() {
  const after = await getState();
  if (!after.running || after.stopRequested) {
    await setState({ running: false, stopRequested: false });
    await appendLog({ level: 'info', message: 'หยุดตามคำขอ / Stopped' });
    return;
  }
  const remaining = (after.queue || []).some((q) => q.status === 'pending');
  if (!remaining) {
    await setState({ running: false, stopRequested: false });
    await appendLog({ level: 'info', message: 'เสร็จทุกกลุ่ม / All done' });
    return;
  }
  await scheduleNextDelay(after);
}

async function runShareItem(nextItem, state, tab) {
  await updateQueueItem(nextItem.id, { status: 'running', message: 'กำลังแชร์…' });

  let postUrl = state.postUrl || '';
  try {
    if (tab.url && /facebook\.com\/.+\/posts\//i.test(tab.url)) {
      postUrl = tab.url.split('?')[0];
      await setState({ postUrl });
    } else if (tab.url && /story_fbid|\/permalink\//i.test(tab.url)) {
      postUrl = tab.url.split('?')[0];
      await setState({ postUrl });
    }
  } catch (_) {}

  const result = await sendToTab(tab.id, {
    action: 'shareToGroup',
    groupUrl: nextItem.url,
    caption: state.caption || '',
    postUrl: postUrl || tab.url || ''
  });

  if (result && result.retry) {
    await updateQueueItem(nextItem.id, {
      status: 'running',
      message: result.message || 'รอโหลดหน้ากลุ่ม…'
    });
    await appendLog({
      level: 'info',
      message: result.message || 'navigating to group',
      groupUrl: nextItem.url
    });
    await chrome.alarms.clear('fgsh-resume-timeout');
    chrome.alarms.create('fgsh-resume-timeout', { when: Date.now() + 90000 });
    return 'wait-resume';
  }

  const ok = !!(result && result.ok);
  await updateQueueItem(nextItem.id, {
    status: ok ? 'success' : 'fail',
    message: (result && result.message) || (ok ? 'สำเร็จ' : 'ล้มเหลว')
  });
  await appendLog({
    level: ok ? 'success' : 'error',
    message: (result && result.message) || (ok ? 'ok' : 'fail'),
    groupUrl: nextItem.url
  });
  return 'done';
}

async function runPostItem(nextItem, state, tab) {
  await updateQueueItem(nextItem.id, { status: 'running', message: 'กำลังโพสต์…' });

  // Navigate to the group page first (no need for an open post tab).
  const alreadyOn =
    tab.url &&
    tab.url.indexOf('/groups/') !== -1 &&
    nextItem.url &&
    tab.url.indexOf(nextItem.url.replace(/\/?$/, '').split('/').pop()) !== -1;

  if (!alreadyOn) {
    await appendLog({
      level: 'info',
      message: 'ไปหน้ากลุ่ม: ' + nextItem.url,
      groupUrl: nextItem.url
    });
    const navOk = await navigateTab(tab.id, nextItem.url);
    if (!navOk) {
      await updateQueueItem(nextItem.id, {
        status: 'fail',
        message: 'โหลดหน้ากลุ่มไม่สำเร็จ / ไม่ทัน'
      });
      await appendLog({
        level: 'error',
        message: 'navigate timeout',
        groupUrl: nextItem.url
      });
      return 'done';
    }
  }

  const images = Array.isArray(state.images) ? state.images : [];
  const result = await sendToTab(tab.id, {
    action: 'postToGroup',
    groupUrl: nextItem.url,
    body: state.postBody || '',
    hasImages: images.length > 0
    // content script reloads images from chrome.storage.local (survives navigations)
  });

  if (result && result.retry) {
    await updateQueueItem(nextItem.id, {
      status: 'running',
      message: result.message || 'รอโหลดหน้ากลุ่ม…'
    });
    await appendLog({
      level: 'info',
      message: result.message || 'post retry after nav',
      groupUrl: nextItem.url
    });
    await chrome.alarms.clear('fgsh-resume-timeout');
    chrome.alarms.create('fgsh-resume-timeout', { when: Date.now() + 90000 });
    return 'wait-resume';
  }

  const ok = !!(result && result.ok);
  await updateQueueItem(nextItem.id, {
    status: ok ? 'success' : 'fail',
    message: (result && result.message) || (ok ? 'สำเร็จ' : 'ล้มเหลว')
  });
  await appendLog({
    level: ok ? 'success' : 'error',
    message: (result && result.message) || (ok ? 'ok' : 'fail'),
    groupUrl: nextItem.url
  });
  return 'done';
}

async function runQueue() {
  const state = await getState();
  if (!state.running) return;

  const queue = state.queue || [];
  const nextItem = queue.find((q) => q.status === 'pending');

  if (!nextItem) {
    await setState({ running: false, stopRequested: false });
    await appendLog({ level: 'info', message: 'คิวว่าง — หยุดแล้ว / Queue finished' });
    return;
  }

  if (state.stopRequested) {
    await setState({ running: false, stopRequested: false });
    await appendLog({ level: 'info', message: 'หยุดตามคำขอ / Stopped by user' });
    return;
  }

  const mode = state.mode === 'post' ? 'post' : 'share';
  const verb = mode === 'post' ? 'โพสต์' : 'แชร์';

  await appendLog({
    level: 'info',
    message: 'เริ่ม' + verb + ': ' + nextItem.url,
    groupUrl: nextItem.url
  });

  const tab = await findFacebookTab();
  if (!tab) {
    await updateQueueItem(nextItem.id, {
      status: 'fail',
      message:
        mode === 'post'
          ? 'ไม่พบแท็บ Facebook — เปิด facebook.com (ล็อกอินแล้ว) ก่อน'
          : 'ไม่พบแท็บ Facebook ที่เปิดอยู่ — เปิดโพสต์บน facebook.com ก่อน'
    });
    await appendLog({
      level: 'error',
      message: 'ไม่มีแท็บ FB',
      groupUrl: nextItem.url
    });
    await finishOrContinue();
    return;
  }

  let outcome;
  if (mode === 'post') {
    const imgs = Array.isArray(state.images) ? state.images : [];
    if (!hasPostContent(state.postBody, imgs)) {
      await updateQueueItem(nextItem.id, {
        status: 'fail',
        message: 'ต้องมีข้อความหรือรูปอย่างน้อยอย่างใดอย่างหนึ่ง'
      });
      await appendLog({ level: 'error', message: 'empty postBody and images', groupUrl: nextItem.url });
      await finishOrContinue();
      return;
    }
    outcome = await runPostItem(nextItem, state, tab);
  } else {
    outcome = await runShareItem(nextItem, state, tab);
  }

  if (outcome === 'wait-resume') return;
  await finishOrContinue();
}

function persistFieldsFromMsg(msg, state) {
  const patch = {};
  if (msg.groupsText != null) patch.groupsText = msg.groupsText;
  if (msg.caption != null) patch.caption = msg.caption;
  if (msg.postBody != null) patch.postBody = msg.postBody;
  if (msg.mode != null) patch.mode = msg.mode === 'post' ? 'post' : 'share';
  if (msg.delayMin != null) patch.delayMin = Number(msg.delayMin);
  if (msg.delayMax != null) patch.delayMax = Number(msg.delayMax);
  if (msg.images != null) patch.images = normalizeImages(msg.images);
  return patch;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fgsh-next') {
    runQueue().catch((e) => console.error('runQueue', e));
  }
  if (alarm.name === 'fgsh-resume-timeout') {
    (async () => {
      const st = await getState();
      const stuck = (st.queue || []).find((q) => q.status === 'running');
      if (!stuck) return;
      await updateQueueItem(stuck.id, {
        status: 'fail',
        message: 'หมดเวลารอหลังไปหน้ากลุ่ม (resume timeout)'
      });
      await appendLog({
        level: 'error',
        message: 'resume timeout',
        groupUrl: stuck.url
      });
      if (st.running && !st.stopRequested) {
        const delayMs = randomDelayMs(st.delayMin, st.delayMax);
        chrome.alarms.create('fgsh-next', { when: Date.now() + delayMs });
      }
    })().catch((e) => console.error(e));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) {
      sendResponse({ ok: false, message: 'bad message' });
      return;
    }

    if (msg.type === 'SAVE_LIST') {
      const mode = msg.mode === 'post' ? 'post' : 'share';
      const prev = await getState();
      const images =
        msg.images != null ? normalizeImages(msg.images) : normalizeImages(prev.images);
      const postBody = msg.postBody != null ? msg.postBody : prev.postBody;
      if (mode === 'post' && !hasPostContent(postBody, images)) {
        sendResponse({
          ok: false,
          message: 'โหมดโพสต์ใหม่ต้องมีข้อความหรือรูปอย่างน้อยอย่างใดอย่างหนึ่ง'
        });
        return;
      }
      const queue = parseGroupList(msg.groupsText);
      const patch = {
        groupsText: msg.groupsText || '',
        caption: msg.caption != null ? msg.caption : prev.caption,
        postBody: postBody || '',
        images,
        mode,
        delayMin: msg.delayMin != null ? Number(msg.delayMin) : prev.delayMin,
        delayMax: msg.delayMax != null ? Number(msg.delayMax) : prev.delayMax,
        queue,
        log: []
      };
      await setState(patch);
      sendResponse({
        ok: true,
        count: queue.length,
        queue,
        imageCount: images.length
      });
      return;
    }

    if (msg.type === 'SET_MODE') {
      const st = await getState();
      if (st.running) {
        sendResponse({ ok: false, message: 'กำลังรันอยู่ — กดหยุดก่อนเปลี่ยนโหมด' });
        return;
      }
      const mode = msg.mode === 'post' ? 'post' : 'share';
      await setState({ mode });
      sendResponse({ ok: true, mode });
      return;
    }

    if (msg.type === 'GET_STATE') {
      sendResponse({ ok: true, state: await getState() });
      return;
    }

    if (msg.type === 'START') {
      const state = await getState();
      const mode = msg.mode != null ? (msg.mode === 'post' ? 'post' : 'share') : state.mode || 'share';
      const postBody = msg.postBody != null ? msg.postBody : state.postBody;
      const images =
        msg.images != null ? normalizeImages(msg.images) : normalizeImages(state.images);

      if (mode === 'post' && !hasPostContent(postBody, images)) {
        sendResponse({
          ok: false,
          message: 'โหมดโพสต์ใหม่ต้องมีข้อความหรือรูปอย่างน้อยอย่างใดอย่างหนึ่ง'
        });
        return;
      }

      let queue = state.queue || [];
      if (msg.groupsText != null) {
        queue = parseGroupList(msg.groupsText);
        await setState(
          Object.assign(persistFieldsFromMsg(msg, state), {
            mode,
            postBody: postBody || '',
            images,
            queue
          })
        );
      } else {
        await setState({ mode, postBody: postBody || '', images });
      }

      if (msg.resetStatuses) {
        queue = queue.map((q) =>
          q.status === 'success' && !msg.forceAll
            ? q
            : Object.assign({}, q, { status: 'pending', message: '' })
        );
        await setState({ queue });
      }

      const hasPending = queue.some((q) => q.status === 'pending');
      if (!hasPending) {
        sendResponse({ ok: false, message: 'ไม่มีกลุ่มในคิว — บันทึกรายการก่อน' });
        return;
      }
      await setState({ running: true, stopRequested: false });
      await appendLog({
        level: 'info',
        message:
          'เริ่มคิว / Start queue (' +
          queue.filter((q) => q.status === 'pending').length +
          ') · โหมด ' +
          (mode === 'post' ? 'โพสต์ใหม่' : 'แชร์')
      });
      sendResponse({ ok: true });
      runQueue().catch((e) => console.error(e));
      return;
    }

    if (msg.type === 'STOP') {
      await setState({ stopRequested: true });
      await chrome.alarms.clear('fgsh-next');
      await appendLog({ level: 'info', message: 'รับคำสั่งหยุด / Stop requested' });
      const st = await getState();
      const mid = (st.queue || []).some((q) => q.status === 'running');
      if (!mid) {
        await setState({ running: false, stopRequested: false });
      }
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'CLEAR_LOG') {
      await setState({ log: [] });
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'CONTENT_RESUME_RESULT') {
      const st = await getState();
      const q = (st.queue || []).find((x) => x.status === 'running' || x.url === msg.groupUrl);
      const ok = !!(msg.result && msg.result.ok);
      if (q) {
        await updateQueueItem(q.id, {
          status: ok ? 'success' : 'fail',
          message: (msg.result && msg.result.message) || (ok ? 'สำเร็จ' : 'ล้มเหลว')
        });
      }
      await appendLog({
        level: ok ? 'success' : 'error',
        message: 'resume: ' + ((msg.result && msg.result.message) || ''),
        groupUrl: msg.groupUrl
      });
      sendResponse({ ok: true });
      const after = await getState();
      if (after.running && !after.stopRequested) {
        const delayMs = randomDelayMs(after.delayMin, after.delayMax);
        await chrome.alarms.clear('fgsh-next');
        chrome.alarms.create('fgsh-next', { when: Date.now() + delayMs });
      }
      return;
    }

    sendResponse({ ok: false, message: 'unknown type' });
  })().catch((e) => {
    sendResponse({ ok: false, message: String(e.message || e) });
  });
  return true; // async
});

function dockSidePanel() {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
}

dockSidePanel();
chrome.runtime.onInstalled.addListener(dockSidePanel);

console.log('[FB Group Share Helper] service worker ready (v1.2.1)');
