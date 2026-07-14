/**
 * Banknote asset pipeline — turns the raw TZS note scans in Motivations/
 * into web-ready WebP renditions + a manifest with LQIP placeholders.
 *
 * Per note: trim scan margins, round corners, export WebP @ 240/480/960 wide,
 * plus a 16px LQIP embedded in public/notes/manifest.json as a data URI.
 *
 * Run: npm run notes:prep
 */
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SRC_DIR = path.resolve('Motivations');
const OUT_DIR = path.resolve('public/notes');
const WIDTHS = [240, 480, 960];
const RADIUS_RATIO = 0.035; // corner radius as fraction of width

/** Match "1k Note Front.png" / "2K Note Back.png" / "10k Note back.png" (case-messy) */
const NOTE_RE = /^(1k|2k|5k|10k)\s+note\s+(front|back)\.png$/i;

const files = (await readdir(SRC_DIR)).filter((f) => NOTE_RE.test(f));
if (files.length === 0) {
  console.error(`No note scans found in ${SRC_DIR}`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

const manifest = {};

for (const file of files.sort()) {
  const [, rawDenom, rawSide] = file.match(NOTE_RE);
  const denom = rawDenom.toLowerCase();
  const side = rawSide.toLowerCase();

  // Trim the scan margin (white or dark border), keep the note rectangle.
  const trimmed = await sharp(path.join(SRC_DIR, file))
    .trim({ threshold: 25 })
    .toBuffer();
  const { width: tw, height: th } = await sharp(trimmed).metadata();

  const entry = (manifest[denom] ??= {});
  const sideEntry = { aspect: +(tw / th).toFixed(4), srcs: {} };
  entry[side] = sideEntry;

  for (const w of WIDTHS) {
    const width = Math.min(w, tw);
    const height = Math.round(width * (th / tw));
    const r = Math.round(width * RADIUS_RATIO);
    const mask = Buffer.from(
      `<svg width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" rx="${r}" ry="${r}" fill="#fff"/></svg>`
    );
    const name = `${denom}-${side}-${w}.webp`;
    await sharp(trimmed)
      .resize(width, height)
      .composite([{ input: mask, blend: 'dest-in' }])
      .webp({ quality: 82, alphaQuality: 90 })
      .toFile(path.join(OUT_DIR, name));
    sideEntry.srcs[w] = `/notes/${name}`;
  }

  // LQIP: 16px wide blurred placeholder as data URI
  const lqip = await sharp(trimmed)
    .resize(16)
    .blur(1)
    .webp({ quality: 40 })
    .toBuffer();
  sideEntry.lqip = `data:image/webp;base64,${lqip.toString('base64')}`;

  console.log(`✓ ${denom} ${side}  (${tw}×${th} → ${WIDTHS.join('/')})`);
}

await writeFile(
  path.join(OUT_DIR, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);
console.log(`\nWrote ${path.join(OUT_DIR, 'manifest.json')} — ${files.length} scans processed.`);
