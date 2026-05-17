/**
 * storage.js — manuscript storage adapters
 *
 * Two adapters:
 *   GoogleDriveAdapter  — OAuth via Google Identity Services (GIS),
 *                         appends poems to .docx or Google Docs files
 *   LocalExportAdapter  — copies text to clipboard or downloads as .txt
 *
 * The app always calls the same public API regardless of which adapter is active:
 *   appendToManuscript(text, title)
 *   getManuscriptLink()
 */

// ─── Constants ───────────────────────────────────────────
const DRIVE_API  = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const DOCS_API   = 'https://docs.googleapis.com/v1/documents';
const DRIVE_SCOPE = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents'
].join(' ');

let accessToken  = null;
let _clientId    = null;

// ─── Public: Initialization ──────────────────────────────
export function initStorage() {
  accessToken = localStorage.getItem('drive_token') || null;
  _clientId   = localStorage.getItem('drive_client_id') || null;

  if (accessToken) showConnectedUI();
  else showDisconnectedUI();
}

// ─── Public: Google Drive OAuth ──────────────────────────

/**
 * Opens the Google account picker and requests an access token.
 * Uses Google Identity Services (GIS) implicit-grant flow.
 * The token lives for 1 hour in memory; we don't persist it for security.
 */
export function connectDrive(clientId) {
  _clientId = clientId;
  localStorage.setItem('drive_client_id', clientId);

  return new Promise((resolve, reject) => {
    if (typeof google === 'undefined' || !google?.accounts?.oauth2) {
      reject(new Error('Google Identity Services script has not loaded yet. Try again in a moment.'));
      return;
    }

    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: resp => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        accessToken = resp.access_token;
        // Do NOT store the token in localStorage — it's short-lived and sensitive.
        resolve(accessToken);
      }
    });

    client.requestAccessToken({ prompt: '' });
  });
}

export function disconnectDrive() {
  if (accessToken) google?.accounts?.oauth2?.revoke?.(accessToken, () => {});
  accessToken = null;
  localStorage.removeItem('drive_token');
  showDisconnectedUI();
}

export function isDriveConnected() {
  return !!accessToken;
}

// ─── Public: List manuscript files ───────────────────────

/**
 * Lists Google Docs and .docx files from the user's Drive.
 * Returns array of { id, name, mimeType }.
 */
export async function listManuscripts() {
  const q = encodeURIComponent(
    "(mimeType='application/vnd.google-apps.document' " +
    "or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document') " +
    "and trashed=false"
  );
  const res = await driveGet(`/files?q=${q}&fields=files(id,name,mimeType)&pageSize=50`);
  return res.files || [];
}

// ─── Public: Append poem ─────────────────────────────────

/**
 * Main function called by app.js after user clicks "Add to Manuscript".
 * Detects file type and routes to the correct adapter.
 *
 * @param {string} fileId    Google Drive file ID
 * @param {string} mimeType  MIME type of the target file
 * @param {string} text      Transcribed + edited poem text
 * @param {string} [title]   Optional title line
 * @returns {Promise<string>} URL to the file on Drive
 */
export async function appendToManuscript(fileId, mimeType, text, title = '') {
  if (mimeType === 'application/vnd.google-apps.document') {
    await appendToGoogleDoc(fileId, text, title);
  } else {
    await appendToDocx(fileId, text, title);
  }
  return `https://drive.google.com/file/d/${fileId}/view`;
}

// ─── Local Export (fallback / no Drive) ──────────────────

export async function exportLocal(text, title = '') {
  const content = title ? `${title}\n\n${text}` : text;

  // 1. Try clipboard first
  try {
    await navigator.clipboard.writeText(content);
    return { method: 'clipboard' };
  } catch { /* clipboard may be blocked */ }

  // 2. Fall back to file download
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (title || 'poem') + '.txt';
  a.click();
  URL.revokeObjectURL(url);
  return { method: 'download' };
}

// ─── Google Docs append ───────────────────────────────────

async function appendToGoogleDoc(docId, text, title) {
  // Get current document to find the end index
  const doc = await fetch(`${DOCS_API}/${docId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }).then(r => r.json());

  // The last element's endIndex - 1 = last valid insertion point
  const content = doc.body?.content || [];
  const lastEl  = content[content.length - 1];
  const endIndex = (lastEl?.endIndex ?? 2) - 1;

  const separator  = '\n\n────────────────────\n\n';
  const fullText   = title ? `${title}\n\n${text}` : text;
  const insertText = separator + fullText + '\n';

  await fetch(`${DOCS_API}/${docId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [{ insertText: { location: { index: endIndex }, text: insertText } }]
    })
  }).then(assertOk);
}

// ─── .docx append via JSZip ───────────────────────────────

/**
 * Downloads the .docx, injects new paragraphs directly into the XML,
 * and re-uploads. Works because .docx is a ZIP of XML files.
 *
 * The relevant file inside the ZIP is: word/document.xml
 * We insert new <w:p> elements just before the closing </w:body> tag.
 */
async function appendToDocx(fileId, text, title) {
  // 1. Download the file as ArrayBuffer
  const arrayBuf = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  }).then(r => r.arrayBuffer());

  // 2. Open the ZIP with JSZip (loaded via CDN in index.html)
  const zip     = new JSZip();           // JSZip is a global from CDN
  await zip.loadAsync(arrayBuf);

  // 3. Read document.xml
  let docXml = await zip.file('word/document.xml').async('string');

  // 4. Build new paragraphs
  const separator = buildDocxParagraph('────────────────────');
  const spacer    = buildDocxParagraph('');
  const titlePara = title ? buildDocxParagraph(title, { bold: true }) : '';
  const poemParas = text.split('\n').map(line => buildDocxParagraph(line)).join('');
  const newXml    = separator + spacer + titlePara + poemParas;

  // 5. Inject before </w:body>
  docXml = docXml.replace('</w:body>', newXml + '</w:body>');
  zip.file('word/document.xml', docXml);

  // 6. Re-generate the ZIP as ArrayBuffer
  const newDocx = await zip.generateAsync({ type: 'arraybuffer' });

  // 7. Upload (PATCH overwrites the file content, keeps the same file ID)
  await fetch(`${UPLOAD_API}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    },
    body: newDocx
  }).then(assertOk);
}

/** Builds a single OOXML paragraph element. */
function buildDocxParagraph(text, opts = {}) {
  const rPr = opts.bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : '';
  const safe = escXml(text);
  return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
}

function escXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Drive API helpers ────────────────────────────────────

async function driveGet(path) {
  const res = await fetch(`${DRIVE_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  await assertOk(res);
  return res.json();
}

async function assertOk(res) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Drive API error: ${msg}`);
  }
  return res;
}

// ─── UI helpers ───────────────────────────────────────────

function showConnectedUI() {
  document.getElementById('drive-connect-area')?.classList.add('hidden');
  document.getElementById('drive-connected-area')?.classList.remove('hidden');
}

function showDisconnectedUI() {
  document.getElementById('drive-connect-area')?.classList.remove('hidden');
  document.getElementById('drive-connected-area')?.classList.add('hidden');
}
