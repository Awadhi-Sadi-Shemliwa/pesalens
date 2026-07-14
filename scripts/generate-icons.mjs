#!/usr/bin/env node
/**
 * generate-icons.mjs
 *
 * Single source of truth for the PesaLens visual identity. Reads the official
 * logo lockup (brand/PesaLens Logo.png), isolates the circular emblem, and
 * emits every raster the web app, PWA install prompt and Capacitor APK need —
 * for BOTH the web project and the mobile project.
 *
 * The lockup PNG carries a baked dark-navy background, so the emblem tiles read
 * as a self-contained brand mark on any surface (favicons, launcher icons, the
 * in-app <Mark/>). The full lockup is copied out for large brand moments
 * (auth panels, splash screens) as pesalens-lockup.png.
 *
 * Outputs (per public dir: web `public/` + mobile `PesaLens-MobileAPP/public/`):
 *   icon-192.png / icon-512.png            (PWA "any")
 *   icon-maskable-192.png / -512.png       (PWA "maskable")
 *   apple-touch-icon.png                   (180×180)
 *   favicon-32.png / favicon-16.png        (legacy tabs)
 *   favicon.svg                            (emblem embedded as data URI)
 *   logo.png                               (emblem — used by <Mark/>)
 *   pesalens-lockup.png                    (full lockup — large brand spots)
 * Plus, in the mobile Android project:
 *   mipmap-<dpi>/ic_launcher.png + _round.png + _foreground.png
 *   values/ic_launcher_background.xml
 *   drawable-<dpi>/splash.png              (lockup centred on brand navy)
 *
 * Run:  npm run icons     (node scripts/generate-icons.mjs)
 */

import { mkdir, copyFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const brand = join(root, "brand");
const webPublic = join(root, "public");
const mobilePublic = join(root, "PesaLens-MobileAPP/public");
const androidRes = join(root, "PesaLens-MobileAPP/android/app/src/main/res");

const LOCKUP = join(brand, "PesaLens Logo.png");
const BRAND_BG = "#08090C"; // brand "money black" — matches the lockup backdrop

// The circular emblem inside the 445×339 lockup (measured once). If the master
// artwork is re-exported at a different size, update this box.
const EMBLEM = { left: 140, top: 45, width: 165, height: 165 };

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

/** High-res square emblem buffer (upscaled from the lockup crop). */
async function emblemBuffer(size) {
  return sharp(LOCKUP)
    .extract(EMBLEM)
    .resize(size, size, { fit: "cover", kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeEmblem(outPath, size, maskable = false) {
  await ensure(dirname(outPath));
  if (maskable) {
    const inner = Math.round(size * 0.82);
    const emb = await emblemBuffer(inner);
    const pad = Math.round((size - inner) / 2);
    await sharp({
      create: { width: size, height: size, channels: 4, background: BRAND_BG },
    })
      .composite([{ input: emb, top: pad, left: pad }])
      .png({ compressionLevel: 9 })
      .toFile(outPath);
  } else {
    await sharp(await emblemBuffer(size)).toFile(outPath);
  }
  console.log(` → ${outPath} (${size}×${size}${maskable ? ", maskable" : ""})`);
}

async function writeRoundEmblem(outPath, size) {
  await ensure(dirname(outPath));
  const square = await emblemBuffer(size);
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

async function writeFaviconSvg(outPath) {
  await ensure(dirname(outPath));
  const b64 = (await emblemBuffer(256)).toString("base64");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">` +
    `<image href="data:image/png;base64,${b64}" width="256" height="256"/></svg>\n`;
  await writeFile(outPath, svg, "utf8");
  console.log(` → ${outPath} (svg, embedded)`);
}

/** Every raster a web/PWA public dir needs. */
async function fillPublicDir(pub) {
  await ensure(pub);
  await writeEmblem(join(pub, "icon-192.png"), 192);
  await writeEmblem(join(pub, "icon-512.png"), 512);
  await writeEmblem(join(pub, "icon-maskable-192.png"), 192, true);
  await writeEmblem(join(pub, "icon-maskable-512.png"), 512, true);
  await writeEmblem(join(pub, "apple-touch-icon.png"), 180);
  await writeEmblem(join(pub, "favicon-32.png"), 32);
  await writeEmblem(join(pub, "favicon-16.png"), 16);
  await writeEmblem(join(pub, "logo.png"), 256);
  await writeFaviconSvg(join(pub, "favicon.svg"));
  await copyFile(LOCKUP, join(pub, "pesalens-lockup.png"));
  console.log(` → ${join(pub, "pesalens-lockup.png")} (lockup)`);
}

const ANDROID_ICON_PX = {
  "mipmap-mdpi": 48,
  "mipmap-hdpi": 72,
  "mipmap-xhdpi": 96,
  "mipmap-xxhdpi": 144,
  "mipmap-xxxhdpi": 192,
};
const ANDROID_FG_PX = {
  "mipmap-mdpi": 108,
  "mipmap-hdpi": 162,
  "mipmap-xhdpi": 216,
  "mipmap-xxhdpi": 324,
  "mipmap-xxxhdpi": 432,
};

async function fillAndroidLaunchers() {
  for (const [bucket, px] of Object.entries(ANDROID_ICON_PX)) {
    const dir = join(androidRes, bucket);
    await writeEmblem(join(dir, "ic_launcher.png"), px);
    await writeRoundEmblem(join(dir, "ic_launcher_round.png"), px);
  }
  for (const [bucket, px] of Object.entries(ANDROID_FG_PX)) {
    const dir = join(androidRes, bucket);
    await writeEmblem(join(dir, "ic_launcher_foreground.png"), px, true);
  }
  const bgXml = join(androidRes, "values", "ic_launcher_background.xml");
  await ensure(dirname(bgXml));
  await writeFile(
    bgXml,
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
      `    <color name="ic_launcher_background">${BRAND_BG}</color>\n` +
      "</resources>\n",
    "utf8"
  );
  console.log(` → ${bgXml} (color)`);
}

/** The lockup's own backdrop colour (sampled from a corner) so a splash built
 *  around it shows no seam between the artwork and the fill. */
async function lockupBackground() {
  const { data } = await sharp(LOCKUP)
    .extract({ left: 2, top: 2, width: 6, height: 6 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
}

/** Regenerate each existing splash.png as the lockup centred on brand navy. */
async function fillAndroidSplash() {
  if (!existsSync(androidRes)) return;
  const bg = await lockupBackground();
  const buckets = (await readdir(androidRes)).filter((d) => d.startsWith("drawable"));
  for (const bucket of buckets) {
    const out = join(androidRes, bucket, "splash.png");
    if (!existsSync(out)) continue;
    const { width, height } = await sharp(out).metadata();
    const logoW = Math.round(Math.min(width, height) * 0.52);
    const logo = await sharp(LOCKUP)
      .resize(logoW, null, { fit: "inside", kernel: "lanczos3" })
      .png()
      .toBuffer();
    await sharp({
      create: { width, height, channels: 4, background: bg },
    })
      .composite([{ input: logo, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toFile(out);
    console.log(` → ${out} (${width}×${height}, splash)`);
  }
}

async function main() {
  if (!existsSync(LOCKUP)) {
    console.error(`Missing brand lockup: ${LOCKUP}`);
    process.exit(1);
  }

  // Emblem master for reference / other tooling.
  await writeEmblem(join(brand, "logo.png"), 512);

  console.log("\nWeb public/");
  await fillPublicDir(webPublic);

  console.log("\nMobile public/");
  await fillPublicDir(mobilePublic);

  console.log("\nAndroid launcher icons");
  await fillAndroidLaunchers();

  console.log("\nAndroid splash screens");
  await fillAndroidSplash();

  console.log("\nDone. (Run a mobile build + `npx cap sync` to bundle mobile assets.)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
