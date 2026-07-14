/* NoteLayer — the Tanzanian banknotes animated as premium hero objects
   (the BTC-coin treatment from the Swyftx/Fineo motivations). The artwork
   is NEVER recolored or warped — only the environment (glow, shadow,
   reflection) is green/blue/black. Variants map to registry NoteFx:
     float    — Fineo drifting coins (hero)
     ring     — Swyftx orbit (markets)
     fanstack — fanned cash hand cycling denominations (CTA)
     assemble — notes fly in and stack into the ledger (method)
     flip     — single note slow front↔back turn with glare (featured)
   Reduced-motion renders one static, tastefully tilted note. */
import React, { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { useMotionEnv } from './MotionProvider';
import OrbitRing from './OrbitRing';

/* ---- manifest (public/notes/manifest.json), fetched once ------------- */
let manifestPromise = null;
const loadManifest = () => {
  if (!manifestPromise) {
    manifestPromise = fetch('/notes/manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return manifestPromise;
};

export const useNoteManifest = () => {
  const [manifest, setManifest] = useState(null);
  useEffect(() => {
    let alive = true;
    loadManifest().then((m) => alive && setManifest(m));
    return () => {
      alive = false;
    };
  }, []);
  return manifest;
};

const DENOM_META = {
  '1k': { label: '1,000 TZS', subject: 'Mwl. Nyerere' },
  '2k': { label: '2,000 TZS', subject: 'Lion' },
  '5k': { label: '5,000 TZS', subject: 'Rhino' },
  '10k': { label: '10,000 TZS', subject: 'Elephant' },
};

/** One banknote image: srcset + LQIP + rim glow environment. */
export const NoteImg = ({ manifest, denom, side = 'front', width = 220, glow = 'accent', shadow = true, className = '', style }) => {
  const entry = manifest?.[denom]?.[side];
  if (!entry) return null;
  const aspect = entry.aspect || 2.05;
  return (
    <span
      className={`pl-note ${shadow ? 'pl-note--shadow' : ''} pl-note--glow-${glow} ${className}`}
      style={{ width, aspectRatio: `${aspect}`, ...style }}
    >
      <img
        src={entry.srcs['480'] || Object.values(entry.srcs)[0]}
        srcSet={Object.entries(entry.srcs)
          .map(([w, url]) => `${url} ${w}w`)
          .join(', ')}
        sizes={`${width}px`}
        alt={`${DENOM_META[denom]?.label || denom} banknote (${side})`}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{ backgroundImage: `url(${entry.lqip})`, backgroundSize: 'cover' }}
      />
    </span>
  );
};

/* ---------------------------------------------------------------- float */
const FloatNotes = ({ manifest, denoms, glow, lite }) => {
  const shown = lite ? denoms.slice(0, 1) : denoms.slice(0, 3);
  /* depth/position/tempo per slot — deliberate, not random, so it art-directs */
  const slots = [
    { x: '4%', y: '8%', w: 210, rz: -8, ry: 14, dur: 7.5, dy: 14, blur: 0 },
    { x: '58%', y: '58%', w: 165, rz: 7, ry: -18, dur: 9, dy: 11, blur: 1.6, dim: 0.85 },
    { x: '38%', y: '-4%', w: 120, rz: 14, ry: 8, dur: 11, dy: 9, blur: 2.4, dim: 0.7 },
  ];
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ perspective: 1000 }}>
      {shown.map((denom, i) => {
        const s = slots[i % slots.length];
        return (
          <motion.div
            key={denom}
            className="absolute"
            style={{
              left: s.x,
              top: s.y,
              filter: s.blur ? `blur(${s.blur}px)` : undefined,
              opacity: s.dim || 1,
            }}
            animate={{ y: [0, -s.dy, 0], rotateZ: [s.rz, s.rz + 2.5, s.rz] }}
            transition={{ duration: s.dur, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div style={{ transform: `rotateY(${s.ry}deg)`, transformStyle: 'preserve-3d' }}>
              <NoteImg manifest={manifest} denom={denom} width={s.w} glow={glow} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

/* ----------------------------------------------------------------- ring */
const RingNotes = ({ manifest, denoms, count, glow, lite }) => {
  const list = [];
  const max = lite ? Math.min(3, count) : count;
  for (let i = 0; i < max; i += 1) list.push(denoms[i % denoms.length]);
  return (
    <OrbitRing
      radius={lite ? 150 : 250}
      duration={48}
      tilt={-10}
      className="w-full h-full"
      items={list.map((denom, i) => (
        <NoteImg
          key={`${denom}-${i}`}
          manifest={manifest}
          denom={denom}
          side={i % 2 ? 'back' : 'front'}
          width={lite ? 120 : 170}
          glow={glow}
        />
      ))}
    />
  );
};

/* ------------------------------------------------------------- fanstack */
const FAN = [
  { rz: -16, x: -46, y: 8 },
  { rz: -5, x: -14, y: 0 },
  { rz: 6, x: 18, y: 0 },
  { rz: 17, x: 52, y: 10 },
];
const FanStackNotes = ({ manifest, denoms, glow }) => {
  const [order, setOrder] = useState(denoms);
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.3 });

  useEffect(() => {
    if (!inView) return undefined;
    const id = setInterval(() => {
      setOrder((prev) => [...prev.slice(1), prev[0]]);
    }, 3200);
    return () => clearInterval(id);
  }, [inView]);

  return (
    <div ref={ref} aria-hidden className="relative pointer-events-none" style={{ width: 300, height: 170 }}>
      {order.map((denom, i) => {
        const f = FAN[Math.min(i, FAN.length - 1)];
        return (
          <motion.div
            key={denom}
            className="absolute left-1/2 top-1/2"
            style={{ zIndex: order.length - i, transformOrigin: '50% 120%' }}
            animate={{ x: f.x - 90, y: f.y - 55, rotateZ: f.rz, scale: i === 0 ? 1 : 1 - i * 0.03 }}
            transition={{ type: 'spring', stiffness: 170, damping: 24 }}
          >
            <NoteImg manifest={manifest} denom={denom} width={180} glow={glow} shadow />
          </motion.div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------------- assemble */
const AssembleNotes = ({ manifest, denoms, glow }) => {
  const starts = [
    { x: -140, y: -80, rz: -28 },
    { x: 130, y: -110, rz: 24 },
    { x: -90, y: 120, rz: -14 },
  ];
  return (
    <div aria-hidden className="relative pointer-events-none" style={{ width: 210, height: 130 }}>
      {denoms.slice(0, 3).map((denom, i) => (
        <motion.div
          key={`${denom}-${i}`}
          className="absolute left-1/2 top-1/2"
          initial={{ x: starts[i].x, y: starts[i].y, rotateZ: starts[i].rz, opacity: 0 }}
          whileInView={{ x: -80 + i * 8, y: -50 + i * -7, rotateZ: -4 + i * 5, opacity: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ type: 'spring', stiffness: 90, damping: 16, delay: 0.15 * i }}
          style={{ zIndex: i }}
        >
          <NoteImg manifest={manifest} denom={denoms.length > 1 ? denom : denoms[0]} side={i === 1 ? 'back' : 'front'} width={160} glow={glow} />
        </motion.div>
      ))}
    </div>
  );
};

/* ----------------------------------------------------------------- flip */
const FlipNote = ({ manifest, denom, glow, width = 240 }) => {
  const entryFront = manifest?.[denom]?.front;
  const entryBack = manifest?.[denom]?.back;
  if (!entryFront) return null;
  const meta = DENOM_META[denom];
  return (
    <figure aria-hidden className="pl-flip" style={{ width, aspectRatio: `${entryFront.aspect || 2.05}` }}>
      <div className="pl-flip__inner">
        <div className="pl-flip__face">
          <NoteImg manifest={manifest} denom={denom} side="front" width={width} glow={glow} />
        </div>
        {entryBack && (
          <div className="pl-flip__face pl-flip__face--back">
            <NoteImg manifest={manifest} denom={denom} side="back" width={width} glow={glow} />
          </div>
        )}
      </div>
      {meta && (
        <figcaption className="pl-flip__caption font-mono text-[10px] uppercase tracking-ticker text-txt-3">
          {meta.label} · {meta.subject} · Benki Kuu ya Tanzania
        </figcaption>
      )}
    </figure>
  );
};

/* ------------------------------------------------------------- NoteLayer */
/**
 * @param {{ variant: 'float'|'ring'|'fanstack'|'assemble'|'flip'|'none',
 *           denoms?: string[], count?: number, glow?: 'accent'|'net',
 *           className?: string, width?: number }} props
 */
const NoteLayer = ({ variant = 'none', denoms = ['1k'], count = 4, glow = 'accent', className = '', width }) => {
  const { reduced, lite } = useMotionEnv();
  const manifest = useNoteManifest();
  if (!manifest || variant === 'none') return null;

  /* Reduced motion: one authentic note, still and tilted — no orbit/float/flip */
  if (reduced) {
    return (
      <div aria-hidden className={`pointer-events-none ${className}`}>
        <div style={{ transform: 'rotateZ(-6deg)' }}>
          <NoteImg manifest={manifest} denom={denoms[0]} width={width || 200} glow={glow} />
        </div>
      </div>
    );
  }

  const body = {
    float: <FloatNotes manifest={manifest} denoms={denoms} glow={glow} lite={lite} />,
    ring: <RingNotes manifest={manifest} denoms={denoms} count={count} glow={glow} lite={lite} />,
    fanstack: <FanStackNotes manifest={manifest} denoms={denoms} glow={glow} />,
    assemble: <AssembleNotes manifest={manifest} denoms={denoms} glow={glow} />,
    flip: <FlipNote manifest={manifest} denom={denoms[0]} glow={glow} width={width} />,
  }[variant];

  return <div className={className}>{body}</div>;
};

export default NoteLayer;
