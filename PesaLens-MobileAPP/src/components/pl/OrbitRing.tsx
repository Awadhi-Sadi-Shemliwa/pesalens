import { type ReactNode, useEffect, useRef, useState } from "react";

/* OrbitRing — TS port of the web `src/motion/OrbitRing.jsx`. A pure-CSS 3D
   carousel: items sit around a Y-axis ring and are billboarded (counter-rotated)
   so they always face the camera. Spins forever; pauses off-screen. CSS in
   src/index.css (.pl-orbit*). Used in the Markets section. */

function useOnScreen(ref: React.RefObject<HTMLElement>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
}

type OrbitRingProps = {
  items: ReactNode[];
  radius?: number;
  duration?: number;
  tilt?: number;
  className?: string;
};

export default function OrbitRing({ items, radius = 200, duration = 46, tilt = -8, className = "" }: OrbitRingProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const visible = useOnScreen(wrapRef);
  const step = 360 / Math.max(items.length, 1);

  return (
    <div
      ref={wrapRef}
      className={`pl-orbit ${visible ? "" : "pl-orbit--paused"} ${className}`}
      style={{ ["--orbit-t" as string]: `${duration}s` }}
    >
      <div className="pl-orbit__stage" style={{ transform: `rotateX(${tilt}deg)` }}>
        <div className="pl-orbit__ring">
          {items.map((node, i) => (
            <div
              key={i}
              className="pl-orbit__item"
              style={{
                ["--i-angle" as string]: `${i * step}deg`,
                ["--i-neg" as string]: `${-i * step}deg`,
                ["--orbit-r" as string]: `${radius}px`,
              }}
            >
              <div className="pl-orbit__billboard">{node}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
