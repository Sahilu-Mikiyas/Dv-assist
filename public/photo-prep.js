// Turns any photo the browser can read into a DV-sized file:
// square crop, exactly 600x600, JPEG, at most 240 KB.
// Composition (face size, background) still needs a human check.

const SIZE = 600;
const MAX_BYTES = 240 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image. Use a JPEG or PNG photo.'));
    };
    img.src = url;
  });
}

const toJpeg = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

export async function prepareDvPhoto(file) {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (Math.min(w, h) < SIZE) {
    throw new Error(`Photo is too small (${w}x${h}). It must be at least 600x600 pixels.`);
  }

  // Square crop: centered horizontally; for portrait photos, biased towards the top where the face usually is.
  const side = Math.min(w, h);
  const sx = (w - side) / 2;
  const sy = (h - side) * 0.25;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // flattens transparent PNGs onto white
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);

  for (let quality = 0.92; quality >= 0.4; quality -= 0.08) {
    const blob = await toJpeg(canvas, quality);
    if (blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Could not compress this photo under 240 KB. Try a simpler photo.');
}
