import { IconChat } from '@/app/icons';

// Skeleton while a thread page loads (design §2.1 loading states): the space list column and a few post-shaped
// blocks, in the same layout as the page, so nothing jumps when it arrives.
export default function SpaceLoading({ index = false }) {
  return (
    <div className={`sp-wrap sp-loading${index ? ' sp-index' : ''}`} aria-busy="true" aria-live="polite">
      {index && (
        <div className="proj-head sp-index-head">
          <h1 className="wi-h"><IconChat size={24} /> Threads</h1>
          <span className="sp-head-sub">Loading…</span>
        </div>
      )}
      <div className="sp-layout">
        <aside className={`sp-side${index ? ' sp-side-index' : ''}`}>
          <div className="sp-skel sp-skel-h" />
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className={`sp-skel sp-skel-row${i > 1 ? ' nested' : ''}`} />)}
        </aside>
        <div className="sp-main">
          {!index && <div className="sp-skel sp-skel-title" />}
          {!index && <div className="sp-skel sp-skel-tabs" />}
          <span className="sr-only">Loading…</span>
          {[0, 1, 2].map((i) => <div key={i} className="sp-skel sp-skel-post" />)}
        </div>
      </div>
    </div>
  );
}
