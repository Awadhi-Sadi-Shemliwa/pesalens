import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

/* TrueFocus — TS port of the web `src/components/reactbits/TrueFocus.jsx`.
   Scans word-by-word: the focused word sharpens while the rest blur, and a
   corner-bracket frame glides to it. framer-motion only. CSS in src/index.css
   (.focus-container / .focus-word / .focus-frame). Used in the Markets heading. */

type TrueFocusProps = {
  sentence?: string;
  blurAmount?: number;
  borderColor?: string;
  glowColor?: string;
  animationDuration?: number;
  pauseBetweenAnimations?: number;
};

export default function TrueFocus({
  sentence = "True Focus",
  blurAmount = 4,
  borderColor = "hsl(var(--accent))",
  glowColor = "hsl(var(--accent) / 0.6)",
  animationDuration = 0.6,
  pauseBetweenAnimations = 1.4,
}: TrueFocusProps) {
  const words = sentence.split(" ");
  const [currentIndex, setCurrentIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 });

  useEffect(() => {
    const interval = setInterval(
      () => setCurrentIndex((p) => (p + 1) % words.length),
      (animationDuration + pauseBetweenAnimations) * 1000
    );
    return () => clearInterval(interval);
  }, [animationDuration, pauseBetweenAnimations, words.length]);

  useEffect(() => {
    const parent = containerRef.current;
    const active = wordRefs.current[currentIndex];
    if (!parent || !active) return;
    const p = parent.getBoundingClientRect();
    const a = active.getBoundingClientRect();
    setRect({ x: a.left - p.left, y: a.top - p.top, width: a.width, height: a.height });
  }, [currentIndex]);

  return (
    <div className="focus-container" ref={containerRef}>
      {words.map((word, index) => (
        <span
          key={index}
          ref={(el) => { wordRefs.current[index] = el; }}
          className={`focus-word ${index === currentIndex ? "active" : ""}`}
          style={{
            filter: index === currentIndex ? "blur(0px)" : `blur(${blurAmount}px)`,
            transition: `filter ${animationDuration}s ease`,
          }}
        >
          {word}
        </span>
      ))}
      <motion.div
        className="focus-frame"
        animate={{ x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: 1 }}
        transition={{ duration: animationDuration }}
        style={{ ["--border-color" as string]: borderColor, ["--glow-color" as string]: glowColor }}
      >
        <span className="corner top-left" />
        <span className="corner top-right" />
        <span className="corner bottom-left" />
        <span className="corner bottom-right" />
      </motion.div>
    </div>
  );
}
