/*
 * whereisit · icon set (24 stroke glyphs ported 1:1 from the prototype's SVG sprite).
 * Rendered as inline SVG (no <use>/sprite), colored via currentColor.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { DirType } from '../lib/types';

export type IconName =
  | 'arrow-l'
  | 'bolt'
  | 'box'
  | 'check'
  | 'chev'
  | 'clock'
  | 'desk'
  | 'dir'
  | 'doc'
  | 'drawer'
  | 'ellips'
  | 'home'
  | 'key'
  | 'locate'
  | 'move'
  | 'plus'
  | 'room'
  | 'scissor'
  | 'search'
  | 'shelf'
  | 'sliders'
  | 'tag'
  | 'wardrobe'
  | 'x';

const BODIES: Record<IconName, ReactNode> = {
  'arrow-l': <path d="M19 12H5m6-6-6 6 6 6" />,
  bolt: <path d="M13 2 3.5 13.5H11L9.5 22 20.5 9.5H13z" />,
  box: <path d="M12 3l8 4v10l-8 4-8-4V7zM12 3v10M4 7l8 4 8-4" />,
  check: <path d="m4.5 12.5 5 5L19.5 7" />,
  chev: <path d="m9 6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  desk: <path d="M3 14h18M5 14V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v5M7 18h10" />,
  dir: <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  doc: (
    <>
      <path d="M6 3h9l4 4v14H6zM15 3v4h4" />
      <path d="M9.5 12.5h5M9.5 16h5" />
    </>
  ),
  drawer: <path d="M6 6h12v12H6zM6 12h12M10 12v6" />,
  ellips: (
    <>
      <circle cx="5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="19" cy="12" r="1.9" />
    </>
  ),
  home: <path d="M3 10.5 12 3l9 7.5M5.5 9.2V21h5v-5h3v5h5V9.2" />,
  key: (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 9-9M15.5 7.5l2.5 2.5M13 10l2 2" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  move: <path d="M12 3v18M3 12h18M8 8l4-4 4 4M8 16l4 4 4-4" />,
  plus: <path d="M12 5v14M5 12h14" />,
  room: <path d="M4 10.8 12 5l8 5.8M6 9.6V19h12V9.6M9 19v-5h6v5" />,
  scissor: (
    <>
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M8.2 16.4 20 4M15.8 16.4 4 4M7 8.2h6M7 10.8h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.2-4.2" />
    </>
  ),
  shelf: <path d="M4 6h16M4 12h11M4 18h16" />,
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4.5v5M6 14.5v5" />,
  tag: (
    <>
      <path d="M12 3H5a2 2 0 0 0-2 2v7l9.5 9.5a2 2 0 0 0 2.8 0l6.7-6.7a2 2 0 0 0 0-2.8z" />
      <circle cx="8" cy="8" r="1.6" />
    </>
  ),
  wardrobe: <path d="M6 4h12v16H6zM10 4v16M14 4v16" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
};

const STROKES: Partial<Record<IconName, number>> = {
  plus: 1.8,
  search: 1.8,
  chev: 1.9,
  'arrow-l': 1.9,
  x: 1.9,
  check: 2.2,
  scissor: 1.6,
};

const FILLS: ReadonlySet<IconName> = new Set(['ellips']);

interface IconProps {
  name: IconName;
  /** px size; omitted -> controlled by surrounding CSS `svg {}` selectors */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, size, className, style }: IconProps) {
  const filled = FILLS.has(name);
  const strokeWidth = filled ? undefined : (STROKES[name] ?? 1.7);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? '1em'}
      height={size ?? '1em'}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? undefined : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap={filled ? undefined : 'round'}
      strokeLinejoin={filled ? undefined : 'round'}
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {BODIES[name]}
    </svg>
  );
}

export const TYPE_ICON: Record<DirType, IconName> = {
  room: 'room',
  wardrobe: 'wardrobe',
  desk: 'desk',
  drawer: 'drawer',
  shelf: 'shelf',
  box: 'box',
  generic: 'box',
};

/** tiny inline-block dot (chip/tag status markers) */
export function CDot({ color, className }: { color?: string; className?: string }) {
  return <i className={`cdot${className ? ` ${className}` : ''}`} style={color ? { background: color } : undefined} />;
}
