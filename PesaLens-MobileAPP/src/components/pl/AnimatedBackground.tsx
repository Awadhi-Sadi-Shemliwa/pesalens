/* AnimatedBackground — the mobile-cheap equivalent of the web client's WebGL
   Hyperspeed (dark) / Light Pillar (light) hero backgrounds.

   Why not the real thing: the web effects are three.js + postprocessing (a
   continuous WebGL render loop with bloom). The web app itself disables them on
   any touch device (MotionProvider's `lite` guard → `pointer: coarse`) because
   they're too heavy for phones. This is pure CSS instead — GPU-composited
   transforms only, cheap enough for the Android WebView on low-end devices, yet
   tuned to read like the originals. Disabled under prefers-reduced-motion.

   All styling lives in src/index.css under `.pl-bg*`. Theme is driven purely by
   the `.light` class on <html> (colours also read the accent/net tokens, which
   swap green→blue), so this component holds no state and never re-renders on
   theme flip. It sits behind content; hosts (Landing, MobileShell) place it in a
   z-0 layer with content at z-10. */
export default function AnimatedBackground({ variant = "landing" }: { variant?: "landing" | "inner" } = {}) {
  return (
    <div className={`pl-bg${variant === "inner" ? " pl-bg--inner" : ""}`} aria-hidden="true">
      {/* Drifting brand glows — both themes (accent + net; swap via tokens). */}
      <div className="pl-bg__glow pl-bg__glow--a" />
      <div className="pl-bg__glow pl-bg__glow--b" />

      {/* DARK → hyperspeed tunnel: bloom + floor/ceiling grids streaming in. */}
      <div className="pl-bg__tunnel">
        <div className="pl-bg__core" />
        <div className="pl-bg__plane pl-bg__plane--floor">
          <div className="pl-bg__rails pl-bg__rails--bloom" />
          <div className="pl-bg__rails" />
          <div className="pl-bg__rails pl-bg__rails--net" />
        </div>
        <div className="pl-bg__plane pl-bg__plane--ceil">
          <div className="pl-bg__rails pl-bg__rails--bloom" />
          <div className="pl-bg__rails" />
          <div className="pl-bg__rails pl-bg__rails--net" />
        </div>
      </div>

      {/* LIGHT → volumetric light-blue pillar (soft beam + core + floor pool). */}
      <div className="pl-bg__pillar" />
      <div className="pl-bg__pillar-core" />
      <div className="pl-bg__pillar-pool" />
    </div>
  );
}
