import Link from 'next/link';
import { Headshot } from '@/app/_ui/Headshot';
import { IconPin } from '@/app/icons';
import { excerpt, fmtWhen } from './when';

// The newest announcements across the viewer's spaces (lib/queries/spaces.js latestAnnouncements), as a list of
// links into each space. Used by /threads and the Home "Announcements" card. No hooks: server-rendered.
//   items: [{ id, body, created_at, pinned, reply_count, author, space_info: { key, name, href } }]
export default function LatestList({ items, tz, now, max = 160, className = '' }) {
  return (
    <ul className={`sp-latest${className ? ` ${className}` : ''}`}>
      {(items || []).map((a) => (
        <li key={a.id}>
          <Link href={a.space_info?.href || '/threads'} prefetch={false} className="sp-latest-row">
            {a.author ? <Headshot user={a.author} size={30} /> : <span className="hs hs-init" style={{ width: 30, height: 30 }} aria-hidden="true" />}
            <span className="sp-latest-main">
              <span className="sp-latest-top">
                <span className="sp-latest-space">{a.space_info?.name || 'Space'}</span>
                <span className="sp-latest-who">{a.author?.name || 'Former member'}</span>
                <span className="sp-latest-when">{fmtWhen(a.created_at, tz, now)}</span>
                {a.pinned && <span className="sp-chip sp-chip-pin wi"><IconPin size={11} /> Pinned</span>}
              </span>
              <span className="sp-latest-text">{excerpt(a.body, max)}</span>
              {a.reply_count > 0 && <span className="sp-latest-meta">{a.reply_count === 1 ? '1 reply' : `${a.reply_count} replies`}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
