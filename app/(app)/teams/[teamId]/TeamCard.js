'use client';
import { useState } from 'react';
import Link from 'next/link';
import { IconCheck, IconNote, IconFile, IconAlert, IconCalendar, IconList } from '@/app/icons';
import { SyncedTextarea } from '@/app/synced';
import { api, ConflictError } from '@/app/_ui/api';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import { STOPLIGHTS, byPos, personById } from '@/app/_ui/tasks';
import { fmtShort, fmtHhmm } from '@/app/_ui/project-format';
import { SUBMITTAL_STATUSES, projectTitle, scheduleOf, submittalLog } from '@/lib/projects';

// Neil: the card's Status Report "doesn't need titles headers and bullets": it is a plain text box. Notes written
// with the project page's formatting show here without their %t / %h markers (bullets stay as "- " lines); a save
// from the card stores the plain text. Untouched notes are never rewritten.
const plain = (raw) => String(raw || '').split('\n').map((l) => l.replace(/^(\s*)%[th]\s?/, '$1')).join('\n');

// One project on the team page (Neil, 2026-10-15: three cards side by side, each with the Status Report,
// submittals, attention items, meetings and an abbreviated task list: task, who, due date, no subtasks). The team
// goes through these on Fridays, so the common updates happen right here: the Status Report text, a submittal's
// status, "Received" on an attention item, "Mark done" and "+ Add task" on tasks. Anything more detailed opens
// the project page at that section. b = the project page's own data (loadProjectPage), so rights are the same.
export default function TeamCard({ b, menu, onAddTask, onError, refresh }) {
  const p = b.project;
  const pid = String(p.id);
  const today = b.today;
  const ro = !!p.archived;
  const [raw, setRaw] = useState(p.notes || '');          // the stored text (with any formatting markers)
  const notes = plain(raw);
  const [conflict, setConflict] = useState(null);
  const [openTask, setOpenTask] = useState(null);
  const [busy, setBusy] = useState(false);
  const sched = scheduleOf(p.schedule_status);
  const reviewPending = p.status_report_reviewed_at == null && /\S/.test(raw);

  const subs = (b.submittals || []).filter((s) => !s.archived && (String(s.agency || '').trim() || String(s.title || '').trim()));
  const items = (b.attention_items || []).filter((a) => !a.archived && a.status === 'open')
    .sort((x, y) => String(x.need_by || '9999').localeCompare(String(y.need_by || '9999')));
  const meetings = (b.meetings || []).filter((m) => !m.archived && m.meeting_date && m.meeting_date >= today)
    .sort((x, y) => `${x.meeting_date} ${x.meeting_time || ''}`.localeCompare(`${y.meeting_date} ${y.meeting_time || ''}`));
  const tasks = (b.tasks || []).filter((t) => t.parent_id == null && !t.archived).sort(byPos);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); refresh(); } catch (e) { onError(e); } finally { setBusy(false); }
  };

  // base: the text shown when editing began; the server compares against the stored text, so send that when the
  // shown text was the stored one minus its markers.
  async function saveNotes(text, base) {
    const before = raw;
    const storedBase = base === plain(before) ? before : base;
    setRaw(text);
    try {
      const r = await api(`/api/projects/${pid}`, { method: 'PATCH', body: { notes: text, base: { notes: storedBase } } });
      const stored = typeof r?.row?.notes === 'string' ? r.row.notes : text;
      setRaw(stored);
      setConflict(null);
      return plain(stored);
    } catch (e) {
      if (e instanceof ConflictError) { setRaw(e.current?.notes ?? ''); setConflict({ err: e, mine: text }); } else { setRaw(before); onError(e); }
      throw e;
    }
  }

  const section = (icon, label, anchor, n, children) => (
    <div className="tc-sec">
      <div className="tc-sec-head">
        {icon}<span>{label}</span>{n > 0 && <span className="tc-n">{n}</span>}
        <span className="spacer" />
        {!ro && anchor && <Link href={`/projects/${pid}#${anchor}`} prefetch={false} className="tc-more" title={`Add or edit ${label.toLowerCase()} on the project page`}>+ Add</Link>}
      </div>
      {children}
    </div>
  );

  return (
    <div className="overview-card tc-card" data-project={pid}>
      <div className="overview-card-head">
        <Link href={`/projects/${pid}`} prefetch={false} className="overview-open">{projectTitle(p)}</Link>
        <span className="ov-head-side">
          {sched && <span className={`rv-sched rv-sched-${p.schedule_status}`}>{sched.label}</span>}
          {menu}
        </span>
      </div>

      {section(<IconNote size={13} />, 'Status Report', null, 0, (
        <>
          {ro ? (
            <div className="tc-notes-ro">{notes || <span className="tc-none">No status report.</span>}</div>
          ) : (
            <SyncedTextarea
              key={pid}
              className="overview-notes tc-notes"
              value={notes}
              placeholder="Where the project stands this week…"
              aria-label={`Status Report for ${projectTitle(p)}`}
              onSave={(v, base) => saveNotes(v, base)}
            />
          )}
          {conflict && (
            <ConflictNotice
              conflict={conflict.err}
              field="notes"
              mine={conflict.mine}
              onKeepMine={(theirs) => saveNotes(conflict.mine, theirs).catch(() => {})}
              onUseTheirs={() => setConflict(null)}
            />
          )}
          {reviewPending && !ro && (
            <div className="tc-review">
              <span>Not in the owner report yet.</span>
              <button type="button" className="btn btn-ink btn-xs" disabled={busy}
                onClick={() => run(() => api(`/api/projects/${pid}`, { method: 'PATCH', body: { status_report_reviewed: true, base: { notes: raw } } }))}>
                Use in reports
              </button>
            </div>
          )}
        </>
      ))}

      {section(<IconFile size={13} />, 'Submittals', 'submittals', subs.length, subs.length ? (
        <ul className="tc-list">
          {subs.map((s) => {
            const log = submittalLog(s);
            return (
              <li key={s.id} className="tc-row">
                <span className="tc-main" title={`${s.agency || ''} · ${s.title || ''}`}>
                  <b>{s.agency || 'Agency'}</b> {s.title}
                  {log.next && <span className="tc-sub"> · {log.next_label} {fmtShort(log.next, today)}</span>}
                </span>
                <select className="tc-status" value={s.status} disabled={ro || busy} aria-label={`Status of ${s.title || s.agency || 'submittal'}`}
                  onChange={(e) => { const v = e.target.value; run(() => api(`/api/projects/${pid}/submittals/${s.id}`, { method: 'PATCH', body: { status: v } })); }}>
                  {SUBMITTAL_STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </li>
            );
          })}
        </ul>
      ) : <p className="tc-none">None.</p>)}

      {section(<IconAlert size={13} />, 'Attention Items', 'attention-items', items.length, items.length ? (
        <ul className="tc-list">
          {items.map((a) => (
            <li key={a.id} className={`tc-row${a.flag === 'overdue' ? ' late' : ''}`}>
              <span className="tc-main">
                {a.item}
                {(a.from_party || a.need_by) && <span className="tc-sub">{a.from_party ? ` · ${a.from_party}` : ''}{a.need_by ? ` · by ${fmtShort(a.need_by, today)}` : ''}</span>}
              </span>
              {!ro && (
                <button type="button" className="tc-btn" disabled={busy}
                  onClick={() => run(() => api(`/api/projects/${pid}/attention-items/${a.id}`, { method: 'PATCH', body: { status: 'received' } }))}>
                  Received
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : <p className="tc-none">None.</p>)}

      {section(<IconCalendar size={13} />, 'Meetings', 'meetings', meetings.length, meetings.length ? (
        <ul className="tc-list">
          {meetings.map((m) => (
            <li key={m.id} className="tc-row">
              <span className="tc-when">{fmtShort(m.meeting_date, today)}{m.meeting_time ? ` ${fmtHhmm(m.meeting_time)}` : ''}</span>
              <span className="tc-main">{m.title}{m.location && <span className="tc-sub"> · {m.location}</span>}</span>
            </li>
          ))}
        </ul>
      ) : <p className="tc-none">No upcoming meetings.</p>)}

      {section(<IconList size={13} />, 'Tasks', null, tasks.length, (
        <div className="ov-tasks tc-tasks">
          {tasks.length === 0 && <div className="tc-none">No tasks.</div>}
          {tasks.map((t) => {
            const who = personById(b.people, t.assignee_id);
            return (
              <div key={t.id} className="ov-task" style={{ borderLeftColor: t.stoplight && STOPLIGHTS[t.stoplight] ? STOPLIGHTS[t.stoplight] : 'transparent' }}>
                <button type="button" className="ov-task-row" aria-expanded={openTask === t.id} onClick={() => setOpenTask(openTask === t.id ? null : t.id)} title="Click for options">
                  <span className="ov-task-title">{t.title || 'Untitled task'}</span>
                  <span className={`ov-owner${who ? '' : ' ov-unassigned'}`}>{who ? who.name : 'Unassigned'}</span>
                  <span className={`tc-due${t.due_date && t.due_date < today ? ' late' : ''}`}>{t.due_date ? fmtShort(t.due_date, today) : ''}</span>
                </button>
                {openTask === t.id && (
                  <div className="ov-menu">
                    <Link href={`/projects/${pid}/tasks/${t.id}`} prefetch={false} className="ov-menu-btn">View task</Link>
                    {!ro && (
                      <button type="button" className="ov-menu-btn ov-menu-done wi" disabled={busy}
                        onClick={() => { setOpenTask(null); run(() => api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: 'done', archived: true } })); }}>
                        <IconCheck size={13} /> Mark done
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!ro && <button type="button" className="ov-add" onClick={() => onAddTask(pid)}>+ Add task</button>}
        </div>
      ))}

      <Link href={`/projects/${pid}`} prefetch={false} className="overview-open-link">Open project →</Link>
    </div>
  );
}

