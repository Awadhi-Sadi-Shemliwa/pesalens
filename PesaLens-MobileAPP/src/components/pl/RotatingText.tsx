import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/* RotatingText — TS port of the web `src/components/reactbits/RotatingText.jsx`.
   Cycles through a list of words, animating characters in/out. framer-motion
   only. CSS in src/index.css (.text-rotate*). Used in the Markets eyebrow. */

type RotatingTextProps = {
  texts: string[];
  rotationInterval?: number;
  staggerDuration?: number;
  staggerFrom?: "first" | "last" | "center";
  mainClassName?: string;
  splitLevelClassName?: string;
  elementLevelClassName?: string;
  transition?: object;
};

export default function RotatingText({
  texts,
  rotationInterval = 2000,
  staggerDuration = 0.015,
  staggerFrom = "last",
  mainClassName = "",
  splitLevelClassName = "",
  elementLevelClassName = "",
  transition = { type: "spring", damping: 28, stiffness: 340 },
}: RotatingTextProps) {
  const [index, setIndex] = useState(0);

  const chars = useMemo(() => Array.from(texts[index] ?? ""), [texts, index]);

  const getDelay = useCallback(
    (i: number, total: number) => {
      if (staggerFrom === "last") return (total - 1 - i) * staggerDuration;
      if (staggerFrom === "center") return Math.abs(Math.floor(total / 2) - i) * staggerDuration;
      return i * staggerDuration;
    },
    [staggerFrom, staggerDuration]
  );

  useEffect(() => {
    const id = setInterval(() => setIndex((p) => (p + 1) % texts.length), rotationInterval);
    return () => clearInterval(id);
  }, [texts.length, rotationInterval]);

  return (
    <span className={`text-rotate ${mainClassName}`}>
      <span className="text-rotate-sr-only">{texts[index]}</span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={index} className="text-rotate" aria-hidden="true">
          <span className={`text-rotate-word ${splitLevelClassName}`}>
            {chars.map((ch, i) => (
              <motion.span
                key={i}
                initial={{ y: "100%", opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "-120%", opacity: 0 }}
                transition={{ ...transition, delay: getDelay(i, chars.length) }}
                className={`text-rotate-element ${elementLevelClassName}`}
              >
                {ch === " " ? " " : ch}
              </motion.span>
            ))}
          </span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
