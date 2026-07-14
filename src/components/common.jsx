import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useInView } from './useInView';
import { useReducedMotion } from './useReducedMotion';
import { Icon } from './Icon';
import { useTheme } from '../data/theme';
import { useT } from '../data/i18n';
import { passwordStrength, passwordRules } from '../data/password';

/* ----------------------------------------------------------------
   Theme toggle (sun/moon)
   ---------------------------------------------------------------- */
export const ThemeToggle = ({ className = '' }) => {
  const [theme, toggle] = useTheme();
  const { t } = useT();
  return (
    <button
      type="button"
      onClick={toggle}
      title={t('nav.toggleTheme')}
      aria-label={t('nav.toggleTheme')}
      className={`p-2 rounded-lg hover:bg-surface-3 transition text-txt-2 hover:text-txt-1 ${className}`}
    >
      <Icon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
    </button>
  );
};

/* ----------------------------------------------------------------
   Language toggle (EN ↔ SW)
   ---------------------------------------------------------------- */
export const LanguageToggle = ({ className = '' }) => {
  const { lang, setLang, t } = useT();
  const flip = () => setLang(lang === 'en' ? 'sw' : 'en');
  return (
    <button
      type="button"
      onClick={flip}
      title={t('nav.language')}
      aria-label={t('nav.language')}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-surface-3 transition text-txt-2 hover:text-txt-1 ${className}`}
    >
      <Icon name="globe" size={14} />
      <span className="font-mono text-[11px] uppercase tracking-ticker">{lang}</span>
    </button>
  );
};

/* ----------------------------------------------------------------
   Reveal-on-scroll (staggered, animate once)
   ---------------------------------------------------------------- */
export const FadeIn = ({ children, delay = 0, y = 18, className = '' }) => {
  const [ref, visible] = useInView();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (visible) setShown(true);
  }, [visible]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : `translateY(${y}px)`,
        transition: `opacity 0.7s cubic-bezier(0.4,0,0.2,1) ${delay}s, transform 0.7s cubic-bezier(0.4,0,0.2,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
};

/* ----------------------------------------------------------------
   Brand Mark — aperture/iris (replaces the generic "eye in blue square")
   ---------------------------------------------------------------- */
export const Mark = ({ size = 32, withWord = true, className = '' }) => (
  <span className={`inline-flex items-center gap-2.5 ${className}`}>
    <span
      className="relative inline-flex items-center justify-center overflow-hidden rounded-[10px]"
      style={{
        width: size,
        height: size,
        border: '1px solid rgb(var(--c-accent) / 0.38)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 6px 18px -6px rgb(var(--c-accent) / 0.45)',
      }}
    >
      <img
        src="/logo.png"
        alt="PesaLens"
        width={size}
        height={size}
        className="block w-full h-full object-cover"
        draggable={false}
      />
    </span>
    {withWord && (
      <span className="text-[17px] font-semibold tracking-tight text-txt-1">
        Pesa<span className="text-accent">Lens</span>
      </span>
    )}
  </span>
);

/* ----------------------------------------------------------------
   Section eyebrow (replaces generic pill badge)
   ---------------------------------------------------------------- */
export const Eyebrow = ({ children, className = '' }) => (
  <div className={`inline-flex items-center gap-3 ${className}`}>
    <span className="h-px w-6 bg-bdr" />
    <span className="text-[11px] uppercase tracking-ticker font-medium text-txt-2">{children}</span>
  </div>
);

/* ----------------------------------------------------------------
   Badge (kept API; refined visuals)
   ---------------------------------------------------------------- */
const Badge = ({ children, color = 'accent', className = '', dot = false }) => {
  const colors = {
    accent:  'bg-accent/10 text-accent border-accent/20',
    income:  'bg-inc/10 text-inc border-inc/20',
    expense: 'bg-exp/10 text-exp border-exp/20',
    net:     'bg-net/10 text-net border-net/20',
    danger:  'bg-dng/10 text-dng border-dng/20',
    muted:   'bg-surface-4 text-txt-2 border-bdr',
  };
  const dotColors = {
    accent: 'bg-accent', income: 'bg-inc', expense: 'bg-exp',
    net: 'bg-net', danger: 'bg-dng', muted: 'bg-txt-3',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium tracking-wide border ${colors[color] || colors.accent} ${className}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[color] || dotColors.accent}`} />}
      {children}
    </span>
  );
};

/* ----------------------------------------------------------------
   CountUp — animated number ticker
   ---------------------------------------------------------------- */
export const CountUp = ({
  value,
  prefix = '',
  suffix = '',
  duration = 900,
  decimals = 0,
  formatter,
  className = '',
}) => {
  const [display, setDisplay] = useState(0);
  const [ref, visible] = useInView();
  // Mirror the on-screen value so a data change (e.g. a fresh upload) re-animates
  // from the current number to the new one instead of freezing on the first
  // reveal. Animating from `displayRef` also keeps mid-flight interrupts smooth.
  const displayRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const target = Number(value) || 0;
    const from = displayRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      displayRef.current = current;
      setDisplay(current);
      if (t < 1) raf = requestAnimationFrame(tick);
      else displayRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, value, duration]);

  const formatted = formatter
    ? formatter(display)
    : `${prefix}${display.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${suffix}`;

  return <span ref={ref} className={`tabular ${className}`}>{formatted}</span>;
};

/* ----------------------------------------------------------------
   Sparkline — deterministic SVG line for KPI cards / tickers
   ---------------------------------------------------------------- */
export const Sparkline = ({
  values = [],
  width = 120,           // used only as the viewBox aspect-ratio width
  height = 32,
  color = '#4C6EF5',
  fill = true,
  strokeWidth = 1.6,
  className = '',
  responsive = true,     // when true the SVG fills its parent's width
}) => {
  const path = useMemo(() => {
    if (!values.length) return { line: '', area: '' };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const dx = width / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => {
      const x = i * dx;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return [x, y];
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${line} L${width} ${height} L0 ${height} Z`;
    return { line, area };
  }, [values, width, height]);

  const id = useMemo(() => `sl-${Math.random().toString(36).slice(2, 8)}`, []);

  // The SVG is sized via viewBox + preserveAspectRatio="none", and the
  // outer width is 100% so the sparkline shrinks/grows with its parent
  // on any device. Pass `responsive={false}` to keep the legacy fixed
  // pixel sizing.
  const svgProps = responsive
    ? { width: '100%', height, preserveAspectRatio: 'none', style: { display: 'block', maxWidth: '100%' } }
    : { width, height, style: { overflow: 'visible' } };

  return (
    <svg
      {...svgProps}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          {/* style-based so CSS var() colors (rgb(var(--c-inc))) resolve */}
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.32 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {fill && <path d={path.area} fill={`url(#${id})`} />}
      <path
        d={path.line}
        style={{ stroke: color }}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

/* ----------------------------------------------------------------
   KPI Card — three variants (hero, standard, compact)
   ---------------------------------------------------------------- */
/* Resolve a live theme token to an rgb() string (green accent in dark,
   blue in light), falling back to a hex if the var isn't available yet. */
export const readToken = (name, fallback) => {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `rgb(${raw.replace(/\s+/g, ' ')})` : fallback;
};
const tokenVar = {
  accent: ['--c-accent', '#30DC82'], income: ['--c-inc', '#10B981'],
  expense: ['--c-exp', '#F59E0B'], net: ['--c-net', '#3884F5'], danger: ['--c-dng', '#EF4444'],
};
const resolveAccent = (key) => {
  const [name, fb] = tokenVar[key] || tokenVar.accent;
  return readToken(name, fb);
};
const accentText = {
  accent: 'text-accent', income: 'text-inc', expense: 'text-exp', net: 'text-net', danger: 'text-dng',
};

/* ----------------------------------------------------------------
   Tooltip — a hint, not documentation (tooltips.md)

   • 300ms hover delay so it only fires on intent, not every cursor graze (#1).
   • An arrow tail anchors it to its trigger; in a row of icons a floating bubble
     leaves the user guessing which control it belongs to (#2).
   • It measures against the viewport and flips to the opposite side rather than
     letting the text be clipped by an edge (#3).
   • Every dismissal route is wired: pointer leave, Escape, blur, scroll (#4).
   • Capped at 260px and one sentence — anything longer belongs in real docs (#5–#6).

   Keyboard users reach it because the trigger is a real <button>: focus opens it
   with no delay (intent is already proven by tabbing to it).
   ---------------------------------------------------------------- */
export const Tooltip = ({ content, children, side = 'top', className = '' }) => {
  const [open, setOpen] = useState(false);
  // Fixed viewport coordinates, computed from the anchor's rect. The bubble is
  // rendered in a PORTAL on <body>, so no card's overflow-hidden (needed for its
  // rounded corners + blurred glow) can ever clip it — the bug where "NET FLOW"
  // and "SAVINGS RATE" hints were sheared by the card edge. `arrowShift` re-aims
  // the arrow at the anchor after the bubble is clamped away from a screen edge.
  const [pos, setPos] = useState(null); // { left, top, placement, arrowShift }
  const wrapRef = useRef(null);
  const bubbleRef = useRef(null);
  const timer = useRef(null);
  const id = useRef(`tt-${Math.random().toString(36).slice(2, 8)}`).current;

  const show = (immediate = false) => {
    clearTimeout(timer.current);
    if (immediate) setOpen(true);
    else timer.current = setTimeout(() => setOpen(true), 300);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  // Measure the anchor + bubble, flip to the side with room, then clamp inside
  // the viewport. Runs in a layout effect so the first painted frame is correct.
  const place = React.useCallback(() => {
    const anchor = wrapRef.current;
    const el = bubbleRef.current;
    if (!anchor || !el) return;
    const r = anchor.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    let placement = side;
    if (side === 'top' && r.top - b.height - gap < margin) placement = 'bottom';
    else if (side === 'bottom' && r.bottom + b.height + gap > window.innerHeight - margin) placement = 'top';
    else if (side === 'left' && r.left - b.width - gap < margin) placement = 'right';
    else if (side === 'right' && r.right + b.width + gap > window.innerWidth - margin) placement = 'left';

    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let left;
    let top;
    let arrowShift = 0;
    if (placement === 'top' || placement === 'bottom') {
      const half = b.width / 2;
      const clamped = Math.min(Math.max(cx, margin + half), window.innerWidth - margin - half);
      left = clamped;
      top = placement === 'top' ? r.top - gap : r.bottom + gap;
      arrowShift = cx - clamped; // keep the arrow pointing at the anchor
    } else {
      const half = b.height / 2;
      const clamped = Math.min(Math.max(cy, margin + half), window.innerHeight - margin - half);
      top = clamped;
      left = placement === 'left' ? r.left - gap : r.right + gap;
      arrowShift = cy - clamped;
    }
    setPos({ left, top, placement, arrowShift });
  }, [side]);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
  }, [open, place, content]);

  // While open: dismiss on scroll/Escape, reflow on resize. A tooltip that
  // outlives its anchor's position is worse than no tooltip.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && hide();
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, place]);

  const placement = pos?.placement || side;
  const transform = {
    top: 'translate(-50%, -100%)',
    bottom: 'translate(-50%, 0)',
    left: 'translate(-100%, -50%)',
    right: 'translate(0, -50%)',
  }[placement];

  // Arrow sits on the bubble edge facing the anchor; the two visible borders
  // match the bubble's so the seam is invisible.
  const arrowCls = {
    top: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 rotate-45 border-b border-r',
    bottom: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 rotate-45 border-t border-l',
    left: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2 rotate-45 border-t border-r',
    right: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-l',
  }[placement];
  const horizontal = placement === 'top' || placement === 'bottom';
  const arrowStyle = horizontal
    ? { marginLeft: `${pos?.arrowShift || 0}px` }
    : { marginTop: `${pos?.arrowShift || 0}px` };

  return (
    <span
      ref={wrapRef}
      className={`relative inline-flex ${className}`}
      onPointerEnter={(e) => e.pointerType !== 'touch' && show()}
      onPointerLeave={hide}
    >
      {React.cloneElement(children, {
        'aria-describedby': open ? id : undefined,
        onFocus: (e) => { children.props.onFocus?.(e); show(true); },
        onBlur: (e) => { children.props.onBlur?.(e); hide(); },
      })}
      {open && createPortal(
        <span
          ref={bubbleRef}
          role="tooltip"
          id={id}
          style={{
            position: 'fixed',
            left: pos ? `${pos.left}px` : '-9999px',
            top: pos ? `${pos.top}px` : '-9999px',
            transform,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="z-[100] max-w-[260px] w-max px-2.5 py-1.5 rounded-lg text-[11.5px] leading-snug text-txt-1 bg-surface-4 border border-bdr shadow-lg pointer-events-none anim-in"
        >
          {content}
          <span
            aria-hidden
            style={arrowStyle}
            className={`absolute ${arrowCls} w-2 h-2 bg-surface-4 border-bdr`}
          />
        </span>,
        document.body,
      )}
    </span>
  );
};

/* A small circled "i" that opens a Tooltip — the standard affordance for a term
   that needs one sentence of explanation. */
export const InfoHint = ({ content, side = 'top', label = 'More information' }) => (
  <Tooltip content={content} side={side}>
    <button
      type="button"
      aria-label={label}
      className="focus-ring inline-flex items-center justify-center w-4 h-4 rounded-full text-txt-3 hover:text-txt-1 border border-bdr text-[9px] font-bold leading-none align-middle"
    >
      i
    </button>
  </Tooltip>
);

const KpiCard = ({
  label,
  value,
  change,
  changeDir,
  icon,
  accent = 'accent',
  variant = 'standard', // 'hero' | 'standard' | 'compact'
  spark,                // optional array of numbers
  rawNumber,            // optional number for count-up; if present `value` becomes the formatter
  formatter,            // optional formatter for count-up
  hint,                 // optional one-sentence explanation → info tooltip on the label
}) => {
  const [theme] = useTheme(); // re-render on theme toggle so token colors refresh
  const isHero = variant === 'hero';
  const isCompact = variant === 'compact';
  const color = resolveAccent(accent); // eslint-disable-line no-unused-vars
  const textC = accentText[accent] || accentText.accent;
  void theme;

  const baseClasses = isHero
    ? 'surface-hero rounded-2xl p-4 sm:p-5 lg:p-6 relative overflow-hidden'
    : isCompact
      ? 'card-soft p-3 sm:p-4 card-hover'
      : 'card-soft p-3 sm:p-5 card-hover';

  const valueSize = isHero
    ? 'text-2xl sm:text-3xl lg:text-[34px] font-bold'
    : 'text-lg sm:text-2xl font-bold';

  return (
    <div className={baseClasses}>
      {isHero && (
        <span
          aria-hidden
          className="absolute -top-12 -right-12 w-44 h-44 rounded-full opacity-25 blur-2xl"
          style={{ background: color }}
        />
      )}
      <div className="flex items-start justify-between gap-2 mb-3 relative">
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] sm:text-[11px] tracking-ticker uppercase text-txt-3 font-medium truncate min-w-0">{label}</span>
          {hint && <InfoHint content={hint} />}
        </span>
        <span
          className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            background: `linear-gradient(135deg, ${color}28, ${color}10)`,
            border: `1px solid ${color}30`,
          }}
        >
          <Icon name={icon} size={14} className={textC} />
        </span>
      </div>
      <div className={`${valueSize} text-txt-1 mb-1 tabular tracking-tight relative truncate`}>
        {rawNumber != null ? (
          <CountUp value={rawNumber} formatter={formatter} duration={900} />
        ) : (
          value
        )}
      </div>
      {change && (
        <div className="flex items-center gap-2 relative">
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold tabular ${changeDir === 'down' ? 'text-exp' : 'text-inc'}`}>
            <Icon name={changeDir === 'down' ? 'arrowDownRight' : 'arrowUpRight'} size={12} />
            {change}
          </span>
          <span className="text-[11px] text-txt-3">vs last period</span>
        </div>
      )}
      {spark && spark.length > 1 && (
        <div className="mt-3 -mx-1 relative">
          <Sparkline values={spark} width={isHero ? 280 : 180} height={isHero ? 44 : 32} color={color} />
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------
   Skeleton, EmptyState
   ---------------------------------------------------------------- */
const Skeleton = ({ className = '' }) => <div className={`shimmer rounded-lg ${className}`} />;

/* "Empty" is four unrelated situations, not one (empty-states.md #7). Each gets its
   own glyph, tone and recovery verb; `error` is the only one tinted as a warning
   (#10). Copy speaks product voice, never system voice (#3). */
const EMPTY_KINDS = {
  'first-run': { icon: 'sparkles', tone: 'accent' },
  'no-results': { icon: 'search', tone: 'net' },
  'error': { icon: 'alert', tone: 'exp' },
  'filtered': { icon: 'filter', tone: 'accent' },
};

const EMPTY_TONE = {
  accent: { glow: 'bg-accent/10', text: 'text-txt-2' },
  net: { glow: 'bg-net/10', text: 'text-net' },
  exp: { glow: 'bg-exp/15', text: 'text-exp' },
};

const EmptyState = ({
  kind = 'first-run',
  icon,
  title,
  desc,
  action,
  secondaryAction,
  hiddenCount,
  className = '',
}) => {
  const spec = EMPTY_KINDS[kind] || EMPTY_KINDS['first-run'];
  const tone = EMPTY_TONE[spec.tone];
  const glyph = icon || spec.icon;
  const isError = kind === 'error';

  return (
    <div className={`flex flex-col items-center justify-center py-16 text-center ${className}`}>
      <div className="relative mb-5">
        <span className={`absolute inset-0 rounded-2xl blur-2xl opacity-60 ${tone.glow}`} />
        <div
          className={`relative p-4 rounded-2xl bg-surface-3 border ${isError ? 'border-exp/30' : 'border-bdr'}`}
        >
          <Icon name={glyph} size={28} className={tone.text} />
        </div>
      </div>
      <h3 className="text-base font-semibold text-txt-1 mb-1">{title}</h3>
      {desc && <p className="text-sm text-txt-2 max-w-sm leading-relaxed">{desc}</p>}
      {/* A filtered list is not really empty — say how much is being hidden (#9). */}
      {kind === 'filtered' && hiddenCount > 0 && (
        <p className="mt-1 text-sm text-txt-2">
          You have <span className="font-semibold text-txt-1">{hiddenCount}</span>{' '}
          {hiddenCount === 1 ? 'record' : 'records'}, but the current filters hide them all.
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
      {/* Exactly one filled action; alternates demote to a quiet text link (#6). */}
      {secondaryAction && <div className="mt-2.5 text-[13px] text-txt-3">{secondaryAction}</div>}
    </div>
  );
};

/* ----------------------------------------------------------------
   PasswordField — password-field.md + form-fields.md
   Label above, helper beneath; reveal toggle; segmented entropy meter with a
   word rating; live rule checklist as a *secondary* signal; paste never blocked.
   ---------------------------------------------------------------- */
const METER_TONE = ['bg-dng', 'bg-exp', 'bg-exp', 'bg-inc'];
const METER_TEXT = ['text-dng', 'text-exp', 'text-exp', 'text-inc'];

export const PasswordField = ({
  label,
  /* Optional trailing control on the label row (e.g. a "Forgot password?" link). */
  labelAction,
  value,
  onChange,
  name,
  autoComplete = 'new-password',
  placeholder = '',
  helper,
  /* Set once the value is known-good (e.g. confirm field matches). Confirmation
     belongs in the field, not in a toast (form-fields.md #5). */
  success,
  successMessage,
  error,
  /* The meter + checklist only make sense when inventing a password, not when
     typing an existing one. */
  showStrength = false,
  showRules = false,
  disabled = false,
  busy = false,
  id,
}) => {
  const [reveal, setReveal] = useState(false);
  const [pasted, setPasted] = useState(0);
  const autoId = useRef(`pw-${Math.random().toString(36).slice(2, 8)}`);
  const fieldId = id || autoId.current;
  const describedBy = `${fieldId}-help`;

  const { score, word, reasons } = useMemo(() => passwordStrength(value || ''), [value]);
  const rules = useMemo(() => passwordRules(value || ''), [value]);

  useEffect(() => {
    if (!value) setPasted(0);
  }, [value]);

  const state = error ? 'error' : success ? 'success' : 'default';
  const borderClass =
    state === 'error' ? 'border-dng/60' : state === 'success' ? 'border-inc/50' : 'border-bdr';

  return (
    <div>
      {/* Label lives outside the box so it survives once the box fills (#1–2). */}
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <label htmlFor={fieldId} className="text-[13px] font-medium text-txt-2">
          {label}
        </label>
        {labelAction}
      </div>

      <div className="relative">
        <input
          id={fieldId}
          name={name}
          type={reveal ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          /* Blocking paste breaks every password manager — allowing it is the
             security-positive default (password-field.md #9–10). */
          onPaste={(e) => {
            const text = e.clipboardData?.getData('text') || '';
            if (text) setPasted(text.length);
          }}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled || busy}
          aria-invalid={state === 'error'}
          aria-describedby={describedBy}
          className={`w-full bg-surface-2 border rounded-xl px-3.5 py-2.5 pr-20 text-sm text-txt-1 placeholder-txt-3 transition-colors focus-ring disabled:bg-surface-3 disabled:text-txt-3 disabled:cursor-not-allowed ${borderClass}`}
        />

        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {/* Error and success each carry an icon as well as colour (#4). */}
          {busy && <Icon name="spark" size={15} className="text-txt-3 anim-pulse-soft" />}
          {!busy && state === 'error' && <Icon name="alert" size={15} className="text-dng" />}
          {!busy && state === 'success' && <Icon name="check" size={15} className="text-inc" />}
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            disabled={disabled || busy}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            aria-pressed={reveal}
            className="p-1.5 rounded-lg text-txt-3 hover:text-txt-1 hover:bg-surface-4 transition active:scale-90 focus-ring disabled:opacity-50"
          >
            <Icon name={reveal ? 'eyeOff' : 'eye'} size={15} />
          </button>
        </div>
      </div>

      {/* Segmented bar + an explicit word, so the signal survives colour-blindness (#5). */}
      {showStrength && value && (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-[11px] uppercase tracking-ticker text-txt-3">Strength</span>
            <span className={`text-[11px] font-semibold ${METER_TEXT[score]}`}>{word}</span>
          </div>
          <div className="flex gap-1" role="img" aria-label={`Password strength: ${word}`}>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                  i <= score ? METER_TONE[score] : 'bg-surface-4'
                }`}
              />
            ))}
          </div>
          {/* Credit each gain to what the user just did, so the meter teaches (#6). */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {reasons.map((r) => (
              <span key={r} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-txt-3">
                {r}
              </span>
            ))}
            {pasted > 0 && (
              <span className="rounded-md bg-inc/10 px-1.5 py-0.5 font-mono text-[10px] text-inc">
                pasted · {pasted} chars
              </span>
            )}
          </div>
        </div>
      )}

      {/* Rules are disclosed before submit, never after (#3), and resolve live (#4). */}
      {showRules && (
        <ul className="mt-2.5 space-y-1">
          {rules.map((r) => (
            <li
              key={r.key}
              className={`flex items-center gap-2 text-xs transition-colors ${r.ok ? 'text-inc' : 'text-txt-3'}`}
            >
              <Icon name={r.ok ? 'check' : 'minus'} size={12} className="flex-shrink-0" />
              {r.label}
            </li>
          ))}
        </ul>
      )}

      <div id={describedBy} className="mt-1.5 min-h-[1rem]">
        {state === 'error' && <p className="text-xs text-dng">{error}</p>}
        {state === 'success' && successMessage && <p className="text-xs text-inc">{successMessage}</p>}
        {state === 'default' && helper && <p className="text-xs text-txt-3">{helper}</p>}
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   Button — hover, press and ripple are one gesture, not three (buttons.md #9)

   Hover lift/glow and the 0.95 press live in CSS (`.press` + `.btn-*` in
   index.css). This component adds the two things CSS cannot do:

     • the 1.05 release overshoot (#6) — needs the pointerup event, since CSS has
       no way to distinguish "never pressed" from "just released";
     • the ripple anchored at the contact point (#7) — needs the pointer coords.

   `loading`/`done` implement label-as-reward (§60): the label itself reports the
   outcome, so a confirming toast is not the only evidence the click landed.
   ---------------------------------------------------------------- */
const BTN_VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
};

const BTN_SIZES = {
  // 44px min height on the two sizes a thumb can reach (§100, tabs.md #9).
  sm: 'min-h-[36px] px-3 py-1.5 text-xs rounded-lg gap-1.5',
  md: 'min-h-[44px] px-4 py-2.5 text-sm rounded-xl gap-2',
  lg: 'min-h-[52px] px-6 py-3 text-base rounded-xl gap-2.5',
};

export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  done = false,
  loadingLabel,
  doneLabel,
  icon,
  iconRight,
  disabled = false,
  className = '',
  onPointerDown,
  ...rest
}) => {
  const reduced = useReducedMotion();
  const btnRef = useRef(null);
  const [ripples, setRipples] = useState([]);
  const rid = useRef(0);

  const busy = loading || done;
  const isDisabled = disabled || loading;

  const handlePointerDown = (e) => {
    onPointerDown?.(e);
    const el = btnRef.current;
    if (!el || isDisabled || reduced) return;

    // Squash while held, then hand the release to the overshoot keyframe. The
    // class is stripped on animationend so a second press can replay it.
    const release = () => {
      el.classList.add('btn-release');
      el.addEventListener('animationend', () => el.classList.remove('btn-release'), { once: true });
      el.removeEventListener('pointerup', release);
      el.removeEventListener('pointercancel', release);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    // Diameter = twice the distance to the farthest corner, so the wave always
    // reaches every edge no matter where in the button the pointer landed.
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const d = 2 * Math.max(Math.hypot(x, y), Math.hypot(r.width - x, y), Math.hypot(x, r.height - y), Math.hypot(r.width - x, r.height - y));
    const id = ++rid.current;
    setRipples((rs) => [...rs, { id, x, y, d }]);
    setTimeout(() => setRipples((rs) => rs.filter((p) => p.id !== id)), 600);
  };

  const label = loading ? loadingLabel || children : done ? doneLabel || children : children;

  return (
    <button
      ref={btnRef}
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onPointerDown={handlePointerDown}
      className={`press focus-ring relative overflow-hidden inline-flex items-center justify-center font-semibold ${
        BTN_VARIANTS[variant] || BTN_VARIANTS.primary
      } ${BTN_SIZES[size] || BTN_SIZES.md} ${block ? 'w-full btn-block' : ''} ${className}`}
      {...rest}
    >
      {ripples.map((p) => (
        <span key={p.id} className="btn-ripple" style={{ '--rx': `${p.x}px`, '--ry': `${p.y}px`, '--rd': `${p.d}px` }} />
      ))}
      {loading ? (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" />
      ) : done ? (
        <Icon name="check" size={16} className="shrink-0" />
      ) : icon ? (
        <Icon name={icon} size={16} className="shrink-0" />
      ) : null}
      <span className={busy ? 'anim-in' : undefined}>{label}</span>
      {iconRight && !busy ? <Icon name={iconRight} size={16} className="shrink-0" /> : null}
    </button>
  );
};

/* ----------------------------------------------------------------
   Tabs — a tab bar is a motion system, not a row of buttons (tabs.md)

   What this component owns, and why each piece is not optional:

   • The indicator SLIDES to its new position rather than being redrawn under
     the newly-active tab (#1). A hard cut gives the eye nothing to follow.
   • The whole list is ONE tab stop. Arrow keys rove focus, Home/End jump to
     the ends, and Tab leaves the group entirely (#6, #7) — otherwise a six-tab
     bar becomes six tab stops between the user and the content.
   • Focus and selection are drawn in DIFFERENT colours (#8), because after an
     arrow press they sit on different tabs. See `.focus-ring-tab` in index.css.
   • The row never wraps (#3); it scrolls behind edge fades (#4) with chevrons
     for pointer users, who have no swipe gesture (#5).

   Two variants: `pill` (a segmented control, the sliding fill) and `underline`
   (a full-width bar, the sliding rule).
   ---------------------------------------------------------------- */
const Tabs = ({ tabs, active, onChange, size = 'md', variant = 'pill', className = '', label = 'Sections' }) => {
  const trackRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });
  const [edges, setEdges] = useState({ left: false, right: false });

  const activeIndex = Math.max(0, tabs.findIndex((t) => t.key === active));

  // Re-measure on selection, on tab-set changes, and on resize — the indicator
  // is positioned in the track's coordinate space, so it scrolls with the row.
  useEffect(() => {
    const measure = () => {
      const el = trackRef.current?.querySelector(`[data-key="${CSS.escape(String(active))}"]`);
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active, tabs]);

  const syncEdges = () => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  };
  useEffect(syncEdges, [tabs]);

  // Keep the selected tab on screen when it is changed from the keyboard, or
  // arrowing past the fold would move focus to something the user cannot see.
  useEffect(() => {
    trackRef.current
      ?.querySelector(`[data-key="${CSS.escape(String(active))}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const select = (i) => {
    const next = tabs[(i + tabs.length) % tabs.length];
    if (!next) return;
    onChange(next.key);
    trackRef.current?.querySelector(`[data-key="${CSS.escape(String(next.key))}"]`)?.focus();
  };

  const onKeyDown = (e) => {
    const moves = {
      ArrowRight: activeIndex + 1,
      ArrowLeft: activeIndex - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(moves[e.key]);
  };

  const nudge = (dir) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: 'smooth' });
  };

  const underline = variant === 'underline';
  const pad = size === 'sm' ? 'px-3 min-h-[36px] text-xs' : 'px-4 min-h-[44px] text-sm';

  const Chevron = ({ dir, show }) =>
    show ? (
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => nudge(dir)}
        className="press hidden sm:flex absolute top-1/2 -translate-y-1/2 z-[2] h-7 w-7 items-center justify-center rounded-full bg-surface-3 border border-bdr text-txt-2 hover:text-txt-1"
        style={dir < 0 ? { left: 0 } : { right: 0 }}
      >
        <Icon name="chevRight" size={14} className={dir < 0 ? 'rotate-180' : ''} />
      </button>
    ) : null;

  return (
    <div className={`relative ${underline ? 'w-full' : 'inline-block'} ${className}`}>
      <span aria-hidden className={`edge-fade-l ${edges.left ? 'edge-fade-on' : ''}`} />
      <span aria-hidden className={`edge-fade-r ${edges.right ? 'edge-fade-on' : ''}`} />
      <Chevron dir={-1} show={edges.left} />
      <Chevron dir={1} show={edges.right} />

      <div
        ref={trackRef}
        role="tablist"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={onKeyDown}
        onScroll={syncEdges}
        className={`flex overflow-x-auto scrollbar-none ${
          underline ? 'relative gap-1 border-b border-bdr/60' : 'relative bg-surface-2 rounded-xl p-1 border border-bdr'
        }`}
      >
        <span
          aria-hidden
          className={
            underline
              ? 'absolute bottom-0 h-0.5 rounded-full bg-accent transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]'
              : 'absolute top-1 bottom-1 rounded-lg bg-surface-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]'
          }
          style={{ left: indicator.left, width: indicator.width, opacity: indicator.ready ? 1 : 0 }}
        />
        {tabs.map((tab) => {
          const on = active === tab.key;
          return (
            <button
              key={tab.key}
              data-key={tab.key}
              role="tab"
              type="button"
              id={`tab-${tab.key}`}
              aria-selected={on}
              aria-controls={`panel-${tab.key}`}
              /* Roving tabindex: exactly one stop for the whole list (#7). */
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(tab.key)}
              className={`focus-ring-tab relative z-10 shrink-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors ${pad} ${
                underline ? '' : 'rounded-lg'
              } ${on ? 'text-txt-1 font-semibold' : 'text-txt-3 hover:text-txt-2'}`}
            >
              {tab.label}
              {tab.badge != null && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md tabular ${on ? 'bg-accent/15 text-accent' : 'bg-surface-4/60 text-txt-3'}`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   TabPanel — content cross-fades through a hold; it never cuts (tabs.md #11)

   Out over 80ms, 80ms of nothing, in over 80ms. The empty beat is what lets the
   eye register that the content changed rather than that it was replaced.
   Reduced motion collapses the whole sequence to a swap.
   ---------------------------------------------------------------- */
export const TabPanel = ({ tabKey, children, className = '' }) => {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(tabKey);
  const [visible, setVisible] = useState(true);

  /* The parent hands us the NEW tab's children the instant `tabKey` flips, so
     fading `children` would fade the incoming content out. Hold the outgoing
     node until the swap lands. */
  const outgoing = useRef(children);
  if (tabKey === shown) outgoing.current = children;

  useEffect(() => {
    if (tabKey === shown) return;
    if (reduced) {
      setShown(tabKey);
      return;
    }
    setVisible(false);
    const t = setTimeout(() => {
      setShown(tabKey);
      setVisible(true);
    }, 160); // 80ms fade-out + 80ms hold
    return () => clearTimeout(t);
  }, [tabKey, shown, reduced]);

  return (
    <div
      role="tabpanel"
      id={`panel-${shown}`}
      aria-labelledby={`tab-${shown}`}
      className={`transition-opacity duration-[80ms] ease-out ${visible ? 'opacity-100' : 'opacity-0'} ${className}`}
    >
      {tabKey === shown ? children : outgoing.current}
    </div>
  );
};

/* ----------------------------------------------------------------
   Dialog behaviour — shared by Modal and Drawer (modals.md)
   Keeps the panel mounted through its exit animation, traps focus, closes on
   Escape, and locks the page behind it.
   ---------------------------------------------------------------- */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const useDialog = (open, onClose) => {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  // Hold the latest onClose in a ref so the focus/keydown effect below can call
  // it WITHOUT listing it as a dependency. Callers pass an inline arrow
  // (`onClose={() => setOpen(false)}`) whose identity changes on every parent
  // render; if the effect depended on it, each keystroke in a dialog form would
  // re-run the effect and yank focus back to the first focusable element.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    /* Under reduced motion the CSS animation is squashed to 0.01ms, so waiting on
       a fixed timer would leave the dialog hanging on screen. Unmount at once. */
    if (reduced) {
      setMounted(false);
      return;
    }
    setClosing(true);
    /* `animationend` is authoritative; the timer is only a fallback for the case
       where the animation never fires (e.g. the panel is display:none). */
    const id = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock the page behind the dialog so the backdrop doesn't scroll away.
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);

  // Escape to close + focus trap. Restores focus to whatever opened the dialog.
  useEffect(() => {
    if (!mounted || closing) return;
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    panel?.querySelector(FOCUSABLE)?.focus?.();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current?.(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      restoreRef.current?.focus?.();
    };
    // Deps are only the open/close transition — NOT onClose (read via ref above).
  }, [mounted, closing]);

  const onAnimationEnd = (e) => {
    if (closing && e.target === panelRef.current) setMounted(false);
  };

  return { mounted, closing, panelRef, onAnimationEnd };
};

/* Close button reacts to the cursor — "every pixel reacts" (modals.md #6). */
const DialogClose = ({ onClose }) => (
  <button
    type="button"
    onClick={onClose}
    aria-label="Close"
    className="p-1.5 rounded-lg hover:bg-surface-4 transition text-txt-2 hover:text-txt-1 flex-shrink-0 active:scale-90 focus-ring"
  >
    <Icon name="x" size={18} />
  </button>
);

/* ----------------------------------------------------------------
   Modal
   ---------------------------------------------------------------- */
const Modal = ({ open, onClose, title, children, eyebrow }) => {
  const { mounted, closing, panelRef, onAnimationEnd } = useDialog(open, onClose);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Blurring the page behind pushes it back in space so the dialog floats (#5). */}
      <div className={`absolute inset-0 bg-black/70 backdrop-blur-md ${closing ? 'backdrop-out' : 'anim-in'}`} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onAnimationEnd={onAnimationEnd}
        className={`relative bg-surface-2 border border-bdr rounded-2xl max-w-lg w-full max-h-[85vh] overflow-auto ${closing ? 'dialog-out' : 'dialog-in'}`}
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 40px 100px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(76,110,245,0.04)' }}
      >
        <div className={closing ? '' : 'dialog-stagger'}>
          <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-bdr/60 flex items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              {eyebrow && (
                <div className="font-mono text-[10px] uppercase tracking-ticker text-txt-3 mb-1.5">{eyebrow}</div>
              )}
              <h3 className="text-base sm:text-lg font-semibold tracking-tight truncate">{title}</h3>
            </div>
            <DialogClose onClose={onClose} />
          </div>
          <div className="p-4 sm:p-6">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

/* ----------------------------------------------------------------
   Drawer
   ---------------------------------------------------------------- */
const Drawer = ({ open, onClose, title, eyebrow, children }) => {
  const { mounted, closing, panelRef, onAnimationEnd } = useDialog(open, onClose);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className={`absolute inset-0 bg-black/55 backdrop-blur-sm ${closing ? 'backdrop-out' : 'anim-in'}`}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onAnimationEnd={onAnimationEnd}
        className={`absolute inset-y-0 right-0 w-full max-w-md bg-surface-2 border-l border-bdr overflow-auto ${closing ? 'drawer-out' : 'drawer-in'}`}
        style={{ boxShadow: '-30px 0 60px -20px rgba(0,0,0,0.6)' }}
      >
        <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-bdr/60 flex items-start justify-between gap-3 sm:gap-4 sticky top-0 bg-surface-2/95 backdrop-blur z-10">
          <div className="min-w-0">
            {eyebrow && (
              <div className="font-mono text-[10px] uppercase tracking-ticker text-txt-3 mb-1.5">{eyebrow}</div>
            )}
            <h3 className="text-base sm:text-lg font-semibold tracking-tight truncate">{title}</h3>
          </div>
          <DialogClose onClose={onClose} />
        </div>
        <div className={`p-4 sm:p-5 ${closing ? '' : 'dialog-stagger'}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
};

/* ----------------------------------------------------------------
   ProgressBar — determinate, honest (design corpus §86–89)
   Bind `value` to REAL progress; the eased width transition front-loads
   the perceived curve (§88) without ever exceeding the true value (§89).
   ---------------------------------------------------------------- */
export const ProgressBar = ({ value = 0, label, sublabel, tone = 'accent', showPct = true, indeterminate = false }) => {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const toneClass = tone === 'inc' ? 'bg-inc' : tone === 'dng' ? 'bg-dng' : tone === 'exp' ? 'bg-exp' : 'bg-accent';
  const showPctNum = showPct && !indeterminate;
  return (
    <div className="w-full">
      {(label || showPctNum) && (
        <div className="flex items-center justify-between mb-1.5 gap-3">
          {label && <span className="text-sm text-txt-2 truncate">{label}</span>}
          {showPctNum && <span className="text-sm font-semibold tabular text-txt-1 flex-shrink-0">{pct}%</span>}
        </div>
      )}
      <div
        className="h-2 rounded-full bg-surface-4 overflow-hidden"
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {indeterminate ? (
          <div className={`h-full w-2/5 rounded-full ${toneClass} anim-progress-indeterminate`} />
        ) : (
          <div
            className={`h-full rounded-full ${toneClass} transition-[width] duration-500 ease-out`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {sublabel && <div className="mt-1 text-xs text-txt-3">{sublabel}</div>}
    </div>
  );
};

/* ----------------------------------------------------------------
   ErrorState — classified full-surface failure (error-states.md #3, §61)
   Names the cause, shows WHERE it stopped + WHEN (timestamp), and hands the
   user a way forward (retry) + a way to reach a human (escalate).
   ---------------------------------------------------------------- */
export const ErrorState = ({
  title = 'Something went wrong',
  cause,
  timestamp,
  code,
  stage,
  progress,
  onRetry,
  retryLabel = 'Try again',
  retryDisabled = false,
  onContactSupport,
  icon = 'alert',
}) => {
  const ts = timestamp ? new Date(timestamp) : null;
  return (
    <div className="rounded-2xl border border-dng/30 bg-dng/5 p-5 sm:p-6 text-center flex flex-col items-center">
      <div className="p-3 rounded-2xl bg-dng/10 border border-dng/20 mb-4">
        <Icon name={icon} size={26} className="text-dng" />
      </div>
      <h3 className="text-base font-semibold text-txt-1 mb-1">{title}</h3>
      {cause && <p className="text-sm text-txt-2 max-w-md leading-relaxed">{cause}</p>}
      {(stage || progress != null) && (
        <p className="mt-1.5 text-xs text-txt-3">
          Stopped{stage ? ` at "${stage}"` : ''}{progress != null ? ` — ${progress}%` : ''}
        </p>
      )}
      {(ts || code) && (
        <p className="mt-2 font-mono text-[11px] text-txt-3">
          {ts ? ts.toLocaleString() : ''}{ts && code ? ' · ' : ''}{code || ''}
        </p>
      )}
      {(onRetry || onContactSupport) && (
        <div className="mt-4 flex items-center gap-3">
          {onRetry && (
            <button
              onClick={onRetry}
              disabled={retryDisabled}
              className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {retryLabel}
            </button>
          )}
          {onContactSupport && (
            <button
              onClick={onContactSupport}
              className="text-sm text-txt-2 hover:text-txt-1 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-accent rounded"
            >
              Contact support
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/* ----------------------------------------------------------------
   Toasts — severity-scaled dismissal, capped stack, twice-encoded type
   (toasts.md: #1 anchor bottom-right, #2 scale by severity, #3 errors
   persist until acknowledged, #4 cap 3 + evict oldest, #6 escape hatch,
   #7 hover pauses, #8 icon + colored edge).
   Module-level `toast.*` so any code (incl. api.js) can fire; `<ToastProvider/>`
   mounted once renders the stack.
   ---------------------------------------------------------------- */
const TOAST_TONES = {
  success: { edge: 'bg-inc', icon: 'check', fg: 'text-inc' },
  error:   { edge: 'bg-dng', icon: 'alert', fg: 'text-dng' },
  warning: { edge: 'bg-exp', icon: 'alert', fg: 'text-exp' },
  info:    { edge: 'bg-net', icon: 'spark', fg: 'text-net' },
};
// Dismiss duration scales with severity; error = null (persists until acknowledged).
const TOAST_TTL = { success: 4000, info: 4000, warning: 7000, error: null };

let _toastId = 0;
const _toastListeners = new Set();

export const toast = {
  show: (type, message, opts = {}) => {
    const id = ++_toastId;
    _toastListeners.forEach((fn) => fn({ id, type, message, title: opts.title, ttl: opts.ttl }));
    return id;
  },
  success: (m, o) => toast.show('success', m, o),
  error: (m, o) => toast.show('error', m, o),
  warning: (m, o) => toast.show('warning', m, o),
  info: (m, o) => toast.show('info', m, o),
};

const ToastCard = ({ t, onDismiss }) => {
  const tone = TOAST_TONES[t.type] || TOAST_TONES.info;
  const ttl = t.ttl !== undefined ? t.ttl : TOAST_TTL[t.type];
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(null);

  const close = () => {
    setLeaving(true);
    setTimeout(() => onDismiss(t.id), 180);
  };
  const startTimer = () => {
    if (ttl == null) return; // errors persist
    timer.current = setTimeout(close, ttl);
  };
  const pauseTimer = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };
  useEffect(() => {
    startTimer();
    return pauseTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
      role={t.type === 'error' ? 'alert' : 'status'}
      className={`relative flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-bdr bg-surface-2/95 backdrop-blur pl-4 pr-2 py-3 shadow-lg transition-all duration-200 ${
        leaving ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'
      }`}
    >
      <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-full ${tone.edge}`} />
      <Icon name={tone.icon} size={18} className={`${tone.fg} mt-0.5 flex-shrink-0`} />
      <div className="min-w-0 flex-1">
        {t.title && <div className="text-sm font-semibold text-txt-1">{t.title}</div>}
        <div className="text-sm text-txt-2 break-words">{t.message}</div>
      </div>
      <button
        onClick={close}
        aria-label="Dismiss"
        className="p-1 rounded-md text-txt-3 hover:text-txt-1 hover:bg-surface-4 flex-shrink-0 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
};

// Cap the stack at 3 (toasts.md #4). Errors persist until acknowledged (#3), so
// when we're over the cap we evict the oldest NON-error first and only fall back
// to dropping an error if every visible toast is an error — otherwise a burst of
// success/info toasts could silently discard an unacknowledged failure.
const TOAST_CAP = 3;
const capToasts = (list) => {
  if (list.length <= TOAST_CAP) return list;
  const next = [...list];
  while (next.length > TOAST_CAP) {
    const idx = next.findIndex((t) => t.type !== 'error');
    next.splice(idx === -1 ? 0 : idx, 1);
  }
  return next;
};

export const ToastProvider = () => {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const onEmit = (t) => setItems((prev) => capToasts([...prev, t]));
    _toastListeners.add(onEmit);
    return () => _toastListeners.delete(onEmit);
  }, []);
  const dismiss = (id) => setItems((prev) => prev.filter((t) => t.id !== id));
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard t={t} onDismiss={dismiss} />
        </div>
      ))}
    </div>,
    document.body,
  );
};

/* ----------------------------------------------------------------
   Segmented control (sliding) — alias for Tabs in compact mode.
   Use this for an EXCLUSIVE facet with fewer than five options; use ChipRow
   below when the option set is long enough to scroll (tabs.md #10).
   ---------------------------------------------------------------- */
export const Segmented = ({ options, value, onChange, label }) => (
  <Tabs tabs={options} active={value} onChange={onChange} size="sm" label={label} />
);

/* ----------------------------------------------------------------
   FilterChip — three states, each carried by more than one cue (filter-chips.md)

   The failure this exists to prevent: an active state that differs from idle by
   a tint alone reads as "my tap did nothing", so the user taps again and undoes
   their own selection (#2, #5). Active therefore flips fill, text colour, border
   AND gains a leading checkmark. Disabled drops its border and dims — nothing is
   behind it, and it must not look merely unselected (#1).

   `count` is the number of records behind the chip. A chip with none is disabled
   rather than hidden, so the option set stays stable between filter changes.
   ---------------------------------------------------------------- */
export const FilterChip = ({ active = false, disabled = false, count, onClick, children }) => (
  <button
    type="button"
    /* A filter chip is a toggle button, not a switch: `aria-pressed` is what a
       screen reader announces as "pressed / not pressed" on a control that
       applies a filter, whereas `role="switch"` implies an on/off setting. */
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={`press focus-ring shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3.5 min-h-[36px] text-xs font-medium ${
      disabled
        ? 'bg-surface-2/40 border-transparent text-txt-4 cursor-not-allowed'
        : active
          ? 'bg-accent border-accent text-deep font-semibold'
          : 'bg-surface-2 border-bdr text-txt-2 hover:text-txt-1 hover:border-bdr-hover'
    }`}
  >
    {active && <Icon name="check" size={13} className="shrink-0" />}
    {children}
    {count != null && (
      <span className={`tabular text-[10px] ${active ? 'text-deep/70' : 'text-txt-3'}`}>{count}</span>
    )}
  </button>
);

/* ----------------------------------------------------------------
   ChipRow — one scrolling line, never a wrapped wall (filter-chips.md #8–#9)

   A chip set that wraps eats the vertical space the results need and pushes the
   content the user came for below the fold. This caps the header height however
   many chips exist, and fades the edge so the off-screen ones are discoverable.

   `activeCount` + `onClear` are the escape hatch (#6–#7): undoing filters one at
   a time is tedious enough that users abandon the page, and the tally tells them
   the size of what they are about to discard before they commit.
   ---------------------------------------------------------------- */
export const ChipRow = ({ children, activeCount = 0, onClear, resultCount, resultNoun = 'results', className = '' }) => {
  const trackRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const syncEdges = () => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft < max - 4 });
  };
  useEffect(syncEdges, [children]);

  return (
    <div className={className}>
      {(activeCount > 0 || resultCount != null) && (
        <div className="flex items-center justify-between gap-3 mb-2 px-0.5">
          <span className="text-[11px] text-txt-3 tabular">
            {/* The count moves on the same frame as the toggle (#4) — no Apply button. */}
            {resultCount != null && `${resultCount} ${resultNoun}`}
          </span>
          {activeCount > 0 && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="press focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-txt-2 hover:text-txt-1"
            >
              <Icon name="x" size={12} />
              Clear {activeCount} {activeCount === 1 ? 'filter' : 'filters'}
            </button>
          )}
        </div>
      )}
      <div className="relative">
        <span aria-hidden className={`edge-fade-l ${edges.left ? 'edge-fade-on' : ''}`} />
        <span aria-hidden className={`edge-fade-r ${edges.right ? 'edge-fade-on' : ''}`} />
        <div ref={trackRef} onScroll={syncEdges} className="flex gap-2 overflow-x-auto scrollbar-none py-0.5">
          {children}
        </div>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   OtpInput — six boxes that behave as one field (otp-input.md)

   The whole component is one string of state rendered across N slots (#4), which
   is what makes paste, clearing and validation trivial. It handles:
     • paste — strip non-digits, spread across slots, don't dump into one box (#1)
     • auto-advance after each digit, backspace-into-empty steps back (#2, #3)
     • inputmode=numeric + autocomplete=one-time-code so the OS keypad and SMS
       autofill both engage (#5, #6)
     • `error` triggers a shake, clear and refocus on box 1 (#8) — the caller
       flips it on a rejected code.

   `value`/`onChange` keep the source of truth in the parent so the same string
   gates the submit button, exactly like a normal input.
   ---------------------------------------------------------------- */
export const OtpInput = ({ value = '', onChange, length = 6, onComplete, error = false, disabled = false, autoFocus = false }) => {
  const refs = useRef([]);
  const wrapRef = useRef(null);
  const digits = value.split('').slice(0, length);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // On a rejected code the parent flips `error`: shake, then clear and refocus.
  useEffect(() => {
    if (!error) return;
    const el = wrapRef.current;
    el?.classList.remove('shake-x');
    void el?.offsetWidth; // reflow so the animation can replay
    el?.classList.add('shake-x');
    onChange?.('');
    const t = setTimeout(() => refs.current[0]?.focus(), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // The value is a left-packed digit string, one char per slot. Edit it
  // explicitly so a keystroke never lands in the wrong box: overwrite when the
  // slot is already filled, append when it's the next empty slot, and remove on
  // clear. (The previous `next[i] = d` on a split array produced sparse holes —
  // typing into a non-adjacent box silently placed the digit elsewhere.)
  const setAt = (i, d) => {
    const chars = value.split('');
    if (d === '') chars.splice(i, 1);
    else if (i < chars.length) chars[i] = d;
    else chars.push(d);
    const joined = chars.join('').replace(/\D/g, '').slice(0, length);
    onChange?.(joined);
    if (joined.length === length) onComplete?.(joined);
  };

  const onKey = (i) => (e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) setAt(i, '');
      else if (i > 0) {
        const next = value.slice(0, i - 1);
        onChange?.(next);
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus();
  };

  const onInput = (i) => (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(-1);
    if (!d) return;
    setAt(i, d);
    if (i < length - 1) refs.current[i + 1]?.focus();
  };

  const onPaste = (e) => {
    e.preventDefault();
    const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, length);
    if (!pasted) return;
    onChange?.(pasted);
    if (pasted.length === length) onComplete?.(pasted);
    refs.current[Math.min(pasted.length, length - 1)]?.focus();
  };

  return (
    <div ref={wrapRef} className="flex gap-2" onPaste={onPaste}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          value={digits[i] || ''}
          onChange={onInput(i)}
          onKeyDown={onKey(i)}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          aria-label={`Digit ${i + 1} of ${length}`}
          className={`focus-ring w-11 h-12 sm:w-12 sm:h-14 text-center text-lg font-semibold tabular rounded-xl border bg-surface-3 text-txt-1 ${
            error ? 'border-dng/60' : digits[i] ? 'border-accent/50' : 'border-bdr'
          }`}
        />
      ))}
    </div>
  );
};

/* Countdown gate for a resend control (otp-input.md #7). Start it when a code is
   sent; the button stays disabled with a live count until it hits zero, so
   spam-clicking can't trip server-side rate limiting. */
export const useCooldown = (seconds = 30) => {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(t);
  }, [left]);
  return [left, () => setLeft(seconds)];
};

/* ----------------------------------------------------------------
   Pager — a truncated numbered pager (pagination.md)

   For a table someone scans and wants to jump around in, numbered pages beat a
   bare prev/next because they let the reader leap to an arbitrary position (#3).
   The range is never printed in full: it collapses to first · gap · a small
   window around the current page · gap · last (#4), and the two endpoints stay
   pinned so the reader can always reset to the start or jump to the end (#5).

   `page` is 1-indexed. `siblings` controls how many pages flank the current one.
   ---------------------------------------------------------------- */
const pagerRange = (page, total, siblings = 1) => {
  const span = siblings * 2 + 5; // first, last, current, 2 gaps, + window
  if (total <= span) return Array.from({ length: total }, (_, i) => i + 1);

  const left = Math.max(page - siblings, 1);
  const right = Math.min(page + siblings, total);
  // No gap means `left`/`right` already sit adjacent to the pinned endpoints
  // (left ≤ 2, right ≥ total-1), so there are no in-between pages to fill — the
  // window loop below covers them. Only the gap markers are conditional.
  const showLeftGap = left > 2;
  const showRightGap = right < total - 1;
  const out = [1];
  if (showLeftGap) out.push('gap-l');
  for (let i = left; i <= right; i++) if (i !== 1 && i !== total) out.push(i);
  if (showRightGap) out.push('gap-r');
  out.push(total);
  return out;
};

export const Pager = ({ page, total, onChange, className = '' }) => {
  if (total <= 1) return null;
  const cells = pagerRange(page, total);
  const go = (p) => onChange(Math.min(Math.max(1, p), total));
  const cellBase =
    'press focus-ring min-w-[36px] h-9 px-2 inline-flex items-center justify-center rounded-lg text-sm tabular border';

  return (
    <nav aria-label="Pagination" className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className={`${cellBase} border-bdr bg-surface-3 text-txt-2 hover:text-txt-1 disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <Icon name="chevRight" size={15} className="rotate-180" />
      </button>
      {cells.map((c, i) =>
        typeof c === 'string' ? (
          <span key={c + i} aria-hidden className="min-w-[24px] text-center text-txt-3 select-none">…</span>
        ) : (
          <button
            key={c}
            type="button"
            onClick={() => go(c)}
            aria-current={c === page ? 'page' : undefined}
            className={`${cellBase} ${
              c === page
                ? 'border-accent bg-accent text-deep font-semibold'
                : 'border-bdr bg-surface-3 text-txt-2 hover:text-txt-1'
            }`}
          >
            {c}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= total}
        aria-label="Next page"
        className={`${cellBase} border-bdr bg-surface-3 text-txt-2 hover:text-txt-1 disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        <Icon name="chevRight" size={15} />
      </button>
    </nav>
  );
};

/* ----------------------------------------------------------------
   Stat row helper
   ---------------------------------------------------------------- */
export const StatRow = ({ label, value, accent = 'txt-1', mono = true }) => (
  <div className="flex items-center justify-between py-2.5 border-b border-bdr/50 last:border-0">
    <span className="text-sm text-txt-2">{label}</span>
    <span className={`text-sm font-semibold ${accent === 'inc' ? 'text-inc' : accent === 'exp' ? 'text-exp' : accent === 'net' ? 'text-net' : 'text-txt-1'} ${mono ? 'tabular' : ''}`}>{value}</span>
  </div>
);

export { Badge, KpiCard, Skeleton, EmptyState, Tabs, Modal, Drawer };

