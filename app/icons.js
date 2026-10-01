// Inline SVG line icons used across TeamBoard (instead of emoji, which render
// differently on every device). They draw in currentColor, so they pick up the
// surrounding text color; pass size to scale them.

function Svg({ size = 17, children, filled = false }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconArchive = (p) => <Svg {...p}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></Svg>;
export const IconTrash = (p) => <Svg {...p}><path d="M3 6h18" /><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><path d="M6 6v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6" /><path d="M10 11v6M14 11v6" /></Svg>;
export const IconRestore = (p) => <Svg {...p}><path d="M3 12a9 9 0 1 0 2.6-6.3" /><path d="M3 4v4h4" /></Svg>;
export const IconUsers = (p) => <Svg {...p}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>;
export const IconList = (p) => <Svg {...p}><path d="M10 6h10M10 12h10M10 18h10" /><path d="M3.5 6l1.5 1.5L7.5 5" /><path d="M3.5 12l1.5 1.5L7.5 11" /><path d="M3.5 18l1.5 1.5L7.5 17" /></Svg>;
export const IconGlobe = (p) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" /></Svg>;
export const IconTrophy = (p) => <Svg {...p}><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></Svg>;
export const IconBuilding = (p) => <Svg {...p}><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9.5 21v-4h5v4" /><path d="M8 7h2M14 7h2M8 11h2M14 11h2" /></Svg>;
export const IconFile = (p) => <Svg {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Svg>;
export const IconNote = (p) => <Svg {...p}><path d="M5 3h14a2 2 0 0 1 2 2v10l-6 6H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M15 21v-4a2 2 0 0 1 2-2h4" /><path d="M7 8h10M7 12h6" /></Svg>;
export const IconPencil = (p) => <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
export const IconCheck = (p) => <Svg {...p}><path d="M20 6L9 17l-5-5" /></Svg>;
export const IconCamera = (p) => <Svg {...p}><path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="4" /></Svg>;
export const IconPaperclip = (p) => <Svg {...p}><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.5 7.5" /></Svg>;
export const IconCalendar = (p) => <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></Svg>;
export const IconFolder = (p) => <Svg {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Svg>;
export const IconAlert = (p) => <Svg {...p}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></Svg>;
export const IconMenu = (p) => <Svg {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Svg>;
export const IconExternal = (p) => <Svg {...p}><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></Svg>;
export const IconZoomIn = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M11 8v6M8 11h6" /></Svg>;
export const IconZoomOut = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5M8 11h6" /></Svg>;
export const IconRotate = (p) => <Svg {...p}><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 4v4h-4" /></Svg>;
export const IconCrop = (p) => <Svg {...p}><path d="M6 2v14a2 2 0 0 0 2 2h14" /><path d="M18 22V8a2 2 0 0 0-2-2H2" /></Svg>;
export const IconBulb = (p) => <Svg {...p}><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z" /></Svg>;
export const IconChevronUp = (p) => <Svg {...p}><path d="M6 15l6-6 6 6" /></Svg>;
export const IconSearch = (p) => <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>;
export const IconLock = (p) => <Svg {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Svg>;
export const IconStar = (p) => <Svg filled size={14} {...p}><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" /></Svg>;
export const IconCrown = (p) => <Svg filled size={13} {...p}><path d="M3 7.5l4.6 4.1L12 5l4.4 6.6L21 7.5 19.2 17.5H4.8z" /><rect x="4.8" y="19" width="14.4" height="2.4" rx="1" /></Svg>;
