/**
 * app.js — main application controller
 *
 * This is the entry point. It:
 *   1. Manages which screen is visible
 *   2. Holds the shared application state (uploaded files, transcriptions, current page)
 *   3. Binds all UI events
 *   4. Calls upload.js → transcribe.js → editor.js → storage.js in sequence
 */

import { initUpload, getFiles, clearFiles }         from './upload.js';
import { transcribeImages }                          from './transcribe.js';
import { initEditor, loadPage, getCurrentText }      from './editor.js';
import { initStorage, connectDrive, disconnectDrive,
         openPickerForManuscript, appendToManuscript,
         isDriveConnected, exportLocal }             from './storage.js';
import { initDrafts, saveDraft, renderHistory }      from './draft.js';

// ─── Application State ────────────────────────────────────
const state = {
  pages: [],          // Array of { file, photoUrl, text }
  currentPage: 0,     // Which page is shown in the editor
  manuscript: {       // Currently selected manuscript
    id: null,
    name: null,
    mimeType: null
  }
};

// ─── Boot ─────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  loadSavedSettings();
  initUpload();
  initEditor();
  initStorage();
  initDrafts(loadDraftIntoEditor);
  bindEvents();
  registerServiceWorker();

  // If API key is already saved, go straight to upload screen
  const hasKey = !!localStorage.getItem('gemini_key');
  navigate(hasKey ? 'upload' : 'settings');
});

// ─── Screen Navigation ────────────────────────────────────
function navigate(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  const target = document.getElementById(`screen-${screenName}`);
  if (target) target.classList.remove('hidden');
}

// ─── Settings ─────────────────────────────────────────────
function loadSavedSettings() {
  const key      = localStorage.getItem('gemini_key') || '';
  const clientId = localStorage.getItem('drive_client_id') || '';
  const apiKey   = localStorage.getItem('drive_api_key') || '';
  const msId     = localStorage.getItem('manuscript_id') || '';
  const msName   = localStorage.getItem('manuscript_name') || '';
  const msMime   = localStorage.getItem('manuscript_mime') || '';

  if (key)      document.getElementById('gemini-key').value      = key;
  if (clientId) document.getElementById('drive-client-id').value = clientId;
  if (apiKey)   document.getElementById('drive-api-key').value   = apiKey;

  if (msId) {
    state.manuscript = { id: msId, name: msName, mimeType: msMime };
    const el = document.getElementById('manuscript-selected-name');
    if (el) el.textContent = `📄 ${msName}`;
  }
}

// ─── Event Binding ────────────────────────────────────────
function bindEvents() {
  // ── Back buttons ──────────────────────────────────────
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.target));
  });

  // ── Settings screen ───────────────────────────────────
  document.getElementById('btn-save-key').addEventListener('click', () => {
    const val = document.getElementById('gemini-key').value.trim();
    if (!val) return alert('Please paste your Gemini API key.');
    localStorage.setItem('gemini_key', val);
    showToast('API key saved ✓');
  });

  document.getElementById('btn-save-drive-id').addEventListener('click', () => {
    const val = document.getElementById('drive-client-id').value.trim();
    if (!val) return alert('Please paste your Google Client ID.');
    localStorage.setItem('drive_client_id', val);
    showToast('Client ID saved ✓');
  });

  document.getElementById('btn-save-api-key').addEventListener('click', () => {
    const val = document.getElementById('drive-api-key').value.trim();
    if (!val) return alert('Please paste your Google API Key.');
    localStorage.setItem('drive_api_key', val);
    showToast('API Key saved ✓');
  });

  document.getElementById('btn-connect-drive').addEventListener('click', handleConnectDrive);
  document.getElementById('btn-disconnect-drive').addEventListener('click', handleDisconnectDrive);
  document.getElementById('btn-pick-manuscript').addEventListener('click', handlePickManuscript);

  document.getElementById('btn-start').addEventListener('click', () => {
    const key = localStorage.getItem('gemini_key');
    if (!key) {
      document.getElementById('start-hint').style.display = 'block';
      document.getElementById('gemini-key').focus();
      return;
    }
    navigate('upload');
  });

  // ── Upload screen ─────────────────────────────────────
  document.getElementById('btn-transcribe').addEventListener('click', handleTranscribe);

  // ── History drawer ────────────────────────────────────
  document.getElementById('btn-history').addEventListener('click', () => {
    renderHistory(loadDraftIntoEditor);
    document.getElementById('history-drawer').classList.remove('hidden');
  });
  document.getElementById('btn-close-history').addEventListener('click', () => {
    document.getElementById('history-drawer').classList.add('hidden');
  });

  // ── Edit screen ───────────────────────────────────────
  document.getElementById('btn-prev-page').addEventListener('click', () => changePage(-1));
  document.getElementById('btn-next-page').addEventListener('click', () => changePage(1));
  document.getElementById('btn-save-draft').addEventListener('click', handleSaveDraft);
  document.getElementById('btn-copy-text').addEventListener('click', handleCopyText);
  document.getElementById('btn-share-text').addEventListener('click', handleShareText);
  document.getElementById('btn-add-manuscript').addEventListener('click', handleAddToManuscript);

  // ── Success overlay ───────────────────────────────────
  document.getElementById('btn-new-poem').addEventListener('click', () => {
    document.getElementById('success-overlay').classList.add('hidden');
    clearFiles();
    state.pages = [];
    state.currentPage = 0;
    navigate('upload');
  });
}

// ─── Google Drive ─────────────────────────────────────────
async function handleConnectDrive() {
  const clientId = document.getElementById('drive-client-id').value.trim()
                   || localStorage.getItem('drive_client_id');
  if (!clientId) {
    alert('Please enter your Google Client ID first.');
    document.getElementById('drive-client-id').focus();
    return;
  }

  const btn = document.getElementById('btn-connect-drive');
  btn.textContent = 'Connecting…';
  btn.disabled = true;

  try {
    await connectDrive(clientId);
    showToast('Google Drive connected ✓');
    document.getElementById('drive-connect-area').classList.add('hidden');
    document.getElementById('drive-connected-area').classList.remove('hidden');
    startSessionTimer();
  } catch (err) {
    alert(`Connection failed: ${err.message}`);
  } finally {
    btn.textContent = '☁ Connect Google Drive';
    btn.disabled = false;
  }
}

function handleDisconnectDrive() {
  disconnectDrive();
  document.getElementById('drive-connect-area').classList.remove('hidden');
  document.getElementById('drive-connected-area').classList.add('hidden');
}

async function handlePickManuscript() {
  const apiKey = localStorage.getItem('drive_api_key');
  if (!apiKey) {
    alert('Please save your Google API Key in settings first.');
    document.getElementById('drive-api-key').focus();
    return;
  }

  try {
    const file = await openPickerForManuscript(apiKey);
    state.manuscript = { id: file.id, name: file.name, mimeType: file.mimeType };
    localStorage.setItem('manuscript_id',   file.id);
    localStorage.setItem('manuscript_name', file.name);
    localStorage.setItem('manuscript_mime', file.mimeType);

    document.getElementById('manuscript-selected-name').textContent = `📄 ${file.name}`;
    showToast(`Manuscript set: ${file.name}`);
  } catch (err) {
    if (err.message !== 'cancelled') alert(`Could not pick file: ${err.message}`);
  }
}

// ─── Transcription Flow ───────────────────────────────────
async function handleTranscribe() {
  const files = getFiles();
  if (!files.length) return alert('Please select at least one photo first.');

  const apiKey = localStorage.getItem('gemini_key');
  if (!apiKey) {
    alert('Please add your Gemini API key in settings.');
    navigate('settings');
    return;
  }

  navigate('processing');
  setProgress(0, 'Preparing…');

  try {
    state.pages = await transcribeImages(files, apiKey, (current, total, status) => {
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      setProgress(pct, status);
      document.getElementById('processing-page').textContent =
        total > 1 ? `${current} of ${total} pages` : '';
    });

    state.currentPage = 0;
    navigate('edit');
    refreshEditorPage();
    updatePageNav();
  } catch (err) {
    alert(`Transcription error: ${err.message}`);
    navigate('upload');
  }
}

function setProgress(pct, status) {
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('processing-status').textContent = status;
}

// ─── Editor Page Management ───────────────────────────────
function refreshEditorPage() {
  const page = state.pages[state.currentPage];
  if (!page) return;
  loadPage({ photoUrl: page.photoUrl, text: page.text });
}

function changePage(delta) {
  // Save current text before leaving the page
  if (state.pages[state.currentPage]) {
    state.pages[state.currentPage].text = getCurrentText();
  }

  const next = state.currentPage + delta;
  if (next < 0 || next >= state.pages.length) return;

  state.currentPage = next;
  refreshEditorPage();
  updatePageNav();
}

function updatePageNav() {
  const total = state.pages.length;
  const nav   = document.getElementById('page-nav');
  nav.classList.toggle('hidden', total <= 1);

  document.getElementById('page-indicator').textContent =
    `Page ${state.currentPage + 1} of ${total}`;
  document.getElementById('btn-prev-page').disabled = state.currentPage === 0;
  document.getElementById('btn-next-page').disabled = state.currentPage === total - 1;
}

// ─── Save Draft ───────────────────────────────────────────
function handleSaveDraft() {
  const text     = getCurrentText();
  const page     = state.pages[state.currentPage];
  const photoUrl = page?.photoUrl || '';

  if (!text.trim()) return alert('Nothing to save — text is empty.');
  saveDraft({ text, photoUrl });
  showToast('Draft saved ✓');
}

function loadDraftIntoEditor(draft) {
  document.getElementById('history-drawer').classList.add('hidden');

  // Create a synthetic page from the draft
  state.pages = [{ file: null, photoUrl: draft.photoUrl, text: draft.text }];
  state.currentPage = 0;
  navigate('edit');
  refreshEditorPage();
  updatePageNav();
}

// ─── Copy & Share ─────────────────────────────────────────

async function handleCopyText() {
  const text = getCurrentText();
  if (!text.trim()) return showToast('Nothing to copy yet');

  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard ✓');
  } catch {
    // Fallback for browsers/contexts that block the Clipboard API
    const el    = document.createElement('textarea');
    el.value    = text;
    el.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('Copied ✓');
  }
}

async function handleShareText() {
  const text  = getCurrentText();
  if (!text.trim()) return showToast('Nothing to share yet');

  const title = text.split('\n')[0]?.slice(0, 60) || 'My Poem';

  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      // navigator.share resolves when the user completes the share
      // If they cancel, it throws an AbortError — that's fine, do nothing
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Share failed');
    }
  } else {
    // Desktop browsers that don't support Web Share API yet
    // Fall back to clipboard + inform the user
    await handleCopyText();
    showToast('Copied — paste into your email or chat');
  }
}

// ─── Add to Manuscript ────────────────────────────────────
async function handleAddToManuscript() {
  // Collect all edited pages
  if (state.pages[state.currentPage]) {
    state.pages[state.currentPage].text = getCurrentText();
  }

  const fullText  = state.pages.map(p => p.text).join('\n\n');
  const title     = fullText.trim().split('\n')[0]?.slice(0, 80) || '';
  const btn       = document.getElementById('btn-add-manuscript');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    if (isDriveConnected() && state.manuscript.id) {
      await appendToManuscript(
        state.manuscript.id,
        state.manuscript.mimeType,
        fullText,
        title
      );
      showSuccess(
        `Added to "${state.manuscript.name}"`,
        `https://drive.google.com/file/d/${state.manuscript.id}/view`
      );
    } else {
      const result = await exportLocal(fullText, title);
      const msg = result.method === 'clipboard'
        ? 'Copied to clipboard!'
        : 'Downloaded as .txt file';
      showSuccess(msg, null);
    }
  } catch (err) {
    alert(`Save failed: ${err.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Add to Manuscript →';
  }
}

function showSuccess(message, driveUrl) {
  document.getElementById('success-message').textContent = message;

  const driveBtn = document.getElementById('btn-open-drive');
  if (driveUrl) {
    driveBtn.href = driveUrl;
    driveBtn.style.display = 'block';
    driveBtn.classList.remove('hidden');
  } else {
    driveBtn.style.display = 'none';
  }

  document.getElementById('success-overlay').classList.remove('hidden');
}

// ─── Toast notification ───────────────────────────────────
function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      background:#d4a853; color:#0f0f1a; padding:10px 20px;
      border-radius:20px; font-size:14px; font-weight:600;
      z-index:9999; pointer-events:none; transition:opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ─── Drive Session Timer ──────────────────────────────────
// Google access tokens expire after 60 minutes.
// At 55 min we warn the user; at 60 min we tell them the session ended.
let _sessionTimer = null;

function startSessionTimer() {
  clearTimeout(_sessionTimer);
  const WARN_MS = 55 * 60 * 1000;
  const END_MS  = 60 * 60 * 1000;

  _sessionTimer = setTimeout(() => {
    showBanner(
      '⏱ Drive session expires in 5 minutes. Finish editing or copy your text now.',
      'warning'
    );
    setTimeout(() => {
      showBanner(
        '🔒 Drive session ended. Copy your text, then reconnect Google Drive to save.',
        'error'
      );
    }, 5 * 60 * 1000);
  }, WARN_MS);
}

function showBanner(message, type = 'warning') {
  let banner = document.getElementById('session-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'session-banner';
    banner.style.cssText = `
      position:fixed; top:0; left:0; right:0; z-index:9998;
      padding:12px 16px; font-size:13px; font-weight:600;
      text-align:center; cursor:pointer;
    `;
    banner.addEventListener('click', () => banner.remove());
    document.body.appendChild(banner);
  }
  banner.textContent = message + '  ✕';
  banner.style.background = type === 'error' ? '#b91c1c' : '#92400e';
  banner.style.color = '#fff';
}

// ─── Service Worker ───────────────────────────────────────
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(console.error);
  }
}
