/**
 * transcribe.js — Gemini Vision API integration
 *
 * Takes an array of File objects, sends each one to Gemini 1.5 Flash,
 * and returns an array of transcribed text strings.
 */

import { fileToBase64, fileToObjectURL } from './upload.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const PROMPT = `You are transcribing handwritten poetry.
Transcribe the handwritten text in this image exactly as written.
Preserve all line breaks, stanza breaks (blank lines between groups), punctuation, and spacing.
If a word is unclear, make your best attempt and do not add notes or brackets.
Output ONLY the transcribed text — no preamble, no explanation, no quotes.`;

/**
 * Transcribes an array of image files using Gemini Vision.
 *
 * @param {File[]} files
 * @param {string} apiKey
 * @param {function} onProgress  called with (current, total, statusText)
 * @returns {Promise<Array<{file, photoUrl, text}>>}
 */
export async function transcribeImages(files, apiKey, onProgress) {
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress(i, files.length, `Reading page ${i + 1} of ${files.length}…`);

    const text = await transcribeSingle(file, apiKey);
    results.push({
      file,
      photoUrl: fileToObjectURL(file),
      text
    });
  }

  onProgress(files.length, files.length, 'Done!');
  return results;
}

async function transcribeSingle(file, apiKey) {
  if (file.type === 'application/pdf') {
    // PDFs: convert pages to images client-side is complex.
    // For MVP: send first page as image via canvas trick, or ask user to use image instead.
    // We'll attempt it as an inline_data with PDF mime type — Gemini handles PDFs.
    return transcribeWithMime(file, 'application/pdf', apiKey);
  }
  return transcribeWithMime(file, file.type, apiKey);
}

async function transcribeWithMime(file, mimeType, apiKey) {
  const base64Data = await fileToBase64(file);

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Data
          }
        },
        { text: PROMPT }
      ]
    }],
    generationConfig: {
      temperature: 0.1,   // low = more literal, less creative
      maxOutputTokens: 2048
    }
  };

  const response = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gemini API error: ${msg}`);
  }

  const data = await response.json();

  // Gemini returns: data.candidates[0].content.parts[0].text
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text. Check your API key and try again.');

  return text.trim();
}
