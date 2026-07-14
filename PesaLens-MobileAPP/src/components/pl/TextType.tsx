import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/* TextType — lightweight typewriter that cycles a list of strings, typing then
   deleting each with a blinking cursor. Mobile equivalent of the web
   reactbits/TextType (used by the Landing "AI controller" tile). Under reduced
   motion it renders the first string statically. */

type TextTypeProps = {
  text: string[];
  typingSpeed?: number;
  deletingSpeed?: number;
  pauseDuration?: number;
  showCursor?: boolean;
  cursorCharacter?: string;
  cursorClassName?: string;
  className?: string;
};

export default function TextType({
  text,
  typingSpeed = 38,
  deletingSpeed = 16,
  pauseDuration = 2200,
  showCursor = true,
  cursorCharacter = "▌",
  cursorClassName = "text-accent",
  className = "",
}: TextTypeProps) {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? text[0] ?? "" : "");
  const idx = useRef(0);
  const char = useRef(0);
  const deleting = useRef(false);

  useEffect(() => {
    if (reduce || text.length === 0) return;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const full = text[idx.current % text.length];
      if (!deleting.current) {
        char.current += 1;
        setDisplay(full.slice(0, char.current));
        if (char.current >= full.length) {
          deleting.current = true;
          timer = setTimeout(tick, pauseDuration);
          return;
        }
        timer = setTimeout(tick, typingSpeed);
      } else {
        char.current -= 1;
        setDisplay(full.slice(0, Math.max(0, char.current)));
        if (char.current <= 0) {
          deleting.current = false;
          idx.current += 1;
          timer = setTimeout(tick, typingSpeed);
          return;
        }
        timer = setTimeout(tick, deletingSpeed);
      }
    };

    timer = setTimeout(tick, typingSpeed);
    return () => clearTimeout(timer);
  }, [text, typingSpeed, deletingSpeed, pauseDuration, reduce]);

  return (
    <span className={className} data-no-translate>
      {display}
      {showCursor && <span className={`${cursorClassName} animate-pulse-dot`}>{cursorCharacter}</span>}
    </span>
  );
}
