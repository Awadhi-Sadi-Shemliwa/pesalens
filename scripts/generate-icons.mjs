#!/usr/bin/env node
/**
 * generate-icons.mjs
 *
 * Reads brand/logo.svg + brand/logo-maskable.svg and emits every
 * raster size we need for PWA install prompts and the Capacitor APK.
 *
 * Outputs:
 *   public/icon-192.png            (PWA "any" purpose)
 *   public/icon-512.png            (PWA "any" purpose)
 *   public/icon-maskable-192.png   (PWA "maskable" purpose)
 *   public/icon-maskable-512.png   (PWA "maskable" purpose)
 *   public/apple-touch-icon.png    (iOS Add-to-Home, 180×180)
 *   public/favicon.svg             (copied from brand)
 *   public/favicon-32.png          (legacy browser tab)
 *   public/favicon-16.png          (legacy browser tab)
 *   PesaLens-MobileAPP/android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/
 *     ic_launcher.png  + ic_launcher_round.png  + ic_launcher_foreground.png
 *
 * Run:  node scripts/generate-icons.mjs
 */

import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const brand = join(root, "brand");
const publicDir = join(root, "public");
const androidRes = join(root, "PesaLens-MobileAPP/android/app/src/main/res");

const masterSvg = join(brand, "logo.svg");
const maskSvg = join(brand, "logo-maskable.svg");

const ANDROID_ICON_PX = {
  // ic_launcher / ic_launcher_round (legacy launcher icons + as-is on
  // pre-Oreo devices). Apex sizes per density bucket.
  "mipmap-mdpi":    48,
  "mipmap-hdpi":    72,
  "mipmap-xhdpi":   96,
  "mipmap-xxhdpi":  144,
  "mipmap-xxxhdpi": 192,
};
// Adaptive icon foreground is rendered in a 108dp×108dp area, of which
// the centre 72dp is the safe zone. We render the maskable SVG full-bleed
// at the launcher pixel size — Android will composite it over the
// background colour drawable.
const ANDROID_FG_PX = {
  "mipmap-mdpi":    108,
  "mipmap-hdpi":    162,
  "mipmap-xhdpi":   216,
  "mipmap-xxhdpi":  324,
  "mipmap-xxxhdpi": 432,
};

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function pngFromSvg(svgPath, outPath, size) {
  await ensure(dirname(outPath));
  await sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: "cover" })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(` → ${outPath} (${size}×${size})`);
}

async function pngRoundFromSvg(svgPath, outPath, size) {
  // Circular crop for ic_launcher_round.png. We render to a square then
  // composite a circular alpha mask so the corners go transparent.
  await ensure(dirname(outPath));
  const square = await sharp(svgPath, { density: 384 })
    .resize(size, size, { fit: "cover" })
    .png()
    .toBuffer();
  const r = Math.floor(size / 2);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${r}" cy="${r}" r="${r}" fill="#fff"/></svg>`
  );
  await sharp(square)
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  console.log(` → ${outPath} (${size}×${size}, round)`);
}

async function main() {
  console.log("Generating PWA icons in public/");
  await ensure(publicDir);

  await pngFromSvg(maskSvg, join(publicDir, "icon-192.png"), 192);
  await pngFromSvg(maskSvg, join(publicDir, "icon-512.png"), 512);
  await pngFromSvg(maskSvg, join(publicDir, "icon-maskable-192.png"), 192);
  await pngFromSvg(maskSvg, join(publicDir, "icon-maskable-512.png"), 512);
  await pngFromSvg(maskSvg, join(publicDir, "apple-touch-icon.png"), 180);
  await pngFromSvg(maskSvg, join(publicDir, "favicon-32.png"), 32);
  await pngFromSvg(maskSvg, join(publicDir, "favicon-16.png"), 16);

  // Modern browsers prefer SVG favicons. Copy the master directly.
  await copyFile(masterSvg, join(publicDir, "favicon.svg"));
  console.log(` → ${join(publicDir, "favicon.svg")} (svg)`);

  console.log("\nGenerating Android launcher icons");
  for (const [bucket, px] of Object.entries(ANDROID_ICON_PX)) {
    const dir = join(androidRes, bucket);
    await pngFromSvg(maskSvg, join(dir, "ic_launcher.png"), px);
    await pngRoundFromSvg(maskSvg, join(dir, "ic_launcher_round.png"), px);
  }
  for (const [bucket, px] of Object.entries(ANDROID_FG_PX)) {
    const dir = join(androidRes, bucket);
    await pngFromSvg(maskSvg, join(dir, "ic_launcher_foreground.png"), px);
  }

  // Adaptive background — flat brand colour, drawn behind the foreground.
  // The PesaLens APK uses a colour drawable in values/ic_launcher_background.xml,
  // so we just patch that file with the brand deep tone.
  const bgXml = join(androidRes, "values", "ic_launcher_background.xml");
  await writeFile(
    bgXml,
    '<?xml version="1.0" encoding="utf-8"?>\n' +
      "<resources>\n" +
      '    <color name="ic_launcher_background">#08090C</color>\n' +
      "</resources>\n",
    "utf8"
  );
  console.log(` → ${bgXml} (color)`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
