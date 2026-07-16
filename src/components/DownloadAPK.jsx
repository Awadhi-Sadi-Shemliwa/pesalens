import React, { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { trackEvent } from '../data/analytics';

/* --------------------------------------------------------------------------
   DownloadAPK — direct-download button for the signed Android APK.

   The APK lives at /downloads/pesalens.apk (staged at build time by
   scripts/copy-apk.mjs). A sidecar /downloads/pesalens.apk.json carries
   the size + mtime so we can render "5.0 MB · updated 2 days ago" without
   shelling to a HEAD request that some static hosts refuse.

   Variants
     • "primary" — full button with chevron, label, sub-label
     • "ghost"   — text link with arrow, fits next to other CTAs
     • "row"     — two-line stacked card, used in landing-page strips

   The component soft-fails when the metadata sidecar is missing — it
   still renders and downloads, just without the size annotation. That
   way local dev (where you may not have run `npm run apk:stage` yet)
   doesn't break the page.
   -------------------------------------------------------------------------- */

const APK_URL = '/downloads/pesalens.apk';
const META_URL = '/downloads/pesalens.apk.json';

const useApkMeta = () => {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(META_URL, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive) setMeta(data);
      })
      .catch(() => { /* sidecar missing — fine */ });
    return () => { alive = false; };
  }, []);
  return meta;
};

const relativeTime = (iso) => {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diff = Date.now() - ts;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'updated today';
  const days = Math.floor(diff / day);
  if (days < 30) return `updated ${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `updated ${months} month${months === 1 ? '' : 's'} ago`;
  return `updated ${new Date(ts).toLocaleDateString()}`;
};

const DownloadAPK = ({ variant = 'primary', className = '' }) => {
  const meta = useApkMeta();
  const sub = [meta?.sizeLabel, relativeTime(meta?.updatedAt)].filter(Boolean).join(' · ');
  // GA4 custom event — .apk isn't in Enhanced Measurement's file_download
  // extension list, so we report it ourselves. The download itself is the
  // <a download> navigation; this fires alongside it.
  const onDownload = () => trackEvent('apk_download', { variant });

  if (variant === 'ghost') {
    return (
      <a
        href={APK_URL}
        download="pesalens.apk"
        onClick={onDownload}
        className={`inline-flex items-center gap-1.5 text-sm font-medium text-txt-2 hover:text-txt-1 transition ${className}`}
      >
        <Icon name="arrowDownRight" size={14} />
        <span>Download Android APK{meta?.sizeLabel ? ` (${meta.sizeLabel})` : ''}</span>
      </a>
    );
  }

  if (variant === 'row') {
    return (
      <a
        href={APK_URL}
        download="pesalens.apk"
        onClick={onDownload}
        className={`group flex items-center gap-3 sm:gap-4 bento p-3.5 sm:p-4 ${className}`}
      >
        <span className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-2xl overflow-hidden flex-shrink-0 border border-bdr/60">
          <img
            src="/icon-192.png"
            alt=""
            width={56}
            height={56}
            className="w-full h-full object-cover"
          />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-[10px] uppercase tracking-ticker font-mono text-accent">
            Android · sideload
          </span>
          <span className="block text-sm font-semibold tracking-tight text-txt-1 mt-0.5">
            Download the APK directly
          </span>
          {sub && (
            <span className="block text-[11px] text-txt-3 font-mono mt-0.5">{sub}</span>
          )}
        </span>
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-accent/10 border border-accent/25 text-accent group-hover:bg-accent/20 transition">
          <Icon name="arrowDownRight" size={16} />
        </span>
      </a>
    );
  }

  // primary
  return (
    <a
      href={APK_URL}
      download="pesalens.apk"
      onClick={onDownload}
      className={`press btn-secondary px-6 py-3 rounded-xl text-[15px] font-semibold inline-flex items-center justify-center gap-2 ${className}`}
    >
      <Icon name="arrowDownRight" size={16} />
      Download APK
      {meta?.sizeLabel && (
        <span className="font-mono text-xs text-txt-3 ml-1.5">{meta.sizeLabel}</span>
      )}
    </a>
  );
};

export default DownloadAPK;
