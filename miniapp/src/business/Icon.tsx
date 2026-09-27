// Один набор контурных SVG-иконок для всех экранов.
import React, { type ReactNode } from 'react';
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
    settings: <><path d="m9.5 3-.5 2-2 1-2-.5-2 3.5 1.5 1.5v3L3 15l2 3.5 2-.5 2 1 .5 2h5l.5-2 2-1 2 .5 2-3.5-1.5-1.5v-3L21 9l-2-3.5-2 .5-2-1-.5-2Z" /><circle cx="12" cy="12" r="3" /></>,
    edit: <><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" /></>,
    home: (
      <React.Fragment>
        <path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" />
      </React.Fragment>
    ),
    chat: (
      <>
        <path d="M19 3H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3l4 3 4-3h3a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z" />
        <path d="M7 11h.1m4.9 0h.1m4.9 0h.1" strokeWidth="2.5" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    plus: (
      <>
        <path d="M12 4v16M4 12h16" />
        <path className="icon-accent" d="M16 4h2a4 4 0 0 1 4 4v2" />
      </>
    ),
    loan: (
      <>
        <path d="M3 20h18M5 17V9m5 8V9m4 8V9m5 8V9M3 7l9-5 9 5Z" />
        <path className="icon-accent" d="M8 20h8" />
      </>
    ),
    percent: (
      <>
        <circle cx="7" cy="7" r="3" />
        <circle cx="17" cy="17" r="3" />
        <path className="icon-accent" d="m5 20 14-16" />
      </>
    ),
    shield: (
      <>
        <path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" />
        <path className="icon-accent" d="m8 11 3 3 5-5" />
      </>
    ),
    lease: (
      <>
        <path d="M3 5h18v14H3ZM7 9h4M7 13h4" />
        <circle className="icon-accent" cx="17" cy="15" r="5" />
        <path className="icon-accent" d="m15 15 2 2 3-3" />
      </>
    ),
    receipt: (
      <>
        <path d="M5 3h14v19l-3-2-4 2-4-2-3 2ZM8 8h8m-8 4h8m-8 4h4" />
        <path className="icon-accent" d="M3 7H2V2h20v5h-1" />
      </>
    ),
    bookmark: <path d="M6 3h12v18l-6-4-6 4Z" />,
    eye: (
      <>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: (
      <>
        <path d="M3 3 21 21M9 5a12 12 0 0 1 3 0c6 0 10 7 10 7a18 18 0 0 1-3 4M6 6a21 21 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1" />
        <path d="M10 10a3 3 0 0 0 4 4" />
      </>
    ),
    refresh: (
      <>
        <path d="M3 12a9 9 0 0 1 15-7l3 3M21 3v5h-5" />
        <path className="icon-accent" d="M21 12A9 9 0 0 1 6 19l-3-3m0 5v-5h5" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="2" />
        <rect x="14" y="3" width="7" height="7" rx="2" />
        <rect x="3" y="14" width="7" height="7" rx="2" />
        <rect x="14" y="14" width="7" height="7" rx="2" />
      </>
    ),
    spark: (
      <>
        <path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z" />
      </>
    ),
    compass: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m16 8-3 5-5 3 3-5Z" />
      </>
    ),
    file: (
      <>
        <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
        <path d="M14 3v6h6M8 13h8M8 17h5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2m-8 3h2" />
      </>
    ),
    building: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 7h1m4 0h1m-6 4h1m4 0h1m-6 4h1m4 0h1m-4 6v-3" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    cube: (
      <>
        <path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10v10M3 7l9 5 9-5M7 4l10 6" />
      </>
    ),
    growth: (
      <>
        <path d="M4 20V4m0 16h16M8 15l4-5 4 2 5-7m-5 0h5v5" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="7" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m2 11v-3a6 6 0 0 0-2-4" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.spark}
    </svg>
  );
}
