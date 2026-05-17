/**
 * draft.js — localStorage draft history
 *
 * Each draft: { id, title, text, photoUrl, savedAt }
 * All drafts live under one localStorage key as a JSON array.
 */

const STORAGE_KEY = 'poetry_drafts';

export function getDrafts() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveDraft({ text, photoUrl }) {
  const drafts = getDrafts();
  const firstLine = text.trim().split('\n')[0] || 'Untitled';
  const draft = {
    id: Date.now().toString(),
    title: firstLine.slice(0, 60),
    text,
    photoUrl,
    savedAt: new Date().toISOString()
  };
  drafts.unshift(draft);             // newest first
  if (drafts.length > 50) drafts.pop(); // cap at 50
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  return draft;
}

export function deleteDraft(id) {
  const drafts = getDrafts().filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
}

export function formatDate(isoString) {
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function initDrafts(onLoad) {
  renderHistory(onLoad);
}

export function renderHistory(onLoad) {
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const drafts = getDrafts();

  list.innerHTML = '';
  empty.classList.toggle('hidden', drafts.length > 0);

  drafts.forEach(draft => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.innerHTML = `
      <img class="history-thumb" src="${draft.photoUrl || ''}"
           alt="" onerror="this.style.display='none'">
      <div class="history-info">
        <div class="history-title">${escHtml(draft.title)}</div>
        <div class="history-date">${formatDate(draft.savedAt)}</div>
        <div class="history-preview">${escHtml(draft.text.slice(0, 120))}</div>
      </div>
      <button class="history-delete" data-id="${draft.id}" title="Delete">✕</button>
    `;

    // Load draft into editor
    li.querySelector('.history-info').addEventListener('click', () => {
      onLoad(draft);
    });

    // Delete draft
    li.querySelector('.history-delete').addEventListener('click', e => {
      e.stopPropagation();
      deleteDraft(draft.id);
      renderHistory(onLoad);
    });

    list.appendChild(li);
  });
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
