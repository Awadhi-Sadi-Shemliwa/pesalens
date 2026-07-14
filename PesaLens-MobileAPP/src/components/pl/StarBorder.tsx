import type { CSSProperties, ElementType, ReactNode } from "react";

/* StarBorder — TS port of the web client's `src/components/reactbits/StarBorder.jsx`.
   A pure-CSS animated border: two soft radial "stars" sweep along the top and
   bottom edges (keyframes `star-movement-*` live in src/index.css). Wrap a CTA
   in it for the web's premium moving-border treatment. No heavy deps. */

type StarBorderProps = {
  as?: ElementType;
  className?: string;
  color?: string;
  speed?: string;
  thickness?: number;
  innerClassName?: string;
  children?: ReactNode;
  style?: CSSProperties;
};

export default function StarBorder({
  as: Component = "div",
  className = "",
  color = "hsl(var(--accent))",
  speed = "5s",
  thickness = 1,
  innerClassName = "",
  children,
  style,
}: StarBorderProps) {
  return (
    <Component
      className={`relative inline-block overflow-hidden rounded-[16px] ${className}`}
      style={{ padding: `${thickness}px 0`, ...style }}
    >
      <div
        className="absolute w-[300%] h-[50%] opacity-70 bottom-[-11px] right-[-250%] rounded-full animate-star-movement-bottom z-0"
        style={{ background: `radial-gradient(circle, ${color}, transparent 10%)`, animationDuration: speed }}
      />
      <div
        className="absolute w-[300%] h-[50%] opacity-70 top-[-10px] left-[-250%] rounded-full animate-star-movement-top z-0"
        style={{ background: `radial-gradient(circle, ${color}, transparent 10%)`, animationDuration: speed }}
      />
      <div className={`relative z-[1] rounded-[15px] ${innerClassName}`}>{children}</div>
    </Component>
  );
}
