'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconTrash, IconCaret, IconCalendar } from '@/app/icons';
import { SyncedField, SyncedTextarea } from '@/app/synced';
import { api, ConflictError } from '@/app/_ui/api';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import useServerState, { mergeById } from '@/app/_ui/useServerState';
import { localISO } from '@/app/_ui/tasks';
import NameDialog from '../_ui/NameDialog';
import ErrorBanner from '../_ui/ErrorBanner';

// Same order as the server: meeting_date DESC NULLS LAST, then id DESC (no other client re-sort, as today).
const order = (a, b) => {
  const da = a.meeting_date || '';
  const db = b.meeting_date || '';
  if (da !== db) { if (!da) return 1; if (!db) return -1; return da < db ? 1 : -1; }
  return Number(b.id) - Number(a.id);
};

// Office meetings (inventory §1.8): plain minutes that save on blur, like before. Ported from the old
// OfficeView meetings part and its handlers (addMeeting, updateMeeting, deleteMeeting, toggleMeeting).
// Changes: the new meeting's date is the browser's local date (the old UTC date pre-filled tomorrow in US
// evenings, design §17 defaults), the name prompt is an in-page dialog, and title / minutes edits carry the
// value you started from, so someone else's newer text is never silently overwritten (§7).
export default function OfficeMeetings({ officeId, meetings: initial }) {
  const router = useRouter();
  const [meetings, setMeetings] = useServerState(initial);
  const [expanded, setExpanded] = useState({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  const [conflicts, setConflicts] = useState({});     // `${id}:${field}` -> { err, mine }
  const [confirmUI, ask] = useConfirm();

  const patchLocal = (id, patch) => setMeetings((list) => list.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const clearConflict = (key) => setConflicts((c) => { const n = { ...c }; delete n[key]; return n; });

  async function addMeeting(title) {
    const m = await api('/api/meetings', { method: 'POST', body: { office_id: officeId, title, meeting_date: localISO(new Date()) } });
    if (m && m.id) {
      setMeetings((list) => mergeById(list, m).sort(order));
      setExpanded((s) => ({ ...s, [m.id]: true }));
    }
    router.refresh();
  }

  // Title and minutes: send the text plus the value the field held when you clicked in (base). Returns the
  // stored value, which the field shows and uses as its next base.
  async function saveText(m, field, text, base) {
    const key = `${m.id}:${field}`;
    patchLocal(m.id, { [field]: text });
    try {
      const r = await api(`/api/meetings/${m.id}`, { method: 'PATCH', body: { [field]: text, base: { [field]: base } } });
      if (r?.row) setMeetings((list) => mergeById(list, r.row));
      clearConflict(key);
      return r?.row ? r.row[field] : text;
    } catch (e) {
      if (e instanceof ConflictError) {
        if (e.current) patchLocal(m.id, { [field]: e.current[field] ?? '' });
        setConflicts((c) => ({ ...c, [key]: { err: e, mine: text } }));
      } else {
        setError(e.message);
        if (e.status === 404) router.refresh();
      }
      throw e;
    }
  }

  async function setDate(m, value) {
    patchLocal(m.id, { meeting_date: value || null });
    try {
      const r = await api(`/api/meetings/${m.id}`, { method: 'PATCH', body: { meeting_date: value || null } });
      if (r?.row) setMeetings((list) => mergeById(list, r.row));
    } catch (e) {
      setError(e.message);
      router.refresh();
    }
  }

  async function deleteMeeting(m) {
    if (!(await ask({ title: `Delete meeting “${m.title}” and its minutes?`, confirmLabel: 'Delete', danger: true }))) return;
    setMeetings((list) => list.filter((x) => x.id !== m.id));
    try {
      await api(`/api/meetings/${m.id}`, { method: 'DELETE' });
    } catch (e) {
      setError(e.message);
      router.refresh();
    }
  }

  const conflictFor = (m, field) => {
    const key = `${m.id}:${field}`;
    const c = conflicts[key];
    if (!c) return null;
    return (
      <ConflictNotice
        conflict={c.err}
        field={field}
        mine={c.mine}
        onKeepMine={(theirs) => saveText(m, field, c.mine, theirs).catch(() => {})}
        onUseTheirs={() => clearConflict(key)}
      />
    );
  };

  return (
    <div className="office-single office-block">
      <div className="office-section">
        <div className="section-head">
          <h2 className="section-title wi"><IconCalendar size={16} /> Meetings</h2>
          <button type="button" className="btn btn-lime btn-sm" onClick={() => setAdding(true)}>+ New meeting</button>
        </div>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
        {meetings.length === 0 && <p className="ov-empty">No meetings yet — add one to start taking minutes.</p>}
        {meetings.map((m) => {
          const open = !!expanded[m.id];
          return (
            <div key={m.id} className="meeting">
              <div className="meeting-head">
                <button
                  type="button"
                  className="team-caret meeting-caret"
                  onClick={() => setExpanded((s) => ({ ...s, [m.id]: !s[m.id] }))}
                  aria-label="Toggle minutes"
                  aria-expanded={open}
                >
                  <IconCaret size={16} className={open ? '' : 'caret-collapsed'} />
                </button>
                <SyncedField
                  className="meeting-title"
                  value={m.title}
                  placeholder="Meeting"
                  aria-label="Meeting title"
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                  onSave={(v, base) => saveText(m, 'title', v, base)}
                />
                <input
                  type="date"
                  className="date-input meeting-date"
                  aria-label="Meeting date"
                  value={m.meeting_date || ''}
                  onChange={(e) => setDate(m, e.target.value)}
                />
                <button type="button" className="row-icon danger" title="Delete meeting" aria-label="Delete meeting" onClick={() => deleteMeeting(m)}><IconTrash /></button>
              </div>
              {conflictFor(m, 'title')}
              {open && (
                <SyncedTextarea
                  className="meeting-minutes"
                  value={m.minutes || ''}
                  aria-label={`Minutes of ${m.title}`}
                  placeholder="Meeting minutes — attendees, agenda, decisions, action items…"
                  onSave={(v, base) => saveText(m, 'minutes', v, base)}
                />
              )}
              {open && conflictFor(m, 'minutes')}
            </div>
          );
        })}
      </div>
      {adding && (
        <NameDialog
          title="New meeting" label="Meeting name" initial="Meeting" fallback="Meeting" mode="create" maxLength={300}
          confirmLabel="Add meeting" busyLabel="Adding…"
          onSubmit={addMeeting} onClose={() => setAdding(false)}
        />
      )}
      {confirmUI}
    </div>
  );
}
