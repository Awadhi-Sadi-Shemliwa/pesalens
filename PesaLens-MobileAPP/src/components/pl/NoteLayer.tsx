import { useEffect, useState, type CSSProperties } from "react";
import { motion, useReducedMotion } from "framer-motion";
import OrbitRing from "./OrbitRing";

/* NoteLayer — TS port of the web `src/motion/NoteLayer.jsx`, recomposed for the
   mobile WebView. The Tanzanian banknote artwork is NEVER recolored or warped —
   only the environment (rim glow, floor shadow, glare) is themed green/blue via
   the `.pl-note*` CSS in src/index.css. Variants used by the mobile Landing:
     float  — drifting notes behind the hero MoneyMate scene
     ring   — notes orbiting in the Markets / Why sections (via OrbitRing)
     flip   — a single note doing a slow front↔back turn (reduced-motion + Why)
   The mobile always renders as the web's `lite` tier (fewer notes, smaller radii)
   and collapses to one still, tilted note under reduced motion. */

type NoteSide = "front" | "back";
type NoteEntry = { aspect?: number; srcs: Record<string, string>; lqip?: string };
type NoteManifest = Record<string, Record<NoteSide, NoteEntry>>;

/* ---- manifest (public/notes/manifest.json), fetched once ------------- */
let manifestPromise: Promise<NoteManifest | null> | null = null;
const loadManifest = () => {
  if (!manifestPromise) {
    manifestPromise = fetch("/notes/manifest.json")
      .then((r) => (r.ok ? (r.json() as Promise<NoteManifest>) : null))
      .catch(() => null);
  }
  return manifestPromise;
};

export const useNoteManifest = () => {
  const [manifest, setManifest] = useState<NoteManifest | null>(null);
  useEffect(() => {
    let alive = true;
    loadManifest().then((m) => {
      if (alive) setManifest(m);
    });
    return () => {
      alive = false;
    };
  }, []);
  return manifest;
};

const DENOM_META: Record<string, { label: string; subject: string }> = {
  "1k": { label: "1,000 TZS", subject: "Mwl. Nyerere" },
  "2k": { label: "2,000 TZS", subject: "Lion" },
  "5k": { label: "5,000 TZS", subject: "Rhino" },
  "10k": { label: "10,000 TZS", subject: "Elephant" },
};

type NoteImgProps = {
  manifest: NoteManifest | null;
  denom: string;
  side?: NoteSide;
  width?: number;
  glow?: "accent" | "net";
  shadow?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** One banknote image: srcset + LQIP + rim-glow environment. */
export const NoteImg = ({
  manifest,
  denom,
  side = "front",
  width = 220,
  glow = "accent",
  shadow = true,
  className = "",
  style,
}: NoteImgProps) => {
  const entry = manifest?.[denom]?.[side];
  if (!entry) return null;
  const aspect = entry.aspect || 2.05;
  return (
    <span
      className={`pl-note ${shadow ? "pl-note--shadow" : ""} pl-note--glow-${glow} ${className}`}
      style={{ width, aspectRatio: `${aspect}`, ...style }}
    >
      <img
        src={entry.srcs["480"] || Object.values(entry.srcs)[0]}
        srcSet={Object.entries(entry.srcs)
          .map(([w, url]) => `${url} ${w}w`)
          .join(", ")}
        sizes={`${width}px`}
        alt={`${DENOM_META[denom]?.label || denom} banknote (${side})`}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{ backgroundImage: entry.lqip ? `url(${entry.lqip})` : undefined, backgroundSize: "cover" }}
      />
    </span>
  );
};

/* ---------------------------------------------------------------- float */
const FLOAT_SLOTS = [
  { x: "2%", y: "4%", w: 150, rz: -8, ry: 14, dur: 7.5, dy: 12, blur: 0, dim: 1 },
  { x: "56%", y: "56%", w: 118, rz: 7, ry: -18, dur: 9, dy: 10, blur: 1.4, dim: 0.85 },
  { x: "36%", y: "-4%", w: 92, rz: 14, ry: 8, dur: 11, dy: 8, blur: 2.2, dim: 0.7 },
];
const FloatNotes = ({ manifest, denoms, glow }: { manifest: NoteManifest; denoms: string[]; glow: "accent" | "net" }) => {
  const shown = denoms.slice(0, 2); // lite tier — two notes
  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none" style={{ perspective: 1000 }}>
      {shown.map((denom, i) => {
        const s = FLOAT_SLOTS[i % FLOAT_SLOTS.length];
        return (
          <motion.div
            key={`${denom}-${i}`}
            className="absolute"
            style={{ left: s.x, top: s.y, filter: s.blur ? `blur(${s.blur}px)` : undefined, opacity: s.dim }}
            animate={{ y: [0, -s.dy, 0], rotateZ: [s.rz, s.rz + 2.5, s.rz] }}
            transition={{ duration: s.dur, repeat: Infinity, ease: "easeInOut" }}
          >
            <div style={{ transform: `rotateY(${s.ry}deg)`, transformStyle: "preserve-3d" }}>
              <NoteImg manifest={manifest} denom={denom} width={s.w} glow={glow} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

/* ----------------------------------------------------------------- ring */
const RingNotes = ({
  manifest,
  denoms,
  count,
  glow,
}: {
  manifest: NoteManifest;
  denoms: string[];
  count: number;
  glow: "accent" | "net";
}) => {
  const list: string[] = [];
  const max = Math.min(count, 6); // lite tier cap
  for (let i = 0; i < max; i += 1) list.push(denoms[i % denoms.length]);
  return (
    <OrbitRing
      radius={150}
      duration={44}
      tilt={-10}
      className="w-full h-full"
      items={list.map((denom, i) => (
        <NoteImg key={`${denom}-${i}`} manifest={manifest} denom={denom} side={i % 2 ? "back" : "front"} width={120} glow={glow} />
      ))}
    />
  );
};

/* ----------------------------------------------------------------- flip */
const FlipNote = ({
  manifest,
  denom,
  glow,
  width = 240,
}: {
  manifest: NoteManifest;
  denom: string;
  glow: "accent" | "net";
  width?: number;
}) => {
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
        <figcaption className="pl-flip__caption font-mono-tab text-[10px] uppercase tracking-ticker text-txt-3">
          {meta.label} · {meta.subject} · Benki Kuu ya Tanzania
        </figcaption>
      )}
    </figure>
  );
};

type NoteLayerProps = {
  variant?: "float" | "ring" | "flip" | "none";
  denoms?: string[];
  count?: number;
  glow?: "accent" | "net";
  className?: string;
  width?: number;
};

const NoteLayer = ({ variant = "none", denoms = ["1k"], count = 4, glow = "accent", className = "", width }: NoteLayerProps) => {
  const reduced = useReducedMotion();
  const manifest = useNoteManifest();
  if (!manifest || variant === "none") return null;

  /* Reduced motion: one authentic note, still and tilted — no orbit/float/flip */
  if (reduced) {
    return (
      <div aria-hidden className={`pointer-events-none ${className}`}>
        <div style={{ transform: "rotateZ(-6deg)" }}>
          <NoteImg manifest={manifest} denom={denoms[0]} width={width || 200} glow={glow} />
        </div>
      </div>
    );
  }

  const body = {
    float: <FloatNotes manifest={manifest} denoms={denoms} glow={glow} />,
    ring: <RingNotes manifest={manifest} denoms={denoms} count={count} glow={glow} />,
    flip: <FlipNote manifest={manifest} denom={denoms[0]} glow={glow} width={width} />,
  }[variant];

  return <div className={className}>{body}</div>;
};

export default NoteLayer;
