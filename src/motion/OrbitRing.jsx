/* OrbitRing — pure-CSS 3D carousel (Swyftx coin-ring feel, GPU-cheap).
   Items are placed around a Y-axis ring and billboarded (counter-rotated)
   so they always face the camera. Spins forever; pauses off-screen. */
import React, { useEffect, useRef, useState } from 'react';

const useOnScreen = (ref) => {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '10% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return visible;
};

/**
 * @param {{ items: React.ReactNode[], radius?: number, duration?: number,
 *           tilt?: number, className?: string }} props
 * radius px, duration s per revolution, tilt deg (ring leans toward viewer)
 */
const OrbitRing = ({ items, radius = 260, duration = 46, tilt = -8, className = '' }) => {
  const wrapRef = useRef(null);
  const visible = useOnScreen(wrapRef);
  const step = 360 / Math.max(items.length, 1);

  return (
    <div
      ref={wrapRef}
      className={`pl-orbit ${visible ? '' : 'pl-orbit--paused'} ${className}`}
      style={{ '--orbit-t': `${duration}s` }}
    >
      <div className="pl-orbit__stage" style={{ transform: `rotateX(${tilt}deg)` }}>
        <div className="pl-orbit__ring">
          {items.map((node, i) => (
            <div
              key={i}
              className="pl-orbit__item"
              style={{
                '--i-angle': `${i * step}deg`,
                '--i-neg': `${-i * step}deg`,
                '--orbit-r': `${radius}px`,
              }}
            >
              <div className="pl-orbit__billboard">{node}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default OrbitRing;
