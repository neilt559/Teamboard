import Link from 'next/link';
import { Headshot } from '@/app/_ui/Headshot';
import { excerpt, fmtWhen } from '@/app/_ui/when';
import { postHref } from '@/lib/suggestions';

// The newest posts from the Suggestions/Announcements boards (lib/queries/suggestions.js latestPosts), as links to
// each post on its board (#post-<id>). Used by the Home cards and the office page. No hooks: server-rendered.
//   items: [{ id, kind, title, details, created_at, anonymous, author, votes, reply_count, board_info: { key, name } }]
//   compact: leave out the board name (a list from one board); showKind false: leave out the kind chip (a list of
//   one kind).
export default function BoardLatest({ items, tz, now, max = 160, compact = false, showKind = true, className = '' }) {
  return (
    <ul className={`sp-latest${compact ? ' sp-latest-compact' : ''}${className ? ` ${className}` : ''}`}>
      {(items || []).map((p) => {
        const ann = p.kind === 'announcement';
        const who = p.anonymous ? 'Anonymous' : (p.author?.name || 'Former member');
        const meta = [
          !ann && p.votes > 0 ? `${p.votes} +1${p.votes === 1 ? '' : 's'}` : null,
          p.reply_count > 0 ? `${p.reply_count} ${p.reply_count === 1 ? 'reply' : 'replies'}` : null,
        ].filter(Boolean).join(' · ');
        return (
          <li key={p.id}>
            <Link href={postHref(p.board_info?.key || p.board || 'company', p.id)} prefetch={false} className="sp-latest-row">
              {p.author && !p.anonymous
                ? <Headshot user={p.author} size={30} />
                : <span className="hs hs-init sp-latest-anon" style={{ width: 30, height: 30 }} aria-hidden="true">?</span>}
              <span className="sp-latest-main">
                <span className="sp-latest-top">
                  {!compact && <span className="sp-latest-space">{p.board_info?.name || ''}</span>}
                  {showKind && <span className={`sp-kind${ann ? ' ann' : ''}`}>{ann ? 'Announcement' : 'Suggestion'}</span>}
                  <span className="sp-latest-who">{who}</span>
                  <span className="sp-latest-when">{fmtWhen(p.created_at, tz, now)}</span>
                </span>
                <span className="sp-latest-title">{p.title}</span>
                {p.details && <span className="sp-latest-text">{excerpt(p.details, max)}</span>}
                {meta && <span className="sp-latest-meta">{meta}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
