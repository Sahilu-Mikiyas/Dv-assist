// DV photo file rules: JPEG, exactly 600x600 pixels, at most 240 KB.
// Composition (background, head size, glasses) still needs a human check.

import { ValidationError } from './case.js';

export const MAX_PHOTO_BYTES = 240 * 1024;
export const PHOTO_SIZE_PX = 600;

// Reads width/height from the JPEG start-of-frame marker. Returns null if not a JPEG.
export function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const length = buf.readUInt16BE(i + 2);
    // SOF0..SOF15, excluding DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

// A whole JPEG ends with the end-of-image marker; a header glued onto other content does not.
const isCompleteJpeg = (buf) => buf.length > 4 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9;

export function validatePhoto(buf) {
  if (buf.length > MAX_PHOTO_BYTES) throw new ValidationError(['Photo must be 240 KB or smaller']);
  const dims = jpegDimensions(buf);
  if (!dims || !isCompleteJpeg(buf)) throw new ValidationError(['Photo must be a JPEG file']);
  if (dims.width !== PHOTO_SIZE_PX || dims.height !== PHOTO_SIZE_PX) {
    throw new ValidationError([`Photo must be 600x600 pixels (got ${dims.width}x${dims.height})`]);
  }
}

// Passport scans: a readable JPEG, prepared in the browser (long side up to 1600 px, about 1 MB at most).
export const MAX_DOCUMENT_BYTES = 1536 * 1024;
const MIN_DOCUMENT_SIDE_PX = 800;

export function validateDocument(buf) {
  if (buf.length > MAX_DOCUMENT_BYTES) throw new ValidationError(['Passport scan must be 1.5 MB or smaller']);
  const dims = jpegDimensions(buf);
  if (!dims || !isCompleteJpeg(buf)) throw new ValidationError(['Passport scan must be a JPEG image']);
  if (Math.max(dims.width, dims.height) < MIN_DOCUMENT_SIDE_PX) {
    throw new ValidationError([`Passport scan is too small to read (${dims.width}x${dims.height}). Take it closer, in good light.`]);
  }
}
