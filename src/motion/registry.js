/**
 * PesaLens Motion Registry — single source of truth for per-section motion.
 *
 * Swap one field here (e.g. background: 'prism' → 'lightfall') and the section
 * re-skins with no other edits. Add rows keyed by route/section id as pages
 * adopt the system.
 *
 * Backgrounds are deliberately limited to the three theme-adaptive ReactBits
 * shaders (they take our token colors directly, so light/dark both stay
 * premium): PRISM, LIGHTFALL, FERROFLUID. 'glow'/'none' are the CSS fallbacks.
 *
 * @typedef {'prism'|'lightfall'|'ferrofluid'|'glow'|'none'} BgKind
 * @typedef {'split'|'blur'|'shiny'|'gradient'|'scrollreveal'|'scrollfloat'|'none'} TextFx
 * @typedef {'spotlight'|'tilt'|'glare'|'star'|'none'} CardFx
 * @typedef {'ring'|'float'|'fanstack'|'assemble'|'flip'|'none'} NoteFx
 *
 * @typedef {Object} SectionMotion
 * @property {string} id
 * @property {BgKind} background
 * @property {Record<string, unknown>=} bgProps    — speed, density… (colors come from theme tokens)
 * @property {TextFx} heading
 * @property {CardFx} card
 * @property {NoteFx=} notes                       — optional banknote layer
 * @property {{denoms?: string[], count?: number, glow?: 'accent'|'net'}=} noteProps
 * @property {'full'|'lite'=} intensity            — resolved by MotionProvider (device/user aware)
 */

/** @type {Record<string, SectionMotion>} */
export const MOTION = {
  hero: {
    id: 'hero',
    background: 'prism',
    bgProps: { opacity: 0.5, scale: 4.2, glow: 0.8, timeScale: 0.35 },
    heading: 'split',
    card: 'spotlight',
    notes: 'float',
    noteProps: { denoms: ['1k', '10k'], glow: 'net' },
  },
  method: {
    id: 'method',
    background: 'lightfall',
    bgProps: { opacity: 0.5, streakCount: 3, density: 0.5, speed: 0.35 },
    heading: 'scrollreveal',
    card: 'none',
    notes: 'assemble',
    noteProps: { denoms: ['1k'], glow: 'accent' },
  },
  capabilities: {
    id: 'capabilities',
    background: 'prism',
    bgProps: { opacity: 0.22, scale: 5.2, glow: 0.5, timeScale: 0.25 },
    heading: 'scrollfloat',
    card: 'magicbento',
  },
  recon: {
    id: 'recon',
    background: 'lightfall',
    bgProps: { opacity: 0.4, streakCount: 2, density: 0.4, speed: 0.3 },
    heading: 'blur',
    card: 'spotlight',
  },
  markets: {
    id: 'markets',
    background: 'ferrofluid',
    bgProps: { opacity: 0.85, scale: 1.9, speed: 0.4 },
    heading: 'gradient',
    card: 'tilt',
    notes: 'ring',
    noteProps: { denoms: ['1k', '2k', '5k', '10k'], count: 4, glow: 'accent' },
  },
  why: {
    id: 'why',
    background: 'lightfall',
    bgProps: { opacity: 0.45, streakCount: 2, density: 0.45, speed: 0.3 },
    heading: 'blur',
    card: 'spotlight',
    notes: 'ring',
    noteProps: { denoms: ['1k', '2k', '5k', '10k'], count: 8, glow: 'accent' },
  },
  cta: {
    id: 'cta',
    background: 'prism',
    bgProps: { opacity: 0.55, scale: 3.4, glow: 1, timeScale: 0.45 },
    heading: 'split',
    card: 'star',
    notes: 'fanstack',
    noteProps: { denoms: ['1k', '2k', '5k', '10k'], glow: 'accent' },
  },
};
