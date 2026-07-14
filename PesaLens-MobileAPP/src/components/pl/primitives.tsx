import React, { ReactNode, useRef, useCallback, useState, useMemo, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Sparkles, Search, Filter, Eye, EyeOff, Check, Minus, X, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { passwordStrength, passwordRules } from "@/data/password";

export const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("eyebrow", className)}>{children}</div>
);

export const CardSoft = ({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) => (
  <div onClick={onClick} className={cn("card-soft p-4", onClick && "active:scale-[0.99] transition-transform cursor-pointer", className)}>
    {children}
  </div>
);

/* Bento — the web client's signature surface (green-tinted border,
   press-lift). The default card for the mirrored design. */
export const Bento = ({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) => (
  <div onClick={onClick} className={cn("bento p-4", onClick && "cursor-pointer", className)}>
    {children}
  </div>
);

/* Frosted brand-glow panel — AI hero / spotlight surfaces. */
export const GlassCard = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("glass-card p-4", className)}>{children}</div>
);

/* Pointer-driven 3D tilt (the "little 3D movement"). Static on touch. */
export const Tilt = ({ children, className, max = 6 }: { children: ReactNode; className?: string; max?: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const el = ref.current;
      if (!el || e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el.style.setProperty("--rx", `${(px - 0.5) * max * 2}deg`);
      el.style.setProperty("--ry", `${(0.5 - py) * max * 2}deg`);
    },
    [max],
  );
  const reset = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
  }, []);
  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={reset} className={cn("tilt-3d", className)}>
      {children}
    </div>
  );
};

export const SurfaceInset = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("surface-inset p-3", className)}>{children}</div>
);

export const Section = ({
  eyebrow,
  title,
  action,
  children,
  className,
}: {
  eyebrow?: string;
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <section className={cn("space-y-3", className)}>
    {(eyebrow || title || action) && (
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          {title && <h2 className="text-[17px] font-semibold leading-tight text-txt-1 mt-0.5">{title}</h2>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    )}
    {children}
  </section>
);

export const Badge = ({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "accent" | "inc" | "exp" | "dng" | "net" | "muted";
  className?: string;
}) => {
  const tones: Record<string, string> = {
    accent: "bg-accent/15 text-accent",
    inc: "bg-inc/15 text-inc",
    exp: "bg-exp/15 text-exp",
    dng: "bg-dng/15 text-dng",
    net: "bg-net/15 text-net",
    muted: "bg-surface-4 text-txt-2",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider font-mono-tab", tones[tone], className)}>
      {children}
    </span>
  );
};

export const Divider = ({ className }: { className?: string }) => <div className={cn("hairline", className)} />;

/* Pill / FilterChip — three states, each carried by more than one cue
   (filter-chips.md #1–#2).

   The failure this prevents: an active state that differs from idle by a tint
   alone reads as "my tap did nothing", so the user taps again and undoes their
   own selection (#5). Active flips fill, text colour AND border, and gains a
   leading checkmark. Disabled drops its border and dims — nothing sits behind
   it, and it must not merely look unselected.

   `count` is the number of records behind the chip; a chip with none is disabled
   rather than removed, so the option set stays stable across filter changes.
   The 36px min height keeps it inside the thumb-target floor. */
export const Pill = ({
  active,
  disabled,
  count,
  children,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  count?: number | null;
  children: ReactNode;
  onClick?: () => void;
}) => (
  <button
    type="button"
    /* A filter chip is a toggle button, not a switch: `aria-pressed` announces
       "pressed / not pressed" on a control that applies a filter, whereas
       `role="switch"` implies an on/off setting. */
    aria-pressed={!!active}
    disabled={disabled}
    onClick={onClick}
    className={cn(
      "press focus-ring shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3.5 min-h-[36px] text-xs font-medium",
      disabled
        ? "bg-surface-2/40 border-transparent text-txt-4"
        : active
          ? "bg-primary border-primary text-primary-foreground font-semibold"
          : "bg-surface-2 text-txt-2 border-border hover:text-txt-1"
    )}
  >
    {active && <Check className="w-3 h-3 shrink-0" />}
    {children}
    {count != null && (
      <span className={cn("tabular text-[10px]", active ? "text-primary-foreground/70" : "text-txt-3")}>{count}</span>
    )}
  </button>
);

/* ChipRow — one scrolling line, never a wrapped wall (filter-chips.md #8–#9).
   A wrapped chip set eats the vertical space the results need and buries the
   content below the fold; on a phone that is most of the screen. `activeCount` +
   `onClear` are the escape hatch (#6–#7): the tally tells the user the size of
   what they are about to discard before they commit. */
export const ChipRow = ({
  children,
  activeCount = 0,
  onClear,
  resultCount,
  resultNoun = "results",
  className,
}: {
  children: ReactNode;
  activeCount?: number;
  onClear?: () => void;
  resultCount?: number | null;
  resultNoun?: string;
  className?: string;
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
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
        <div className="flex items-center justify-between gap-3 mb-2 px-1">
          {/* The count moves on the same frame as the toggle (#4) — no Apply button. */}
          <span className="text-[11px] text-txt-3 tabular">
            {resultCount != null && `${resultCount} ${resultNoun}`}
          </span>
          {activeCount > 0 && onClear && (
            <button
              type="button"
              onClick={onClear}
              className="press focus-ring inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-txt-2"
            >
              <X className="w-3 h-3" />
              Clear {activeCount} {activeCount === 1 ? "filter" : "filters"}
            </button>
          )}
        </div>
      )}
      <div className="relative">
        <span aria-hidden className={cn("edge-fade-l", edges.left && "edge-fade-on")} />
        <span aria-hidden className={cn("edge-fade-r", edges.right && "edge-fade-on")} />
        <div ref={trackRef} onScroll={syncEdges} className="flex gap-2 overflow-x-auto scroll-hide py-0.5">
          {children}
        </div>
      </div>
    </div>
  );
};

/* Segmented — an EXCLUSIVE facet with fewer than five options collapses into a
   segmented control rather than a tab row (tabs.md #10). One tab stop for the
   whole group; arrows rove within it, Tab leaves it (#6–#7). The keyboard ring
   uses the blue secondary so it never reads as the selection (#8). */
export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  label = "Options",
  className,
}: {
  options: { key: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
  className?: string;
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false });
  const activeIndex = Math.max(0, options.findIndex((o) => o.key === value));

  useEffect(() => {
    const measure = () => {
      const el = trackRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(String(value))}"]`);
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value, options]);

  const select = (i: number) => {
    const next = options[(i + options.length) % options.length];
    if (!next) return;
    onChange(next.key);
    trackRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(String(next.key))}"]`)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowRight: activeIndex + 1,
      ArrowLeft: activeIndex - 1,
      Home: 0,
      End: options.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    select(moves[e.key]);
  };

  return (
    <div
      ref={trackRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn("relative inline-flex bg-surface-2 rounded-xl p-1 border border-border", className)}
    >
      {/* The indicator slides; it never teleports (tabs.md #1). */}
      <span
        aria-hidden
        className="absolute top-1 bottom-1 rounded-lg bg-surface-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ left: indicator.left, width: indicator.width, opacity: indicator.ready ? 1 : 0 }}
      />
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            data-key={o.key}
            role="tab"
            type="button"
            aria-selected={on}
            /* Roving tabindex: exactly one stop for the whole group (#7). */
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.key)}
            className={cn(
              "focus-ring-tab relative z-10 shrink-0 rounded-lg px-3 min-h-[36px] text-xs font-medium transition-colors",
              on ? "text-txt-1 font-semibold" : "text-txt-3"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

/* ----------------------------------------------------------------
   Tooltip / InfoHint — a hint, not documentation (tooltips.md)

   On a phone there is no hover, so this is tap-to-toggle rather than
   hover-delay (#1 is a no-op on touch). It still honours the rules that DO
   apply: an arrow tail anchors it to its trigger (#2), it flips to stay in
   the viewport (#3), every dismissal route is wired — tap the trigger again,
   tap outside, Escape, scroll (#4) — and it is capped narrow and to one
   sentence (#5–#6).
   ---------------------------------------------------------------- */
export const InfoHint = ({
  content,
  side = "top",
  label = "More information",
}: {
  content: ReactNode;
  side?: "top" | "bottom";
  label?: string;
}) => {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState(side);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Flip to the opposite side when the preferred one would overflow.
  useEffect(() => {
    if (!open) return;
    const anchor = wrapRef.current;
    const b = bubbleRef.current;
    if (!anchor || !b) return;
    const r = anchor.getBoundingClientRect();
    const h = b.getBoundingClientRect().height;
    if (side === "top" && r.top - h < 8) setPlacement("bottom");
    else if (side === "bottom" && r.bottom + h > window.innerHeight - 8) setPlacement("top");
    else setPlacement(side);
  }, [open, side]);

  const pos = placement === "top" ? "bottom-full mb-2" : "top-full mt-2";
  const arrow = placement === "top" ? "top-full -mt-1" : "bottom-full -mb-1";

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="focus-ring inline-flex items-center justify-center w-4 h-4 rounded-full text-txt-3 border border-border align-middle"
      >
        <Info className="w-2.5 h-2.5" />
      </button>
      {open && (
        <span
          ref={bubbleRef}
          role="tooltip"
          className={cn(
            "absolute z-50 left-1/2 -translate-x-1/2 max-w-[240px] w-max px-2.5 py-1.5 rounded-lg text-[11.5px] leading-snug text-txt-1 bg-surface-4 border border-border shadow-lg",
            pos
          )}
        >
          {content}
          <span aria-hidden className={cn("absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-surface-4 border-b border-r border-border", arrow)} />
        </span>
      )}
    </span>
  );
};

/* ----------------------------------------------------------------
   OtpInput — six boxes that behave as one field (otp-input.md)

   Mirrors the web `OtpInput` in src/components/common.jsx. One string of state
   across N slots (#4): paste strips non-digits and spreads across boxes (#1),
   typing auto-advances and backspace-into-empty steps back (#2–#3),
   inputMode=numeric + autocomplete=one-time-code engage the OS keypad and SMS
   autofill (#5–#6), and `error` shakes/clears/refocuses box one (#8).
   ---------------------------------------------------------------- */
export const OtpInput = ({
  value = "",
  onChange,
  length = 6,
  onComplete,
  error = false,
  disabled = false,
  autoFocus = false,
}: {
  value?: string;
  onChange?: (v: string) => void;
  length?: number;
  onComplete?: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) => {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const digits = value.split("").slice(0, length);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!error) return;
    const el = wrapRef.current;
    el?.classList.remove("shake-x");
    void el?.offsetWidth;
    el?.classList.add("shake-x");
    onChange?.("");
    const t = window.setTimeout(() => refs.current[0]?.focus(), 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const setAt = (i: number, d: string) => {
    const next = value.split("");
    next[i] = d;
    const joined = next.join("").replace(/\D/g, "").slice(0, length);
    onChange?.(joined);
    if (joined.length === length) onComplete?.(joined);
  };

  const onKey = (i: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i]) setAt(i, "");
      else if (i > 0) {
        onChange?.(value.slice(0, i - 1));
        refs.current[i - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
    else if (e.key === "ArrowRight" && i < length - 1) refs.current[i + 1]?.focus();
  };

  const onInput = (i: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const d = e.target.value.replace(/\D/g, "").slice(-1);
    if (!d) return;
    setAt(i, d);
    if (i < length - 1) refs.current[i + 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, length);
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
          value={digits[i] || ""}
          onChange={onInput(i)}
          onKeyDown={onKey(i)}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`Digit ${i + 1} of ${length}`}
          className={cn(
            "focus-ring w-11 h-12 text-center text-lg font-semibold tabular rounded-xl border bg-surface-3 text-txt-1",
            error ? "border-dng/60" : digits[i] ? "border-primary/50" : "border-border"
          )}
        />
      ))}
    </div>
  );
};

/* Countdown gate for a resend control (otp-input.md #7). */
export const useCooldown = (seconds = 30): [number, () => void] => {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => window.clearInterval(t);
  }, [left]);
  return [left, () => setLeft(seconds)];
};

/* Skeleton — layout-matching placeholder (design corpus §81–83). Use in place
   of blank screens or bare spinners once a known-shape wait exceeds ~300ms. */
export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("shimmer rounded-lg", className)} />
);

/* EmptyState — "empty" is four unrelated situations, not one (empty-states.md #7).
   Each kind gets its own glyph, tone and recovery verb; `error` is the only one
   tinted as a warning (#10). Copy speaks product voice, never system voice (#3). */
type EmptyKind = "first-run" | "no-results" | "error" | "filtered";

const EMPTY_KINDS: Record<EmptyKind, { Glyph: LucideIcon; text: string; glow: string }> = {
  "first-run": { Glyph: Sparkles, text: "text-txt-2", glow: "bg-accent/10" },
  "no-results": { Glyph: Search, text: "text-net", glow: "bg-net/10" },
  error: { Glyph: AlertTriangle, text: "text-exp", glow: "bg-exp/15" },
  filtered: { Glyph: Filter, text: "text-txt-2", glow: "bg-accent/10" },
};

export const EmptyState = ({
  kind = "first-run",
  title,
  desc,
  action,
  secondaryAction,
  hiddenCount,
  className,
}: {
  kind?: EmptyKind;
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
  secondaryAction?: ReactNode;
  hiddenCount?: number;
  className?: string;
}) => {
  const { Glyph, text, glow } = EMPTY_KINDS[kind];
  return (
    <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <div className="relative mb-4">
        <span className={cn("absolute inset-0 rounded-2xl blur-2xl opacity-60", glow)} />
        <div className={cn("relative p-3.5 rounded-2xl bg-surface-3 border", kind === "error" ? "border-exp/30" : "border-border")}>
          <Glyph className={cn("w-6 h-6", text)} />
        </div>
      </div>
      <h3 className="text-[15px] font-semibold text-txt-1 mb-1">{title}</h3>
      {desc && <p className="text-[13px] text-txt-2 max-w-xs leading-relaxed">{desc}</p>}
      {/* A filtered list is not really empty — say how much is being hidden (#9). */}
      {kind === "filtered" && !!hiddenCount && hiddenCount > 0 && (
        <p className="mt-1 text-[13px] text-txt-2">
          You have <span className="font-semibold text-txt-1">{hiddenCount}</span>{" "}
          {hiddenCount === 1 ? "record" : "records"}, but the current filters hide them all.
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
      {/* Exactly one filled action; alternates demote to a quiet text link (#6). */}
      {secondaryAction && <div className="mt-2.5 text-[12px] text-txt-3">{secondaryAction}</div>}
    </div>
  );
};

/* ProgressBar — determinate, honest (§86–89). Bind `value` to REAL progress;
   the eased width transition front-loads the perceived curve without ever
   exceeding the true value. */
export const ProgressBar = ({
  value = 0,
  label,
  sublabel,
  tone = "accent",
  showPct = true,
  indeterminate = false,
}: {
  value?: number;
  label?: ReactNode;
  sublabel?: ReactNode;
  tone?: "accent" | "inc" | "exp" | "dng";
  showPct?: boolean;
  indeterminate?: boolean;
}) => {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const toneClass = tone === "inc" ? "bg-inc" : tone === "dng" ? "bg-dng" : tone === "exp" ? "bg-exp" : "bg-accent";
  const showPctNum = showPct && !indeterminate;
  return (
    <div className="w-full">
      {(label || showPctNum) && (
        <div className="flex items-center justify-between mb-1.5 gap-3">
          {label && <span className="text-[13px] text-txt-2 truncate">{label}</span>}
          {showPctNum && <span className="text-[13px] font-semibold font-mono-tab text-txt-1 shrink-0">{pct}%</span>}
        </div>
      )}
      <div className="h-2 rounded-full bg-surface-4 overflow-hidden">
        {indeterminate ? (
          <div className={cn("h-full w-2/5 rounded-full anim-progress-indeterminate", toneClass)} />
        ) : (
          <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", toneClass)} style={{ width: `${pct}%` }} />
        )}
      </div>
      {sublabel && <div className="mt-1 text-[11px] text-txt-3">{sublabel}</div>}
    </div>
  );
};

/* ErrorState — classified failure with cause + where it stopped + WHEN
   (error-states.md #3, §61). Hands the user a way forward (retry). */
export const ErrorState = ({
  title = "Something went wrong",
  cause,
  timestamp,
  code,
  stage,
  progress,
  onRetry,
  retryLabel = "Try again",
  retryDisabled = false,
}: {
  title?: string;
  cause?: ReactNode;
  timestamp?: number | string | Date | null;
  code?: string | null;
  stage?: string | null;
  progress?: number | null;
  onRetry?: () => void;
  retryLabel?: string;
  retryDisabled?: boolean;
}) => {
  const ts = timestamp ? new Date(timestamp) : null;
  return (
    <div className="rounded-2xl border border-dng/30 bg-dng/10 p-5 text-center flex flex-col items-center">
      <div className="p-3 rounded-2xl bg-dng/15 mb-3">
        <AlertTriangle className="w-6 h-6 text-dng" />
      </div>
      <h3 className="text-[15px] font-semibold text-txt-1 mb-1">{title}</h3>
      {cause && <p className="text-[13px] text-txt-2 leading-relaxed max-w-sm">{cause}</p>}
      {(stage || progress != null) && (
        <p className="mt-1 text-[11px] text-txt-3">
          Stopped{stage ? ` at "${stage}"` : ""}{progress != null ? ` — ${progress}%` : ""}
        </p>
      )}
      {(ts || code) && (
        <p className="mt-2 font-mono-tab text-[11px] text-txt-3">
          {ts ? ts.toLocaleString() : ""}{ts && code ? " · " : ""}{code || ""}
        </p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={retryDisabled}
          className="mt-4 bg-gradient-accent text-primary-foreground rounded-full px-4 py-2 text-[13px] font-semibold disabled:opacity-60"
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
};

export const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = useState(
    typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
};

/* ----------------------------------------------------------------
   Button — hover, press and ripple are one gesture, not three (buttons.md #9)

   Mirrors the web `Button` in src/components/common.jsx. The 0.95 press lives in
   the `.press` CSS class; this component adds the two things CSS cannot do:
   the 1.05 release overshoot (#6, needs the pointerup) and the ripple anchored at
   the contact point (#7, needs the pointer coords).

   `loading`/`done` implement label-as-reward (§60): the label itself reports the
   outcome, so a toast is not the only evidence the tap landed.
   ---------------------------------------------------------------- */
const BTN_VARIANTS = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
} as const;

const BTN_SIZES = {
  // 44px is the floor for anything a thumb has to hit (§100, tabs.md #9).
  sm: "min-h-[36px] px-3 py-1.5 text-xs rounded-lg gap-1.5",
  md: "min-h-[44px] px-4 py-2.5 text-sm rounded-xl gap-2",
  lg: "min-h-[52px] px-6 py-3 text-base rounded-2xl gap-2.5",
} as const;

export const Button = ({
  children,
  variant = "primary",
  size = "md",
  block = false,
  loading = false,
  done = false,
  loadingLabel,
  doneLabel,
  icon: LeadIcon,
  disabled = false,
  className,
  onPointerDown,
  ...rest
}: {
  children: ReactNode;
  variant?: keyof typeof BTN_VARIANTS;
  size?: keyof typeof BTN_SIZES;
  block?: boolean;
  loading?: boolean;
  done?: boolean;
  loadingLabel?: ReactNode;
  doneLabel?: ReactNode;
  icon?: LucideIcon;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const reduced = usePrefersReducedMotion();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; d: number }[]>([]);
  const rid = useRef(0);

  const busy = loading || done;
  const isDisabled = disabled || loading;

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    onPointerDown?.(e);
    const el = btnRef.current;
    if (!el || isDisabled || reduced) return;

    // Hand the release to the overshoot keyframe. The class is stripped on
    // animationend so a second press can replay it.
    const release = () => {
      el.classList.add("btn-release");
      el.addEventListener("animationend", () => el.classList.remove("btn-release"), { once: true });
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);

    // Diameter = twice the distance to the farthest corner, so the wave reaches
    // every edge no matter where in the button the finger landed.
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const d =
      2 *
      Math.max(
        Math.hypot(x, y),
        Math.hypot(r.width - x, y),
        Math.hypot(x, r.height - y),
        Math.hypot(r.width - x, r.height - y)
      );
    const id = ++rid.current;
    setRipples((rs) => [...rs, { id, x, y, d }]);
    window.setTimeout(() => setRipples((rs) => rs.filter((p) => p.id !== id)), 600);
  };

  const label = loading ? loadingLabel ?? children : done ? doneLabel ?? children : children;

  return (
    <button
      ref={btnRef}
      type="button"
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onPointerDown={handlePointerDown}
      className={cn(
        "press focus-ring relative overflow-hidden inline-flex items-center justify-center font-semibold",
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        block && "w-full",
        className
      )}
      {...rest}
    >
      {ripples.map((p) => (
        <span
          key={p.id}
          className="btn-ripple"
          style={{ "--rx": `${p.x}px`, "--ry": `${p.y}px`, "--rd": `${p.d}px` } as React.CSSProperties}
        />
      ))}
      {loading ? (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-80" />
      ) : done ? (
        <Check size={16} className="shrink-0" />
      ) : LeadIcon ? (
        <LeadIcon size={16} className="shrink-0" />
      ) : null}
      <span>{label}</span>
    </button>
  );
};

/* ----------------------------------------------------------------
   Dialog behaviour — shared by Sheet and Modal (modals.md)
   Keeps the panel mounted through its exit animation, traps focus, closes on
   Escape, and locks the page behind it.
   ---------------------------------------------------------------- */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Escape-to-close, focus trap and page scroll lock. Exported separately so a
   dialog that owns its own motion (e.g. NotificationsSheet, which springs via
   framer-motion) still gets the accessibility behaviour without re-implementing it.
   Attach the returned ref to the dialog panel. */
export const useDialogA11y = (active: boolean, onClose?: () => void) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  // Lock the page behind the dialog so the backdrop doesn't scroll away.
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active]);

  // Escape to close + focus trap. Restores focus to whatever opened the dialog.
  useEffect(() => {
    if (!active) return;
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    (panel?.querySelector(FOCUSABLE) as HTMLElement | null)?.focus?.();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      (restoreRef.current as HTMLElement | null)?.focus?.();
    };
  }, [active, onClose]);

  return panelRef;
};

const useDialog = (open: boolean, onClose?: () => void) => {
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    /* Under reduced motion the CSS animation is squashed to 0.01ms, so waiting on
       a fixed timer would leave the sheet hanging on screen. Unmount at once. */
    if (reduced) {
      setMounted(false);
      return;
    }
    setClosing(true);
    /* `animationend` is authoritative; the timer is only a fallback for the case
       where the animation never fires. */
    const id = window.setTimeout(() => setMounted(false), 280);
    return () => window.clearTimeout(id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const panelRef = useDialogA11y(mounted && !closing, onClose);

  const onAnimationEnd = (e: React.AnimationEvent) => {
    if (closing && e.target === panelRef.current) setMounted(false);
  };

  return { mounted, closing, panelRef, onAnimationEnd };
};

const DialogHeader = ({ title, eyebrow, onClose }: { title?: ReactNode; eyebrow?: ReactNode; onClose?: () => void }) => (
  <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
    <div className="min-w-0">
      {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
      {title && <h3 className="text-[17px] font-bold tracking-tight truncate">{title}</h3>}
    </div>
    {onClose && (
      /* Close button reacts to the press — "every pixel reacts" (modals.md #6). */
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="p-1.5 -mr-1.5 rounded-lg text-txt-2 active:scale-90 active:bg-surface-3 transition shrink-0"
      >
        <X className="w-[18px] h-[18px]" />
      </button>
    )}
  </div>
);

/* Sheet — the phone form factor's dialog. Rises from the bottom edge, blurs the
   page behind it (modals.md #5), staggers its content in (#3) and reverses that
   motion exactly on the way out (#4). */
export const Sheet = ({
  open,
  onClose,
  title,
  eyebrow,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  className?: string;
}) => {
  const { mounted, closing, panelRef, onAnimationEnd } = useDialog(open, onClose);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end">
      <div
        onClick={onClose}
        className={cn("absolute inset-0 bg-black/60 backdrop-blur-md", closing ? "backdrop-out" : "backdrop-in")}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onAnimationEnd={onAnimationEnd}
        className={cn(
          "relative w-full max-h-[88vh] overflow-y-auto bg-surface-2 border-t border-border rounded-t-3xl pb-safe",
          closing ? "sheet-out" : "sheet-in",
          className
        )}
      >
        {/* Grabber — signals the sheet is a distinct, dismissible layer. */}
        <div aria-hidden className="sticky top-0 z-10 flex justify-center pt-2.5 pb-1 bg-surface-2">
          <span className="h-1 w-10 rounded-full bg-surface-4" />
        </div>
        <div className={closing ? "" : "dialog-stagger"}>
          <DialogHeader title={title} eyebrow={eyebrow} onClose={onClose} />
          <div className="px-5 pb-6">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* Modal — centred confirmation dialog. Springs up from 0.95 scale (modals.md #2). */
export const Modal = ({
  open,
  onClose,
  title,
  eyebrow,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  className?: string;
}) => {
  const { mounted, closing, panelRef, onAnimationEnd } = useDialog(open, onClose);
  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        onClick={onClose}
        className={cn("absolute inset-0 bg-black/60 backdrop-blur-md", closing ? "backdrop-out" : "backdrop-in")}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onAnimationEnd={onAnimationEnd}
        className={cn(
          "relative w-full max-w-sm max-h-[85vh] overflow-y-auto bg-surface-2 border border-border rounded-3xl",
          closing ? "dialog-out" : "dialog-in",
          className
        )}
      >
        <div className={closing ? "" : "dialog-stagger"}>
          <DialogHeader title={title} eyebrow={eyebrow} onClose={onClose} />
          <div className="px-5 pb-5">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* PasswordField — password-field.md + form-fields.md. Label above, helper beneath;
   reveal toggle; segmented entropy meter with a word rating; live rule checklist as
   a *secondary* signal; paste never blocked. Mirrors web `common.jsx::PasswordField`. */
const METER_TONE = ["bg-dng", "bg-exp", "bg-exp", "bg-inc"];
const METER_TEXT = ["text-dng", "text-exp", "text-exp", "text-inc"];

export const PasswordField = ({
  label,
  /* Optional trailing control on the label row (e.g. a "Forgot password?" link). */
  labelAction,
  value,
  onChange,
  name,
  autoComplete = "new-password",
  placeholder = "",
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
}: {
  label: string;
  labelAction?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  name?: string;
  autoComplete?: string;
  placeholder?: string;
  helper?: ReactNode;
  success?: boolean;
  successMessage?: string;
  error?: string | null;
  showStrength?: boolean;
  showRules?: boolean;
  disabled?: boolean;
}) => {
  const [reveal, setReveal] = useState(false);
  const [pasted, setPasted] = useState(0);
  const fieldId = useId();
  const describedBy = `${fieldId}-help`;

  const { score, word, reasons } = useMemo(() => passwordStrength(value || ""), [value]);
  const rules = useMemo(() => passwordRules(value || ""), [value]);

  useEffect(() => {
    if (!value) setPasted(0);
  }, [value]);

  const state = error ? "error" : success ? "success" : "default";
  const borderClass = state === "error" ? "border-dng/60" : state === "success" ? "border-inc/50" : "border-border";

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
          type={reveal ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          /* Blocking paste breaks every password manager — allowing it is the
             security-positive default (password-field.md #9–10). */
          onPaste={(e) => {
            const text = e.clipboardData?.getData("text") || "";
            if (text) setPasted(text.length);
          }}
          autoComplete={autoComplete}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={state === "error"}
          aria-describedby={describedBy}
          className={cn(
            "w-full bg-surface-2 border rounded-xl px-3.5 py-2.5 pr-20 text-[15px] text-txt-1 placeholder:text-txt-3 transition-colors focus-ring disabled:bg-surface-3 disabled:text-txt-3 disabled:cursor-not-allowed",
            borderClass
          )}
        />

        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {/* Error and success each carry an icon as well as colour (#4). */}
          {state === "error" && <AlertTriangle className="w-[15px] h-[15px] text-dng" />}
          {state === "success" && <Check className="w-[15px] h-[15px] text-inc" />}
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            disabled={disabled}
            aria-label={reveal ? "Hide password" : "Show password"}
            aria-pressed={reveal}
            className="p-1.5 rounded-lg text-txt-3 active:scale-90 transition disabled:opacity-50"
          >
            {reveal ? <EyeOff className="w-[15px] h-[15px]" /> : <Eye className="w-[15px] h-[15px]" />}
          </button>
        </div>
      </div>

      {/* Segmented bar + an explicit word, so the signal survives colour-blindness (#5). */}
      {showStrength && !!value && (
        <div className="mt-2">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-[11px] uppercase tracking-wider text-txt-3">Strength</span>
            <span className={cn("text-[11px] font-semibold", METER_TEXT[score])}>{word}</span>
          </div>
          <div className="flex gap-1" role="img" aria-label={`Password strength: ${word}`}>
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300",
                  i <= score ? METER_TONE[score] : "bg-surface-4"
                )}
              />
            ))}
          </div>
          {/* Credit each gain to what the user just did, so the meter teaches (#6). */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {reasons.map((r) => (
              <span key={r} className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono-tab text-[10px] text-txt-3">
                {r}
              </span>
            ))}
            {pasted > 0 && (
              <span className="rounded-md bg-inc/10 px-1.5 py-0.5 font-mono-tab text-[10px] text-inc">
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
            <li key={r.key} className={cn("flex items-center gap-2 text-xs transition-colors", r.ok ? "text-inc" : "text-txt-3")}>
              {r.ok ? <Check className="w-3 h-3 shrink-0" /> : <Minus className="w-3 h-3 shrink-0" />}
              {r.label}
            </li>
          ))}
        </ul>
      )}

      <div id={describedBy} className="mt-1.5 min-h-[1rem]">
        {state === "error" && <p className="text-xs text-dng">{error}</p>}
        {state === "success" && successMessage && <p className="text-xs text-inc">{successMessage}</p>}
        {state === "default" && helper && <p className="text-xs text-txt-3">{helper}</p>}
      </div>
    </div>
  );
};
