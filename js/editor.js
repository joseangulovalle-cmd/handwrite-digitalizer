/**
 * editor.js — manages the three edit modes (A, B, C)
 *
 * Mode A: side-by-side split (photo left, text right)
 * Mode B: text focus (full-width textarea, small photo strip on top)
 * Mode C: document view (contenteditable div, word-processor feel)
 *
 * All three modes show the same text. Switching modes syncs the content
 * so the user never loses edits.
 */

let currentMode = 'A';

// Cached DOM references
const photoEls  = { A: null, B: null, C: null };
const textEls   = { A: null, B: null, C: null };

export function initEditor() {
  photoEls.A = document.getElementById('photo-A');
  photoEls.B = document.getElementById('photo-B');
  photoEls.C = document.getElementById('photo-C');

  textEls.A  = document.getElementById('text-A');
  textEls.B  = document.getElementById('text-B');
  textEls.C  = document.getElementById('text-C'); // contenteditable div

  // Mode tab switching
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => switchMode(tab.dataset.mode));
  });

  // Doc toolbar (Mode C) — execCommand still works for basic formatting
  document.querySelectorAll('.doc-tool').forEach(btn => {
    btn.addEventListener('click', () => {
      document.execCommand(btn.dataset.cmd, false, null);
      btn.classList.toggle('active');
    });
  });
}

/**
 * Load a page (photo + text) into the editor.
 * Called by app.js whenever the current page changes.
 */
export function loadPage({ photoUrl, text }) {
  // Set photo in all three modes
  [photoEls.A, photoEls.B, photoEls.C].forEach(el => {
    if (el) el.src = photoUrl || '';
  });

  // Set text in all three modes
  textEls.A.value  = text || '';
  textEls.B.value  = text || '';
  textEls.C.innerText = text || '';  // innerText preserves line breaks

  // Focus the active textarea
  focusActive();
}

/**
 * Read the current text from whichever mode is active.
 * Always call this before navigating away or saving.
 */
export function getCurrentText() {
  if (currentMode === 'C') {
    return textEls.C.innerText.trim();
  }
  return textEls[currentMode].value.trim();
}

function switchMode(newMode) {
  // 1. Grab text from current mode
  const text = getCurrentText();

  // 2. Write it to all modes so they stay in sync
  textEls.A.value  = text;
  textEls.B.value  = text;
  textEls.C.innerText = text;

  // 3. Update tab UI
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === newMode);
    t.setAttribute('aria-selected', t.dataset.mode === newMode);
  });

  // 4. Show/hide mode panels
  ['A', 'B', 'C'].forEach(m => {
    document.getElementById(`mode-${m}`).classList.toggle('hidden', m !== newMode);
  });

  currentMode = newMode;
  focusActive();
}

function focusActive() {
  if (currentMode === 'C') {
    textEls.C.focus();
  } else {
    textEls[currentMode]?.focus();
  }
}
