/* SectionBackground — the registry's `background` field rendered.
   The three approved shaders (Prism, Lightfall, Ferrofluid) are lazy-loaded,
   mount only while their section is near the viewport, and a module-level
   mutex guarantees at most ONE WebGL canvas exists at any time — a second
   requester keeps its CSS fallback until the first releases. They all take
   theme-token colors, so light/dark both stay on-brand. */
import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useMotionEnv } from './MotionProvider';
import { tokenHex, useThemeVersion } from './tokens';

const Prism = lazy(() => import('../components/reactbits/Prism'));
const Lightfall = lazy(() => import('../components/reactbits/Lightfall'));
const Ferrofluid = lazy(() => import('../components/reactbits/Ferrofluid'));

/* ---- WebGL mutex: at most one live canvas ---------------------------- */
let webglOwner = null;
const claims = new Set();
const claimGL = (id) => {
  if (webglOwner === null || webglOwner === id) {
    webglOwner = id;
    return true;
  }
  return false;
};
const releaseGL = (id) => {
  if (webglOwner === id) {
    webglOwner = null;
    // wake any section still on its fallback so it can claim the slot
    claims.forEach((cb) => cb());
  }
};

/* Track section visibility with margin so the canvas is warm before it scrolls in */
const useNearViewport = (ref, margin = '20%') => {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: `${margin} 0px ${margin} 0px` }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return near;
};

const GlowFallback = () => <div aria-hidden className="pl-bg-glow pl-bg-glow--accent" />;

const WebGLSlot = ({ id, near, fallback, children }) => {
  const [owned, setOwned] = useState(false);

  useEffect(() => {
    if (!near) {
      setOwned(false);
      releaseGL(id);
      return undefined;
    }
    const tryClaim = () => {
      if (claimGL(id)) setOwned(true);
    };
    tryClaim();
    claims.add(tryClaim);
    return () => {
      claims.delete(tryClaim);
      setOwned(false);
      releaseGL(id);
    };
  }, [near, id]);

  if (!owned) return fallback;
  return <Suspense fallback={fallback}>{children}</Suspense>;
};

/**
 * @param {{ kind: string, sectionRef: React.RefObject<HTMLElement>, id: string,
 *           className?: string, bgProps?: Record<string, unknown> }} props
 */
const SectionBackground = ({ kind, sectionRef, id, className = '', bgProps = {} }) => {
  const { lite, isTouch } = useMotionEnv();
  const near = useNearViewport(sectionRef);
  /* remount canvases when the theme flips so shader colors re-read the tokens */
  const themeV = useThemeVersion();
  const isLight =
    typeof document !== 'undefined' && document.documentElement.classList.contains('light');

  if (kind === 'none') return null;

  /* Lite devices never get WebGL — crisp CSS glow instead */
  if (lite || kind === 'glow') return <GlowFallback />;

  const accent = tokenHex('--c-accent');
  const accentHi = tokenHex('--c-accent-h');
  const net = tokenHex('--c-net');
  const deep = tokenHex('--c-deep');

  switch (kind) {
    case 'prism':
      return (
        <div
          aria-hidden
          className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
          style={{ opacity: bgProps.opacity ?? 0.5, isolation: 'isolate' }}
        >
          <WebGLSlot id={id} near={near} fallback={<GlowFallback />}>
            {/* Prism's spectrum is broad (reads yellow-olive). On dark themes we
                flatten its chroma over a black backdrop, then re-colorize the
                luminance with the brand green→blue ramp (mix-blend color). On
                light themes the canvas renders plain at reduced saturation. */}
            <div
              className="absolute inset-0"
              style={{ filter: isLight ? 'saturate(0.5)' : 'saturate(0.25)', background: isLight ? 'transparent' : '#000' }}
            >
              <Prism
                key={themeV}
                animationType="rotate"
                transparent
                scale={bgProps.scale ?? 4}
                glow={bgProps.glow ?? 0.8}
                bloom={0.9}
                noise={0.25}
                colorFrequency={0.55}
                timeScale={bgProps.timeScale ?? 0.35}
                suspendWhenOffscreen
              />
            </div>
            {!isLight && (
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(120deg, ${accent}, ${net})`,
                  mixBlendMode: 'color',
                }}
              />
            )}
          </WebGLSlot>
        </div>
      );
    case 'lightfall':
      /* Lightfall paints its own opaque backdrop in-shader (no transparent
         mode) — on the light theme that greys the page, so use the CSS glow. */
      if (isLight) return <GlowFallback />;
      return (
        <div
          aria-hidden
          className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
          style={{ opacity: bgProps.opacity ?? 0.5 }}
        >
          <WebGLSlot id={id} near={near} fallback={<GlowFallback />}>
            <Lightfall
              key={themeV}
              colors={[accentHi, net, accent]}
              backgroundColor={deep}
              backgroundGlow={0.25}
              streakCount={bgProps.streakCount ?? 2}
              streakWidth={1}
              streakLength={1.1}
              density={bgProps.density ?? 0.5}
              twinkle={0.8}
              glow={0.9}
              zoom={3}
              speed={bgProps.speed ?? 0.35}
              mouseInteraction={!isTouch}
              mouseStrength={0.35}
              dpr={Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5)}
            />
          </WebGLSlot>
        </div>
      );
    case 'ferrofluid':
      return (
        <div
          aria-hidden
          className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
          style={{ opacity: bgProps.opacity ?? 0.8 }}
        >
          <WebGLSlot id={id} near={near} fallback={<GlowFallback />}>
            <Ferrofluid
              key={themeV}
              colors={[accent, net, accentHi]}
              speed={bgProps.speed ?? 0.4}
              scale={bgProps.scale ?? 1.8}
              turbulence={0.9}
              fluidity={0.12}
              rimWidth={0.22}
              sharpness={2.4}
              shimmer={1.3}
              glow={1.6}
              flowDirection="down"
              mouseInteraction={!isTouch}
              mouseStrength={0.6}
              dpr={Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 1.5)}
            />
          </WebGLSlot>
        </div>
      );
    default:
      return null;
  }
};

export default SectionBackground;
