import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("eyebrow", className)}>{children}</div>
);

export const CardSoft = ({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) => (
  <div onClick={onClick} className={cn("card-soft p-4", onClick && "active:scale-[0.99] transition-transform cursor-pointer", className)}>
    {children}
  </div>
);

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

export const Pill = ({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors border",
      active
        ? "bg-foreground text-background border-foreground"
        : "bg-surface-2 text-txt-2 border-border hover:text-txt-1"
    )}
  >
    {children}
  </button>
);
