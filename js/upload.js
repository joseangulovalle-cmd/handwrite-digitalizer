/**
 * upload.js — file and camera capture
 *
 * Manages the list of selected files, renders thumbnail previews,
 * and exposes getFiles() so app.js can pass them to transcribe.js.
 */

let selectedFiles = [];

export function getFiles() {
  return selectedFiles;
}

export function clearFiles() {
  selectedFiles = [];
  renderPreviews();
}

export function initUpload() {
  // All three inputs funnel into the same handler
  const inputs = [
    document.getElementById('file-input-zone'),
    document.getElementById('file-input-camera'),
    document.getElementById('file-input-gallery')
  ];
  inputs.forEach(el => el.addEventListener('change', e => addFiles(e.target.files)));

  // Drag-and-drop on the drop zone
  const zone = document.getElementById('drop-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    addFiles(e.dataTransfer.files);
  });

  document.getElementById('btn-clear-files').addEventListener('click', clearFiles);
}

function addFiles(fileList) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  const incoming = Array.from(fileList).filter(f => allowed.includes(f.type));
  selectedFiles = [...selectedFiles, ...incoming];
  renderPreviews();
}

function renderPreviews() {
  const container = document.getElementById('preview-thumbnails');
  const section   = document.getElementById('file-preview');

  section.classList.toggle('hidden', selectedFiles.length === 0);
  container.innerHTML = '';

  selectedFiles.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'thumb-item';

    if (file.type === 'application/pdf') {
      item.innerHTML = `
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:28px">📄</div>
        <span class="thumb-number">${i + 1}</span>
        <button class="thumb-remove" data-index="${i}">✕</button>`;
    } else {
      const url = URL.createObjectURL(file);
      item.innerHTML = `
        <img src="${url}" alt="Photo ${i + 1}">
        <span class="thumb-number">${i + 1}</span>
        <button class="thumb-remove" data-index="${i}">✕</button>`;
    }

    item.querySelector('.thumb-remove').addEventListener('click', e => {
      e.stopPropagation();
      selectedFiles.splice(Number(e.target.dataset.index), 1);
      renderPreviews();
    });

    container.appendChild(item);
  });
}

/**
 * Returns a base64 data URL for a given File.
 * Used by transcribe.js before sending to Gemini.
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result = "data:image/jpeg;base64,/9j/4AAQ..."
      // We need only the part after the comma
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Returns an object-URL string for showing a file in an <img> tag.
 * Object URLs are temporary — they live as long as the browser tab.
 */
export function fileToObjectURL(file) {
  return URL.createObjectURL(file);
}
