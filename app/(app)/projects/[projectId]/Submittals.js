'use client';
import { useEffect, useRef, useState } from 'react';
import { IconArchive, IconFile, IconRestore } from '@/app/icons';
import { SyncedField } from '@/app/synced';
import { SUBMITTAL_STATUSES, SUBMITTAL_FIELD_LABELS, expectedResponse, submittalStatusOf } from '@/lib/projects';
import { fmtYmd } from '@/app/_ui/project-format';

// Submittals (design-amendments A6.2, A6.5): who you're submitting to, what submittal, a status chip, and the
// dates that belong to the status (Not yet submitted: Target date; Comments received: Received + Reply by; Under
// review: Submitted + Review period (days) + the computed "Response expected"; Approved: Approved date). Changing
// the status keeps the other dates (the server stores them all); only the matching ones show. Anyone who can see
// the project edits them, like tasks. Archive (with a confirm) instead of delete; "Show archived" lists them with
// Restore. One markup for both layouts: a table-like grid on desktop, cards on phones (CSS). They feed the weekly
// owner report, the note too: A11 made it the "Notes" column of the report's submittal & permit log (short notes).

// A date input that saves only the date you end up with, once: when you leave the box, or after you stop typing
// for a moment (a date picked from the calendar saves that way too). Typing over a date segment by segment passes
// through in-between dates (11/15 -> 01/15 -> 10/15 -> 10/02 -> 10/21) and a year typed digit by digit through
// 0002, 0020, 0202; none of those reach the server (2026-10-14 review: they did, and a slow early write left
// the wrong date stored and in the owner report). A half-typed date (the browser reports badInput) is never
// saved as "no date"; leaving the box puts the stored date back. required (A8's received date): an emptied box is
// never saved either; it snaps back to the stored date. Exported for the Attention Items section.
const plausible = (x) => x === '' || /^(19|20|21)[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(x);
const PAUSE_MS = 900;
export function DateField({ value, onSave, disabled, required = false, ...rest }) {
  const stored = value || '';
  const [v, setV] = useState(stored);
  const focused = useRef(false);
  const storedNow = useRef(stored);
  storedNow.current = stored;
  const timer = useRef(null);
  useEffect(() => { if (!focused.current) setV(stored); }, [stored]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Saves x if it is a whole date (or an emptied box) that differs from the stored one; true when x is final.
  const commit = (x, el) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const half = x === '' && !!el?.validity?.badInput;
    if (half || !plausible(x) || (required && x === '')) return false;
    if (x !== storedNow.current) onSave(x || null);
    return true;
  };
  return (
    <input
      type="date"
      className="date-input"
      value={v}
      disabled={disabled}
      required={required}
      onFocus={() => { focused.current = true; }}
      onBlur={(e) => {
        focused.current = false;
        if (!commit(e.currentTarget.value, e.currentTarget)) setV(storedNow.current);
      }}
      onChange={(e) => {
        const el = e.currentTarget;
        setV(el.value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; if (focused.current) commit(el.value, el); }, PAUSE_MS);
      }}
      {...rest}
    />
  );
}

// Review period in days (1-365); saved on blur or Enter; anything else snaps back.
function DaysField({ value, onSave, disabled, ...rest }) {
  const stored = value == null ? '' : String(value);
  const [v, setV] = useState(stored);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(stored); }, [stored]);
  const commit = () => {
    const t = v.trim();
    if (t === stored) return;
    if (t === '') { onSave(null); return; }
    const n = Number(t);
    if (!/^[0-9]{1,3}$/.test(t) || n < 1 || n > 365) { setV(stored); return; }
    onSave(n);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      max={365}
      className="date-input sub-days"
      value={v}
      disabled={disabled}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      onChange={(e) => setV(e.target.value)}
      {...rest}
    />
  );
}

function StatusChip({ status }) {
  const st = submittalStatusOf(status);
  return <span className="sub-chip" style={{ '--sc': st.color }}>{st.label}</span>;
}

// The date inputs (or, read-only, the values) for the submittal's status.
function Dates({ s, ro, onPatch }) {
  const st = submittalStatusOf(s.status);
  const exp = expectedResponse(s);
  const field = (f) => (
    <label key={f} className="sub-date">
      <span className="sub-date-k">{SUBMITTAL_FIELD_LABELS[f]}</span>
      {ro ? (
        <span className="sub-date-v">{f === 'review_days' ? (s.review_days ? `${s.review_days} ${Number(s.review_days) === 1 ? 'day' : 'days'}` : '—') : fmtYmd(s[f]) || '—'}</span>
      ) : f === 'review_days' ? (
        <DaysField value={s.review_days} onSave={(n) => onPatch({ review_days: n })} aria-label={`${SUBMITTAL_FIELD_LABELS[f]} for ${s.title || 'this submittal'}`} />
      ) : (
        <DateField value={s[f]} onSave={(d) => onPatch({ [f]: d })} aria-label={`${SUBMITTAL_FIELD_LABELS[f]} for ${s.title || 'this submittal'}`} />
      )}
    </label>
  );
  return (
    <div className="sub-dates" data-status={st.key}>
      {st.fields.map(field)}
      {st.key === 'under_review' && (
        <div className="sub-date sub-expected">
          <span className="sub-date-k">{SUBMITTAL_FIELD_LABELS.expected_response}</span>
          <span className="sub-date-v" data-expected={exp || ''}>{exp ? fmtYmd(exp) : <span className="muted">Set the submitted date and review period</span>}</span>
        </div>
      )}
    </div>
  );
}

function SubmittalRow({ s, ro, actions, conflictUI, autoFocus }) {
  const st = submittalStatusOf(s.status);
  const notices = [conflictUI(`submittal:${s.id}:agency`), conflictUI(`submittal:${s.id}:title`), conflictUI(`submittal:${s.id}:note`)].filter(Boolean);
  const onPatch = (patch) => actions.patchSubmittal(s.id, patch);
  return (
    <li className="sub-row" data-id={s.id} data-status={st.key}>
      <div className="sub-cell sub-to">
        <span className="sub-lbl">To</span>
        {ro ? <span className="sub-ro">{s.agency || <span className="muted">—</span>}</span> : (
          <SyncedField
            className="sub-input"
            value={s.agency}
            placeholder="Submitting to (agency)"
            aria-label="Submitting to"
            maxLength={200}
            autoFocus={autoFocus}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onSave={(v, base) => actions.saveSubmittalText(s.id, 'agency', v, base)}
          />
        )}
      </div>
      <div className="sub-cell sub-what">
        <span className="sub-lbl">Submittal</span>
        {ro ? <span className="sub-ro sub-ro-title">{s.title || <span className="muted">—</span>}</span> : (
          <SyncedField
            className="sub-input sub-input-title"
            value={s.title}
            placeholder="What submittal (e.g. Final engineering)"
            aria-label="Submittal"
            maxLength={300}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onSave={(v, base) => actions.saveSubmittalText(s.id, 'title', v, base)}
          />
        )}
      </div>
      <div className="sub-cell sub-st">
        <span className="sub-lbl">Status</span>
        {ro ? <StatusChip status={s.status} /> : (
          <select
            className="status-select sub-status"
            value={st.key}
            style={{ '--sc': st.color }}
            aria-label={`Status of ${s.title || 'this submittal'}`}
            onChange={(e) => onPatch({ status: e.target.value })}
          >
            {SUBMITTAL_STATUSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        )}
      </div>
      <div className="sub-cell sub-dcell">
        <Dates s={s} ro={ro} onPatch={onPatch} />
      </div>
      <div className="sub-cell sub-note">
        <span className="sub-lbl">Notes <i>· in the owner report</i></span>
        {ro ? <span className="sub-ro sub-ro-note">{s.note || <span className="muted">—</span>}</span> : (
          <SyncedField
            className="sub-input sub-input-note"
            value={s.note}
            placeholder="Short note for the owner"
            aria-label={`Notes for ${s.title || s.agency || 'this submittal'} (shown in the owner report)`}
            title="Shown in the owner report's Notes column"
            maxLength={300}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onSave={(v, base) => actions.saveSubmittalText(s.id, 'note', v, base)}
          />
        )}
      </div>
      <div className="sub-cell sub-act">
        {!ro && (
          <button type="button" className="row-icon sub-archive" title="Archive this submittal" aria-label={`Archive submittal ${s.title || s.agency || ''}`.trim()} onClick={() => actions.archiveSubmittal(s)}>
            <IconArchive size={16} />
          </button>
        )}
      </div>
      {notices.length > 0 && <div className="sub-conflicts">{notices}</div>}
    </li>
  );
}

export default function Submittals({ submittals, ctx }) {
  const { ro, actions, conflictUI, focusId } = ctx;
  const [showArchived, setShowArchived] = useState(false);
  const active = (submittals || []).filter((s) => !s.archived);
  const archived = (submittals || []).filter((s) => s.archived);

  return (
    <section className="info-panel sub-panel" id={ctx.review ? undefined : 'submittals'} aria-labelledby={ctx.review ? `submittals-h-${ctx.pid}` : 'submittals-h'}>
      <div className="info-head">
        <h2 className="notes-label sec-h" id={ctx.review ? `submittals-h-${ctx.pid}` : 'submittals-h'}><IconFile size={14} /> Submittals <span>· in the weekly owner report</span></h2>
        <div className="sec-actions">
          {archived.length > 0 && (
            <button type="button" className="btn btn-plain btn-sm" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : `Show archived (${archived.length})`}
            </button>
          )}
          {!ro && <button type="button" className="btn btn-lime btn-sm" onClick={actions.addSubmittal}>+ Add submittal</button>}
        </div>
      </div>
      {active.length > 0 ? (
        <div className="sub-table">
          <div className="sub-row sub-head" aria-hidden="true">
            <div className="sub-cell">To</div>
            <div className="sub-cell">Submittal</div>
            <div className="sub-cell">Status</div>
            <div className="sub-cell">Dates</div>
            <div className="sub-cell" title="Shown in the owner report">Notes</div>
            <div className="sub-cell" />
          </div>
          <ul className="sub-list" aria-label="Submittals">
            {active.map((s) => (
              <SubmittalRow key={s.id} s={s} ro={ro} actions={actions} conflictUI={conflictUI} autoFocus={focusId === `submittal:${s.id}`} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="info-empty">No submittals yet{ro || ctx.review ? '.' : ' — add one for each package you send to an agency (e.g. “Village of Lakeview, Final engineering submittal”).'}</p>
      )}
      {showArchived && archived.length > 0 && (
        <div className="sub-archived">
          <h3 className="sub-archived-h"><IconArchive size={14} /> Archived submittals</h3>
          <ul className="sub-list sub-list-archived" aria-label="Archived submittals">
            {archived.map((s) => (
              <li key={s.id} className="sub-arow" data-id={s.id}>
                <span className="sub-arow-main">
                  <b>{s.agency || '—'}</b> · {s.title || 'Untitled submittal'}
                </span>
                <StatusChip status={s.status} />
                {!ro && (
                  <button type="button" className="btn btn-plain btn-sm wi" onClick={() => actions.patchSubmittal(s.id, { archived: false })}>
                    <IconRestore size={13} /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
