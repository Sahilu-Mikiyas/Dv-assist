// Passport scans: any photo of the passport page becomes a JPEG at most 1600 px on its long side and about
// 1 MB, small enough to upload on mobile data and sharp enough to read the machine-readable lines.

import { loadImage } from '/photo/editor.js';

const MAX_SIDE = 1600;
const MIN_SIDE = 800;
const MAX_BYTES = 1000 * 1024;

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

export async function prepareScan(file) {
  const img = await loadImage(file);
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  if (long < MIN_SIDE) {
    throw new Error(`This picture is too small to read (${img.naturalWidth}×${img.naturalHeight}). Take the photo closer, filling the screen with the page.`);
  }
  const scale = Math.min(1, MAX_SIDE / long);
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale),
  });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (let quality = 0.9; quality >= 0.5; quality -= 0.1) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Could not make this picture small enough. Try a photo with less background.');
}
