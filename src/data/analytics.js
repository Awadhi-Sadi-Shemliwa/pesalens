/*
 * Thin Google Analytics (GA4) wrapper.
 *
 * gtag is only injected on pesalens.com (see the hostname-gated snippet in
 * index.html), and ad-blockers may strip it anywhere — so every helper here
 * must no-op safely when window.gtag is absent. Never let analytics throw
 * into app code.
 *
 * SPA page_views: the initial load is counted by the `gtag('config', …)`
 * call in index.html; route changes are reported by <Router> calling
 * trackPageView on every path change after the first render. Keep GA4's
 * Enhanced Measurement "page changes based on browser history events"
 * toggle OFF in the GA admin, or navigations double-count.
 */

export const trackPageView = (path) => {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
};

// Generic event helper for future funnels (sign-ups, upgrades, APK
// downloads). Same no-op safety as trackPageView.
export const trackEvent = (name, params = {}) => {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, params);
};
