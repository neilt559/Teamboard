'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { IconMore } from '@/app/icons';

// A small "more" (three dots) action menu (design §2.2: row actions sit in an IconMore menu, so they work on touch screens,
// where hover-only icons never show). items: [{ label, onClick, danger?, disabled?, icon? }] (falsy items
// are skipped). The button is a 44 px target on phones (home.css).
export default function MoreMenu({ items, label = 'More actions', className = '' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const id = useId();
  const list = (items || []).filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('touchstart', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!list.length) return null;
  return (
    <div className={`ofc-more${className ? ` ${className}` : ''}`} ref={wrap}>
      <button
        type="button"
        className="ofc-more-btn"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
      >
        <IconMore size={18} />
      </button>
      {open && (
        <div className="ofc-more-pop" role="menu" id={id}>
          {list.map((it, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={it.danger ? 'danger' : undefined}
              disabled={!!it.disabled}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); it.onClick(); }}
            >
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
