import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageViewer, publicViewer, tagUpdating } from '@/lib/viewer';
import { loadAdminHome, adminClaimAllowed, activeAdminExists } from '@/lib/queries/admin';
import { IconShield, IconCheck, IconAlert, IconChevronRight } from '@/app/icons';
import AdminNav from './_parts/AdminNav';
import ClaimCard from './_parts/ClaimCard';
import BracketsAdmin from './_sections/BracketsAdmin';

// /admin (design §2.1): what's waiting, Neil's post-deploy checklist (§16), data health, the red banner while
// SIGNUP_CODE is unset, and the Brackets restore section (C2's _sections/BracketsAdmin.js).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Admin' };

const KIND = { position: 'Position', office_change: 'Office change', person_link: 'Name link', identity: 'Verify name and email' };
// Server-rendered dates use the viewer's office time zone (the server itself runs in UTC).
const fmtDay = (v, tz) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz }) : '—');
const fmtWhen = (v, tz) => (v ? new Date(v).toLocaleString('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short',
}) : '—');
const n = (v) => Number(v || 0).toLocaleString('en-US');
const s = (v, one, many = `${one}s`) => `${n(v)} ${Number(v) === 1 ? one : many}`;

function Step({ done, title, children, href, cta }) {
  return (
    <li className={`adm-step${done ? ' done' : ''}`}>
      <span className="adm-step-icon">{done ? <IconCheck size={15} /> : <IconAlert size={15} />}</span>
      <div className="adm-step-main">
        <b>{title}</b>
        {children && <span className="adm-step-sub">{children}</span>}
      </div>
      {href && <Link href={href} prefetch={false} className="btn btn-plain btn-sm adm-step-go">{cta || 'Open'}</Link>}
    </li>
  );
}

export default async function AdminPage() {
  const viewer = await requirePageViewer();
  if (!viewer.is_admin) {
    // First-admin setup only while TB_ALLOW_ADMIN_CLAIM=1 and nobody is an admin (never on the live site).
    let claim = false;
    try { claim = adminClaimAllowed() && !(await activeAdminExists()); } catch (e) { throw tagUpdating(e); }
    if (!claim) notFound();
    return <div className="admin-page"><ClaimCard user={publicViewer(viewer)} /></div>;
  }
  let data;
  try {
    data = await loadAdminHome(viewer);
  } catch (e) {
    throw tagUpdating(e);
  }
  const { queue, health, checklist } = data;
  const c = queue.counts;
  const st = health.stats || {};
  const tz = viewer.tz || 'America/Chicago';
  return (
    <div className="admin-page">
      <AdminNav active="home" pending={c.total} />
      <div className="proj-head">
        <h1 className="wi-h"><IconShield size={24} /> Admin</h1>
        <span className="progress-label">Admins only.</span>
      </div>

      {data.signupFallback && (
        <div className="banner adm-danger" role="alert">
          <IconAlert size={16} />
          <span>
            <b>SIGNUP_CODE isn’t set</b>, so the old team code from the public repo still lets anyone create an account.
            Set SIGNUP_CODE in Vercel (Production), redeploy, and share the new code.
          </span>
        </div>
      )}

      <div className="adm-grid">
        <section className="adm-card">
          <div className="adm-card-head">
            <h2>Waiting for approval</h2>
            <Link href="/admin/approvals" prefetch={false} className="btn btn-ink btn-sm wi">Open queue <IconChevronRight size={13} /></Link>
          </div>
          {c.total === 0 ? <p className="muted adm-empty">Nothing is waiting.</p> : (
            <>
              <div className="adm-counts">
                <span><b>{c.positions}</b> position{c.positions === 1 ? '' : 's'}</span>
                <span><b>{c.office_changes}</b> office change{c.office_changes === 1 ? '' : 's'}</span>
                <span><b>{c.person_links}</b> name link{c.person_links === 1 ? '' : 's'}</span>
                <span><b>{c.identity}</b> to verify</span>
              </div>
              <ul className="adm-mini-list">
                {queue.oldest.map((it) => (
                  <li key={it.key}>
                    <span className="adm-mini-kind">{KIND[it.type]}</span>
                    <b>{it.user.name}</b>
                    <span className="muted">{fmtDay(it.at, tz)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="adm-card">
          <div className="adm-card-head"><h2>After the update</h2></div>
          <ol className="adm-steps">
            <Step done={checklist.me_profile && checklist.me_linked} title="Finish your profile and claim your name on tasks"
              href={checklist.me_profile ? '/settings?tab=names' : '/settings'} cta="Settings">
              {checklist.me_linked ? 'Your account is linked to your name on tasks.' : 'Use “Link me to an existing name”, then approve it here.'}
            </Step>
            <Step done={c.positions + c.office_changes + c.person_links === 0} title="Approve positions, office changes and name links"
              href="/admin/approvals" cta="Approvals">
              {c.positions + c.office_changes + c.person_links === 0 ? 'Nothing waiting.'
                : `${s(c.positions, 'position')}, ${s(c.office_changes, 'office change')}, ${s(c.person_links, 'name link')} waiting.`}
            </Step>
            <Step done={c.identity === 0} title="Verify names and emails" href="/admin/approvals" cta="Verify">
              {c.identity === 0 ? 'Everyone who finished their profile is verified.' : `${s(c.identity, 'account')} not verified yet.`}
            </Step>
            <Step done={Number(st.organizers) > 0} title="Flag culture organizers; grant extra offices" href="/admin/users" cta="Accounts">
              {`${s(st.organizers, 'organizer')}, ${s(st.extra_grants, 'extra-office grant')}.`}
            </Step>
            <Step done={!checklist.offices_without_teams.length} title="Check offices and time zones; add starter teams"
              href="/admin/org" cta="Organization">
              {checklist.offices_without_teams.length
                ? `No teams yet in ${checklist.offices_without_teams.join(', ')}.` : 'Every office has a team.'}
            </Step>
            <Step done={checklist.unlinked_names === 0} title="Link names on tasks to accounts" href="/admin/people" cta="Names">
              {checklist.unlinked_names ? `${s(checklist.unlinked_names, 'name')} not linked to an account.` : 'Every name is linked.'}
            </Step>
            <Step done={!data.signupFallback} title="Set a new signup code">
              {data.signupFallback ? 'SIGNUP_CODE is not set in Vercel.' : 'SIGNUP_CODE is set.'}
            </Step>
            <Step done={checklist.rules_applied} title="When ready: apply the new rules to legacy users" href="/admin/users#legacy" cta="Legacy access">
              {`${s(st.legacy_active, 'legacy membership')} still active${checklist.rules_applied ? ' (applied; Undo is on the Accounts page)' : ''}.`}
            </Step>
          </ol>
        </section>

        <section className="adm-card">
          <div className="adm-card-head"><h2>Data health</h2></div>
          <p className={`adm-health-line${health.version.current ? '' : ' warn'}`}>
            {health.version.current ? <IconCheck size={15} /> : <IconAlert size={15} />}
            Schema {health.version.code}{health.version.current ? ' is current.' : ` (database has ${health.version.stored || 'none'})`}
          </p>
          <p className={`adm-health-line${health.geo_guard ? '' : ' warn'}`}>
            {health.geo_guard ? <IconCheck size={15} /> : <IconAlert size={15} />}
            GeoGuessr scores block office deletes{health.geo_guard ? '.' : ': the guard is missing!'}
          </p>
          <p className="adm-health-sub">
            Release 1 migrated {fmtWhen(health.released_at, tz)}. {s(st.active_users, 'active account')} ({s(st.admins, 'admin')},
            {' '}{s(st.profiles_pending, 'profile')} not finished). Legacy memberships: {n(st.legacy_active)} active,
            {' '}{n(st.legacy_removed)} removed.
          </p>
          <table className="adm-table adm-counts-table">
            <thead><tr><th>Table</th><th className="num">Rows</th></tr></thead>
            <tbody>
              {health.tables.filter((t) => t.rows != null).map((t) => (
                <tr key={t.table}><td>{t.table}</td><td className="num">{n(t.rows)}</td></tr>
              ))}
            </tbody>
          </table>
          <details className="adm-details">
            <summary>Ledger ({health.ledger.length})</summary>
            <ul className="adm-ledger">
              {health.ledger.map((l) => <li key={l.key}><code>{l.key}</code> {l.value} <span className="muted">{fmtWhen(l.updated_at, tz)}</span></li>)}
            </ul>
          </details>
        </section>
      </div>

      <BracketsAdmin viewer={publicViewer(viewer)} />
    </div>
  );
}
