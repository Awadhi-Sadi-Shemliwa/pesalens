import React, { useRef, useEffect, useState, useCallback } from 'react';
import { readToken } from './common';

/* ================================================================
   motion.jsx — dependency-free "money" motion primitives.
   All effects respect prefers-reduced-motion and pause off-screen.
   Portable to the Capacitor mobile app (pure CSS/SVG/canvas).
   ================================================================ */

/* Reduced-motion hook — single source of truth for gating animation. Lives in its
   own module so `common.jsx` can use it without importing this file (which imports
   `readToken` from `common.jsx` and would form a cycle). Re-exported here so the
   existing `from './motion'` import sites keep working. */
export { useReducedMotion } from './useReducedMotion';
import { useReducedMotion } from './useReducedMotion';

/* ----------------------------------------------------------------
   TiltCard — pointer-driven 3D tilt (the "little 3D movement").
   Sets --rx/--ry consumed by the .tilt-3d class in index.css.
   Optional soft glare that tracks the pointer.
   ---------------------------------------------------------------- */
export const TiltCard = ({
  children,
  className = '',
  max = 8,           // max tilt in degrees
  glare = false,
  scale = 1.0,
  style = {},
}) => {
  const ref = useRef(null);
  const reduced = useReducedMotion();
  const [glarePos, setGlarePos] = useState({ x: 50, y: 0, on: false });

  const onMove = useCallback((e) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;   // 0..1
    const py = (e.clientY - r.top) / r.height;   // 0..1
    const ry = (0.5 - py) * max * 2;             // rotateX
    const rx = (px - 0.5) * max * 2;             // rotateY
    ref.current.style.setProperty('--rx', `${rx.toFixed(2)}deg`);
    ref.current.style.setProperty('--ry', `${ry.toFixed(2)}deg`);
    if (scale !== 1) ref.current.style.transform =
      `perspective(900px) rotateX(${ry.toFixed(2)}deg) rotateY(${rx.toFixed(2)}deg) scale(${scale})`;
    if (glare) setGlarePos({ x: px * 100, y: py * 100, on: true });
  }, [reduced, max, glare, scale]);

  const onLeave = useCallback(() => {
    if (!ref.current) return;
    ref.current.style.setProperty('--rx', '0deg');
    ref.current.style.setProperty('--ry', '0deg');
    if (scale !== 1) ref.current.style.transform = '';
    setGlarePos((g) => ({ ...g, on: false }));
  }, [scale]);

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`${reduced ? '' : 'tilt-3d'} ${className}`}
      style={style}
    >
      {children}
      {glare && !reduced && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-300"
          style={{
            opacity: glarePos.on ? 1 : 0,
            background: `radial-gradient(220px circle at ${glarePos.x}% ${glarePos.y}%, rgba(255,255,255,0.10), transparent 60%)`,
          }}
        />
      )}
    </div>
  );
};

/* ----------------------------------------------------------------
   CoinField — subtle drifting coin/₸ glyphs on a <canvas>.
   Decorative hero background. Pauses off-screen + on reduced-motion.
   ---------------------------------------------------------------- */
export const CoinField = ({ className = '', density = 26, style = {} }) => {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || reduced) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let running = true;

    const accent = readToken('--c-accent', '#30DC82');
    const net = readToken('--c-net', '#3884F5');

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const coins = Array.from({ length: density }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 3 + Math.random() * 9,
      spd: 0.15 + Math.random() * 0.5,
      drift: (Math.random() - 0.5) * 0.3,
      a: 0.05 + Math.random() * 0.18,
      c: Math.random() > 0.5 ? accent : net,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.04,
    }));

    const draw = () => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of coins) {
        p.y -= p.spd;
        p.x += p.drift;
        p.rot += p.vr;
        if (p.y < -12) { p.y = h + 12; p.x = Math.random() * w; }
        // Draw a squashed coin (ellipse) to fake 3D spin
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.a;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * (0.4 + 0.6 * Math.abs(Math.cos(p.rot))), 0, 0, Math.PI * 2);
        ctx.fillStyle = p.c;
        ctx.fill();
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(draw);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        running = entry.isIntersecting;
        if (running) { rafRef.current = requestAnimationFrame(draw); }
        else cancelAnimationFrame(rafRef.current);
      },
      { threshold: 0 }
    );
    io.observe(canvas);
    window.addEventListener('resize', resize);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      io.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [reduced, density]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={`pointer-events-none ${className}`}
      style={{ width: '100%', height: '100%', ...style }}
    />
  );
};

/* ----------------------------------------------------------------
   CashflowRiver — flowing money streams (SVG). Green = in, blue = out.
   Uses the .cashflow-stream keyframe from index.css.
   ---------------------------------------------------------------- */
export const CashflowRiver = ({ className = '', height = 120 }) => {
  const reduced = useReducedMotion();
  const paths = [
    { d: 'M0 70 C 120 30, 240 110, 360 60 S 600 20, 760 70', c: 'var(--river-in)',  w: 2.2, delay: '0s' },
    { d: 'M0 92 C 140 60, 260 130, 380 88 S 620 60, 760 96', c: 'var(--river-net)', w: 1.8, delay: '-0.7s' },
    { d: 'M0 48 C 150 20, 300 70, 420 40 S 640 10, 760 44',  c: 'var(--river-in)',  w: 1.4, delay: '-1.3s' },
  ];
  return (
    <svg
      viewBox="0 0 760 120"
      preserveAspectRatio="none"
      className={className}
      style={{
        width: '100%', height,
        // map river colors to live tokens
        '--river-in':  'rgb(var(--c-accent))',
        '--river-net': 'rgb(var(--c-net))',
      }}
      aria-hidden
    >
      <defs>
        <linearGradient id="river-fade" x1="0" x2="1">
          <stop offset="0%" stopColor="rgb(var(--c-accent))" stopOpacity="0" />
          <stop offset="50%" stopColor="rgb(var(--c-accent))" stopOpacity="0.5" />
          <stop offset="100%" stopColor="rgb(var(--c-net))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={p.c}
          strokeWidth={p.w}
          strokeLinecap="round"
          opacity={0.55}
          className={reduced ? '' : 'cashflow-stream'}
          style={{ animationDelay: p.delay }}
        />
      ))}
    </svg>
  );
};
