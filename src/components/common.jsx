import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useInView } from './useInView';
import { Icon } from './Icon';
import { useTheme } from '../data/theme';
import { useT } from '../data/i18n';

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
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute inset-0 rounded-[10px]"
        style={{
          background: 'linear-gradient(140deg, rgb(var(--c-s4)) 0%, rgb(var(--c-s1)) 100%)',
          border: '1px solid rgba(76,110,245,0.35)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 6px 18px -6px rgba(76,110,245,0.45)',
        }}
      />
      <Icon name="aperture" size={size * 0.62} className="relative text-accent" />
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
  const startedRef = useRef(false);

  useEffect(() => {
    if (!visible || startedRef.current) return;
    startedRef.current = true;
    const target = Number(value) || 0;
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
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
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={path.area} fill={`url(#${id})`} />}
      <path
        d={path.line}
        stroke={color}
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
const accentColor = {
  accent: '#4C6EF5', income: '#10B981', expense: '#F59E0B', net: '#06B6D4', danger: '#EF4444',
};
const accentText = {
  accent: 'text-accent', income: 'text-inc', expense: 'text-exp', net: 'text-net', danger: 'text-dng',
};

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
}) => {
  const isHero = variant === 'hero';
  const isCompact = variant === 'compact';
  const color = accentColor[accent] || accentColor.accent;
  const textC = accentText[accent] || accentText.accent;

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
        <span className="text-[10px] sm:text-[11px] tracking-ticker uppercase text-txt-3 font-medium truncate min-w-0">{label}</span>
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

const EmptyState = ({ icon = 'file', title, desc, action }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="relative mb-5">
      <span className="absolute inset-0 rounded-2xl bg-accent/10 blur-2xl opacity-60" />
      <div className="relative p-4 rounded-2xl bg-surface-3 border border-bdr">
        <Icon name={icon} size={28} className="text-txt-2" />
      </div>
    </div>
    <h3 className="text-base font-semibold text-txt-1 mb-1">{title}</h3>
    <p className="text-sm text-txt-2 mb-4 max-w-sm leading-relaxed">{desc}</p>
    {action}
  </div>
);

/* ----------------------------------------------------------------
   Tabs — sliding underline indicator
   ---------------------------------------------------------------- */
const Tabs = ({ tabs, active, onChange, size = 'md' }) => {
  const wrapRef = useRef(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const el = wrapRef.current?.querySelector(`[data-key="${active}"]`);
    if (el) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [active, tabs]);

  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';

  return (
    <div ref={wrapRef} className="relative inline-flex bg-surface-2 rounded-xl p-1 border border-bdr">
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-lg bg-surface-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ left: indicator.left, width: indicator.width }}
      />
      {tabs.map((tab) => (
        <button
          key={tab.key}
          data-key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`relative z-10 ${pad} rounded-lg font-medium transition-colors ${
            active === tab.key ? 'text-txt-1' : 'text-txt-3 hover:text-txt-2'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
};

/* ----------------------------------------------------------------
   Modal
   ---------------------------------------------------------------- */
const Modal = ({ open, onClose, title, children, eyebrow }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md anim-in" />
      <div
        className="relative bg-surface-2 border border-bdr rounded-2xl max-w-lg w-full max-h-[85vh] overflow-auto anim-up"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 40px 100px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(76,110,245,0.04)' }}
      >
        <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-bdr/60 flex items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            {eyebrow && (
              <div className="font-mono text-[10px] uppercase tracking-ticker text-txt-3 mb-1.5">{eyebrow}</div>
            )}
            <h3 className="text-base sm:text-lg font-semibold tracking-tight truncate">{title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-4 transition text-txt-2 hover:text-txt-1 flex-shrink-0">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   Drawer
   ---------------------------------------------------------------- */
const Drawer = ({ open, onClose, title, eyebrow, children }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm anim-in" onClick={onClose} />
      <div
        className="absolute inset-y-0 right-0 w-full max-w-md bg-surface-2 border-l border-bdr overflow-auto"
        style={{
          animation: 'slideRight 0.32s cubic-bezier(0.4,0,0.2,1) both',
          boxShadow: '-30px 0 60px -20px rgba(0,0,0,0.6)',
        }}
      >
        <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-bdr/60 flex items-start justify-between gap-3 sm:gap-4 sticky top-0 bg-surface-2/95 backdrop-blur z-10">
          <div className="min-w-0">
            {eyebrow && (
              <div className="font-mono text-[10px] uppercase tracking-ticker text-txt-3 mb-1.5">{eyebrow}</div>
            )}
            <h3 className="text-base sm:text-lg font-semibold tracking-tight truncate">{title}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-4 text-txt-2 hover:text-txt-1 flex-shrink-0">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------
   Segmented control (sliding) — alias for Tabs in compact mode
   ---------------------------------------------------------------- */
export const Segmented = ({ options, value, onChange }) => (
  <Tabs tabs={options} active={value} onChange={onChange} size="sm" />
);

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
