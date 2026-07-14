import React from 'react';

export const Icon = ({ name, size = 20, className = '' }) => {
  const icons = {
    logo: (
      <>
        <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M2 17l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    aperture: (
      <>
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.6" fill="none" />
        <path d="M12 2.5 L14.6 9.2 L21.5 10.2" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M21.5 10.2 L17 15 L19.4 21" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19.4 21 L12 18.5 L4.6 21" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.6 21 L7 15 L2.5 10.2" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.5 10.2 L9.4 9.2 L12 2.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      </>
    ),
    spark: (
      <>
        <path d="M3 17 L8 12 L12 14 L17 8 L21 11" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="17" cy="8" r="1.8" fill="currentColor" />
      </>
    ),
    arrowUpRight: (
      <>
        <line x1="7" y1="17" x2="17" y2="7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <polyline points="7 7 17 7 17 17" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    arrowDownRight: (
      <>
        <line x1="7" y1="7" x2="17" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <polyline points="17 7 17 17 7 17" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    sparkles: (
      <>
        <path d="M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8L12 3z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        <path d="M19 16l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z" fill="currentColor" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </>
    ),
    moon: (
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <path d="M2.5 12h19" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 2.5C9.5 5 8 8.5 8 12s1.5 7 4 9.5c2.5-2.5 4-6 4-9.5s-1.5-7-4-9.5z" stroke="currentColor" strokeWidth="1.6" fill="none" />
      </>
    ),
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" fill="none" />
        <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" fill="none" />
        <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" fill="none" />
        <rect x="14" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    chart: (
      <>
        <path d="M18 20V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 20V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M6 20v-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    bot: (
      <>
        <path d="M12 2a5 5 0 015 5v3a5 5 0 01-10 0V7a5 5 0 015-5z" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="10" y1="9" x2="10" y2="9.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="14" y1="9" x2="14" y2="9.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M9 19v2M15 19v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    trending: (
      <>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="17 6 23 6 23 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" fill="none" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    user: (
      <>
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" stroke="currentColor" strokeWidth="2" fill="none" />
        <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    upload: (
      <>
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="2" fill="none" />
        <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    arrowRight: (
      <>
        <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <polyline points="12 5 19 12 12 19" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    check: (
      <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ),
    chevDown: (
      <polyline points="6 9 12 15 18 9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    ),
    chevRight: (
      <polyline points="9 18 15 12 9 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    ),
    x: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    menu: (
      <>
        <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="3" y1="6" x2="21" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    shield: (
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="2" fill="none" />
    ),
    zap: (
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" stroke="currentColor" strokeWidth="2" fill="none" />
    ),
    dollar: (
      <>
        <line x1="12" y1="1" x2="12" y2="23" stroke="currentColor" strokeWidth="2" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    eye: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2" fill="none" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="2" fill="none" />
        <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    send: (
      <>
        <line x1="22" y1="2" x2="11" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    plus: (
      <>
        <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    minus: (
      <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    ),
    filter: (
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" stroke="currentColor" strokeWidth="2" fill="none" />
    ),
    download: (
      <>
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="2" fill="none" />
        <polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    alert: (
      <>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" strokeWidth="2" fill="none" />
        <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    play: (
      <polygon points="5 3 19 12 5 21 5 3" stroke="currentColor" strokeWidth="2" fill="none" />
    ),
    wallet: (
      <>
        <path d="M20 12V8H6a2 2 0 01-2-2c0-1.1.9-2 2-2h12v4" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M4 6v12a2 2 0 002 2h14v-4" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M18 12a2 2 0 000 4h4v-4h-4z" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    receipt: (
      <>
        <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1V2l-2 1-2-1-2 1-2-1-2 1-2-1z" stroke="currentColor" strokeWidth="2" fill="none" />
        <path d="M8 7h8M8 11h8M8 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    camera: (
      <>
        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" strokeWidth="2" fill="none" strokeLinejoin="round" />
        <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
        <circle cx="8.5" cy="8.5" r="1.5" stroke="currentColor" strokeWidth="2" fill="none" />
        <polyline points="21 15 16 10 5 21" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    logout: (
      <>
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" stroke="currentColor" strokeWidth="2" fill="none" />
        <polyline points="16 17 21 12 16 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="21" y1="12" x2="9" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M6.61 6.61A18.5 18.5 0 001 12s4 8 11 8a9.12 9.12 0 005.39-1.61" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M14.12 14.12a3 3 0 11-4.24-4.24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={{ flexShrink: 0 }}>
      {icons[name] || null}
    </svg>
  );
};

