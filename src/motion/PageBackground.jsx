/* PageBackground — ONE unified background for the whole app.
 *
 *   Landing · light theme → Light Pillar (three.js)
 *   Landing · dark  theme → Hyperspeed (three.js)
 *   Inner app pages       → subtle Light Pillar, identical in both themes
 *
 * Guarded + lazy: three.js is code-split (lazy) so it never blocks first paint,
 * and `lite` devices (reduced-motion / save-data / touch / narrow) never load it
 * at all — they get a premium static brand gradient instead. Colors always come
 * from the theme tokens, so the palette stays green/blue/near-black↔off-white.
 * Keyed on the theme version so the canvas remounts and re-reads tokens on flip.
 */
import React, { Suspense, lazy } from 'react';
import { useMotionEnv } from './MotionProvider';
import { tokenHex, useThemeVersion } from './tokens';

const LightPillar = lazy(() => import('../components/reactbits/LightPillar'));
const Hyperspeed = lazy(() => import('../components/reactbits/Hyperspeed'));

/** '#30dc82' → 0x30dc82 for Hyperspeed's numeric color options */
const hexNum = (hex) => parseInt(String(hex).replace('#', ''), 16) || 0;

/* Static brand gradient — used as the brief placeholder while the three.js
   canvases lazy-load (Suspense fallback) and as the calm inner-page underlay. */
const Fallback = () => <div className="pl-page-bg__fallback" />;

/* Lite-viewport background — the mobile app's pure-CSS animated field (no
   three.js), for narrow / touch / reduced-motion / save-data. Theme + motion
   are handled entirely in CSS (`.pl-bg*` in motion.css): dark shows the
   hyperspeed tunnel, light shows the volumetric pillar, reduced-motion freezes
   it. Static markup, no state — recolors via tokens under the `.light` class. */
const LiteBackground = () => (
  <div className="pl-bg" aria-hidden="true">
    {/* Drifting brand glows — both themes (accent + net; swap via tokens). */}
    <div className="pl-bg__glow pl-bg__glow--a" />
    <div className="pl-bg__glow pl-bg__glow--b" />

    {/* DARK → hyperspeed tunnel: bloom + floor/ceiling grids streaming in. */}
    <div className="pl-bg__tunnel">
      <div className="pl-bg__core" />
      <div className="pl-bg__plane pl-bg__plane--floor">
        <div className="pl-bg__rails pl-bg__rails--bloom" />
        <div className="pl-bg__rails" />
        <div className="pl-bg__rails pl-bg__rails--net" />
      </div>
      <div className="pl-bg__plane pl-bg__plane--ceil">
        <div className="pl-bg__rails pl-bg__rails--bloom" />
        <div className="pl-bg__rails" />
        <div className="pl-bg__rails pl-bg__rails--net" />
      </div>
    </div>

    {/* LIGHT → volumetric light-blue pillar (soft beam + core + floor pool). */}
    <div className="pl-bg__pillar" />
    <div className="pl-bg__pillar-core" />
    <div className="pl-bg__pillar-pool" />
  </div>
);

const PageBackground = ({ variant = 'landing' }) => {
  const { lite } = useMotionEnv();
  const themeV = useThemeVersion();
  const isLight =
    typeof document !== 'undefined' && document.documentElement.classList.contains('light');

  const cls = `pl-page-bg${variant === 'inner' ? ' pl-page-bg--inner' : ''}`;

  // Lite devices: no WebGL — the mobile app's lightweight animated CSS field.
  if (lite) {
    return (
      <div aria-hidden className={cls}>
        <LiteBackground />
        {/* Legibility scrim over the busy dark tunnel — the same reason the
            desktop dark branch pairs one with Hyperspeed. Inner pages render
            the calm pillar-only field, and the light pillar needs no scrim. */}
        {variant !== 'inner' && !isLight && <div className="pl-page-bg__scrim" />}
      </div>
    );
  }

  const accent = tokenHex('--c-accent');
  const accentHi = tokenHex('--c-accent-h');
  const net = tokenHex('--c-net');
  const deep = tokenHex('--c-deep');
  const ink = tokenHex('--c-ink');

  /* Light Pillar composites over any page (its backdrop is emitted transparent —
     see LightPillar.jsx), so it drops straight onto the light/white page in the
     light theme and onto dark surfaces on inner-dark. A faint brand glow sits
     under it so the page never reads flat. */
  const pillar = (opts) => (
    <>
      <div className="pl-page-bg__fallback" style={{ opacity: 0.7 }} />
      <Suspense fallback={<Fallback />}>
        <div style={{ position: 'absolute', inset: 0, opacity: opts.opacity }}>
          <LightPillar
            topColor={opts.topColor}
            bottomColor={opts.bottomColor}
            intensity={opts.intensity}
            rotationSpeed={opts.rotationSpeed}
            pillarWidth={opts.pillarWidth}
            pillarHeight={opts.pillarHeight}
            noiseIntensity={opts.noiseIntensity}
            glowAmount={opts.glowAmount}
            pillarRotation={opts.pillarRotation ?? 0}
            mixBlendMode="normal"
            quality={opts.quality}
          />
        </div>
      </Suspense>
    </>
  );

  // ---- Inner app pages: subtle Light Pillar, both themes ----
  if (variant === 'inner') {
    return (
      <div aria-hidden className={cls} key={themeV}>
        {pillar({
          topColor: accentHi,
          bottomColor: net,
          intensity: 0.9,
          rotationSpeed: 0.2,
          pillarWidth: 4.6,
          pillarHeight: 0.32,
          noiseIntensity: 0.3,
          glowAmount: 0.0038,
          pillarRotation: -12,
          opacity: 0.42,
          quality: 'medium',
        })}
      </div>
    );
  }

  // ---- Landing · light theme → Light Pillar ----
  if (isLight) {
    return (
      <div aria-hidden className={cls} key={themeV}>
        {pillar({
          topColor: accent,
          bottomColor: net,
          intensity: 1.0,
          rotationSpeed: 0.3,
          pillarWidth: 3.4,
          pillarHeight: 0.4,
          noiseIntensity: 0.5,
          glowAmount: 0.005,
          opacity: 0.85,
          quality: 'high',
        })}
      </div>
    );
  }

  // ---- Landing · dark theme → Hyperspeed ----
  return (
    <div aria-hidden className={cls} key={themeV}>
      <Suspense fallback={<Fallback />}>
        <div style={{ position: 'absolute', inset: 0, opacity: 0.9 }}>
          <Hyperspeed
            effectOptions={{
              distortion: 'turbulentDistortion',
              length: 400,
              roadWidth: 10,
              islandWidth: 2,
              lanesPerRoad: 4,
              fov: 90,
              fovSpeedUp: 150,
              speedUp: 2,
              carLightsFade: 0.4,
              totalSideLightSticks: 20,
              lightPairsPerRoadWay: 40,
              colors: {
                roadColor: hexNum(deep),
                islandColor: hexNum(ink) || hexNum(deep),
                background: hexNum(deep),
                shoulderLines: hexNum(accentHi),
                brokenLines: hexNum(net),
                leftCars: [hexNum(accent), hexNum(accentHi), 0x1cb468],
                rightCars: [hexNum(net), 0x3884f5, 0x0e5ea5],
                sticks: hexNum(accent),
              },
            }}
          />
        </div>
      </Suspense>
      <div className="pl-page-bg__scrim" />
    </div>
  );
};

export default PageBackground;
