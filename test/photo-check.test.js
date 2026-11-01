import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePhoto, findHead, suggestCrop } from '../public/photo/check.js';

// A synthetic portrait: background, an oval head (hair + face), a neck and shoulders.
// Head top-to-chin = 2 * ry. Face pixels carry a little texture so the photo reads as sharp.
function portrait({
  size = 600, width = size, height = size, bg = [248, 248, 246], cx = width / 2, top = 70, headH = 360,
  shadowLeft = 0, gray = false, blur = false, skin = [160, 112, 82],
} = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const ry = headH / 2;
  const rx = ry / 1.3;
  const cy = top + ry;
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 50; };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let c = [...bg];
      if (x < width * 0.25) c = c.map((v) => v - shadowLeft * (1 - x / (width * 0.25)));
      const inHead = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
      const inNeck = y > cy && y < cy + ry + 50 && Math.abs(x - cx) < rx * 0.45;
      const inShoulders = y >= cy + ry + 50 && Math.abs(x - cx) < rx * 2.2 + (y - cy - ry - 50);
      if (inHead) c = y < top + headH * 0.18 ? [30, 22, 18] : skin.map((v) => v + (blur ? 0 : noise()));
      else if (inNeck) c = skin;
      else if (inShoulders) c = [10, 49, 97];
      if (gray) { const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; c = [l, l, l]; }
      const i = (y * width + x) * 4;
      data.set([...c, 255], i);
    }
  }
  return { data, width, height };
}

const byId = (result) => Object.fromEntries(result.checks.map((c) => [c.id, c.level]));

test('a good photo passes every check, and the head is measured within a few percent', () => {
  const img = portrait();
  const head = findHead(img);
  assert.ok(Math.abs(head.top - 70) <= 2, `top ${head.top}`);
  assert.ok(Math.abs(head.height - 360) / 600 < 0.04, `height ${head.height}`);
  assert.ok(Math.abs(head.centerX - 300) < 6);
  const result = analyzePhoto(img);
  assert.equal(result.verdict, 'pass', JSON.stringify(result.checks));
});

test('flags a small head, a large head, a cut-off head and an off-centre head', () => {
  assert.equal(byId(analyzePhoto(portrait({ headH: 220 }))).head, 'fail');
  assert.equal(byId(analyzePhoto(portrait({ top: 30, headH: 480 }))).head, 'fail');
  assert.equal(byId(analyzePhoto(portrait({ top: -20, headH: 400 }))).head, 'fail');
  assert.equal(byId(analyzePhoto(portrait({ cx: 400 }))).center, 'fail');
});

test('flags grey, coloured and shadowed backgrounds', () => {
  assert.equal(byId(analyzePhoto(portrait({ bg: [150, 150, 150] }))).background, 'fail');
  assert.equal(byId(analyzePhoto(portrait({ bg: [120, 170, 230] }))).background, 'fail');
  const shadowed = analyzePhoto(portrait({ shadowLeft: 90 }));
  assert.notEqual(byId(shadowed).shadow, 'pass');
  assert.match(shadowed.checks.find((c) => c.id === 'shadow').en, /left/);
  // A shadow along the edge does not throw off the head measurement.
  assert.ok(Math.abs(shadowed.head.top - 70) <= 2, `top ${shadowed.head.top}`);
  assert.ok(Math.abs(shadowed.head.height - 360) / 600 < 0.04, `height ${shadowed.head.height}`);
});

test('flags black-and-white, blurry and enlarged photos', () => {
  assert.equal(byId(analyzePhoto(portrait({ gray: true }))).colour, 'fail');
  assert.equal(byId(analyzePhoto(portrait({ blur: true }))).sharp, 'warn');
  assert.equal(byId(analyzePhoto(portrait(), { sourceScale: 2 })).sharp, 'warn');
});

test('suggests a crop that puts the head at about 60% of a square', () => {
  // A wide phone photo with a small head off to the right.
  const img = portrait({ width: 1200, height: 900, cx: 800, top: 200, headH: 240 });
  const crop = suggestCrop(img);
  assert.ok(Math.abs(crop.side - 400) < 30, `side ${crop.side}`);
  assert.ok(Math.abs(crop.x + crop.side / 2 - 800) < 15);
  assert.ok(crop.y >= 0 && crop.y + crop.side <= 900);
});

test('finds no head on an empty background', () => {
  const img = portrait({ headH: 0 });
  assert.equal(findHead(img), null);
  assert.equal(byId(analyzePhoto(img)).head, 'fail');
});
