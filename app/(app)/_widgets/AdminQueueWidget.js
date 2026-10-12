import Link from 'next/link';
import { IconShield } from '@/app/icons';

// Home dashboard widget 'admin_queue', admins only (design §2.1, §5.5): what waits on /admin/approvals,
// oldest first. The page renders it only for admins and loadDashboard reads the queue only for them.
const KIND = {
  position: 'Position',
  office_change: 'Office change',
  person_link: 'Name on tasks',
  identity: 'Verify name and email',
};
const fmtDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
};

export default function AdminQueueWidget({ viewer, data }) {
  if (!viewer?.is_admin || !data?.admin) return null;
  const { counts, total, oldest } = data.admin;
  const chips = [
    ['Positions', counts.positions], ['Office changes', counts.office_changes],
    ['Name links', counts.person_links], ['Identity checks', counts.identity],
  ].filter(([, n]) => n > 0);
  return (
    <section className="widget" aria-labelledby="w-admin-queue">
      <div className="widget-head">
        <h2 id="w-admin-queue" className="widget-title wi-h"><IconShield size={18} /> Approvals{total > 0 ? <span className="tab-badge">{total}</span> : null}</h2>
        <Link href="/admin/approvals" prefetch={false} className="widget-more">Open queue →</Link>
      </div>
      {total === 0 ? (
        <p className="widget-empty">Nothing is waiting for an admin.</p>
      ) : (
        <>
          <p className="widget-sum">{chips.map(([label, n]) => <span key={label} className="due-chip later">{n} {label.toLowerCase()}</span>)}</p>
          <ul className="widget-list">
            {oldest.map((r) => (
              <li key={`${r.kind}:${r.user_id}`}>
                <Link href="/admin/approvals" prefetch={false} className="wl-row">
                  <span className="wl-main">
                    <span className="wl-name">{r.name}</span>
                    <span className="wl-meta">{KIND[r.kind] || r.kind}{r.detail ? `: ${r.detail}` : ''}</span>
                  </span>
                  {r.at && <span className="wl-when">since {fmtDay(r.at)}</span>}
                </Link>
              </li>
            ))}
          </ul>
          {total > oldest.length && <Link href="/admin/approvals" prefetch={false} className="widget-foot">{total - oldest.length} more →</Link>}
        </>
      )}
    </section>
  );
}
