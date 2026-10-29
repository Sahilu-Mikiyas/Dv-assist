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

export function validatePhoto(buf) {
  if (buf.length > MAX_PHOTO_BYTES) throw new ValidationError(['Photo must be 240 KB or smaller']);
  const dims = jpegDimensions(buf);
  if (!dims) throw new ValidationError(['Photo must be a JPEG file']);
  if (dims.width !== PHOTO_SIZE_PX || dims.height !== PHOTO_SIZE_PX) {
    throw new ValidationError([`Photo must be 600x600 pixels (got ${dims.width}x${dims.height})`]);
  }
}
