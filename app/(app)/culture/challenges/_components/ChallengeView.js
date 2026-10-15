'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ConflictError } from '@/app/_ui/api';
import useServerState from '@/app/_ui/useServerState';
import { useRefreshOnFocus } from '@/app/_ui/useRefresh';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import ConflictNotice from '@/app/_ui/ConflictNotice';
import Crumbs from '@/app/_ui/Crumbs';
import { Headshot } from '@/app/_ui/Headshot';
import DeptTag from '@/app/_ui/DeptTag';
import { localISO } from '@/app/_ui/tasks';
import { FormattedNotes } from '@/app/notes-format';
import { IconMedal, IconPencil, IconTrash, IconArchive, IconRestore, IconUsers, IconCheck, IconAlert, IconCalendar } from '@/app/icons';
import {
  GROUP_RANKS, LIMITS, MAX_ENTRIES_PER_DAY, aggregate, canChangeEntry, fmtDay, fmtNumber, fmtRange, fmtScore, metricLine,
  parseValue,
} from '@/lib/challenges';
import { Medal } from './Medal';
import { StatusChip, ScopeChip } from './ChallengeCard';

// The challenge page (design §10(a); agent K1). Server-rendered data (lib/queries/challenges.js loadChallenge) in
// useServerState: own writes update it at once, then router.refresh() brings the boards up to date; the page also
// refreshes on focus (design §7.5). Phone: one column with your standing and "Log my stats" first, the leaderboard
// next (with "You" pinned at the top), then your entries.

const clampDate = (d, b) => (!b ? d : d < b.min ? b.min : d > b.max ? b.max : d);

// My entries changed locally: recompute my score the same way the server does.
function withMine(data, entries) {
  const c = data.challenge;
  const flagged = entries.map((e) => ({ ...e, counted: e.entry_date >= c.starts_on && e.entry_date <= c.ends_on }))
    .sort((a, b) => (a.entry_date < b.entry_date ? 1 : a.entry_date > b.entry_date ? -1 : Number(b.id) - Number(a.id)));
  const counted = flagged.filter((e) => e.counted);
  return { ...data, me: { ...data.me, entries: flagged, entries_counted: counted.length, score: aggregate(c, counted.map((e) => e.value)) } };
}

function whyNoLog(data) {
  const c = data.challenge;
  if (c.archived) return 'This challenge is archived.';
  if (!data.can.participant) return `This challenge is for the ${c.office_name || 'office'}’s people. You can still follow the leaderboard.`;
  if (!data.bounds) return `This challenge starts ${fmtDay(c.starts_on, { weekday: true })}. Come back then to log your stats.`;
  return `This challenge closed for new stats after ${fmtDay(data.entries_close_on, { weekday: true, year: true })}.`;
}

export default function ChallengeView({ initial, viewer }) {
  const router = useRouter();
  useRefreshOnFocus(30_000);
  const [data, setData] = useServerState(initial);
  const [confirmUI, ask] = useConfirm();
  const [toast, setToast] = useState(null);           // { text, undo?: () => void }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const c = data.challenge;
  const today = data.today;

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), toast.undo ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = () => router.refresh();

  const setArchived = async (archived) => {
    if (archived) {
      const yes = await ask({
        title: `Archive “${c.title}”?`,
        lines: ['It disappears from the challenge list, Home and the Culture page. Its entries are kept, and an organizer can restore it any time.'],
        confirmLabel: 'Archive',
      });
      if (!yes) return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await api(`/api/culture/challenges/${c.id}`, { method: 'PATCH', body: { archived } });
      setData((d) => ({ ...d, challenge: { ...d.challenge, ...r.row } }));
      setToast({ text: archived ? 'Challenge archived.' : 'Challenge restored.' });
      refresh();
    } catch (e) {
      setErr(e.message || 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  // ---- entries (mine, and every entry for organizers)
  const replaceEntry = (row) => setData((d) => {
    const mine = d.me.entries.some((e) => e.id === row.id)
      ? d.me.entries.map((e) => (e.id === row.id ? { ...e, ...row } : e))
      : d.me.entries;
    const next = withMine(d, mine);
    return d.all_entries ? { ...next, all_entries: d.all_entries.map((e) => (e.id === row.id ? { ...e, ...row } : e)) } : next;
  });
  const dropEntry = (id) => setData((d) => {
    const next = withMine(d, d.me.entries.filter((e) => e.id !== id));
    return d.all_entries ? { ...next, all_entries: d.all_entries.filter((e) => e.id !== id) } : next;
  });
  const addEntry = (row, { mine = true } = {}) => setData((d) => {
    const next = mine ? withMine(d, [row, ...d.me.entries.filter((e) => e.id !== row.id)]) : d;
    return d.all_entries ? { ...next, all_entries: [row, ...d.all_entries.filter((e) => e.id !== row.id)] } : next;
  });

  const deleteEntry = async (e, label) => {
    const yes = await ask({ title: 'Delete this entry?', lines: [label], confirmLabel: 'Delete', danger: true });
    if (!yes) return;
    try {
      await api(`/api/culture/entries/${e.id}`, { method: 'DELETE' });
      dropEntry(e.id);
      setToast({
        text: 'Entry deleted.',
        undo: async () => {
          setToast(null);
          try {
            const r = await api(`/api/culture/entries/${e.id}`, { method: 'PATCH', body: { deleted: false } });
            addEntry({ ...e, ...r.row }, { mine: String(e.user_id) === String(viewer.id) });
            refresh();
          } catch (x) {
            setToast({ text: x.message || 'Couldn’t bring it back.' });
          }
        },
      });
      refresh();
    } catch (x) {
      setToast({ text: x.message || 'Couldn’t delete it.' });
    }
  };

  const mineOpen = data.me.entries;
  return (
    <div className="ch-page ch-detail">
      <Crumbs items={[{ label: 'Culture', href: '/culture' }, { label: 'Challenges', href: '/culture/challenges' }, { label: c.title || 'Challenge' }]} />
      <div className="proj-head ch-head">
        <h1 className="wi-h"><IconMedal size={24} /> <span className="ch-title">{c.title || 'Untitled challenge'}</span></h1>
        <div className="spacer" />
        {data.can.manage && (
          <div className="ch-head-actions">
            <Link href={`/culture/challenges/${c.id}/edit`} prefetch={false} className="btn btn-plain btn-sm wi"><IconPencil size={14} /> Edit</Link>
            {c.archived
              ? <button type="button" className="btn btn-ink btn-sm wi" disabled={busy} onClick={() => setArchived(false)}><IconRestore size={14} /> Restore</button>
              : <button type="button" className="btn btn-plain btn-sm wi" disabled={busy} onClick={() => setArchived(true)}><IconArchive size={14} /> Archive</button>}
          </div>
        )}
      </div>
      {err && <p className="ch-error" role="alert">{err}</p>}
      {c.archived && (
        <div className="ch-banner" role="status"><IconArchive size={15} /> This challenge is archived. Only organizers can see it until it’s restored.</div>
      )}
      <div className="ch-chips">
        <StatusChip c={{ ...c, status: data.status }} today={today} />
        <ScopeChip c={c} />
        <span className="ch-chip ch-chip-metric">{metricLine(c)}</span>
        <span className="ch-chip ch-chip-dates"><IconCalendar size={12} /> {fmtRange(c.starts_on, c.ends_on)}</span>
      </div>
      {String(c.description || '').trim() && (
        <div className="ch-desc"><FormattedNotes text={c.description} linkify /></div>
      )}

      <div className="ch-layout">
        <div className="ch-col-side">
          <Standing data={data} />
          <LogStats data={data} onLogged={(row) => { addEntry({ ...row, user_name: viewer.name, username: viewer.username }); setToast({ text: `Logged for ${fmtDay(row.entry_date, { weekday: true })}.` }); refresh(); }} />
          <section className="ch-panel ch-mine" aria-labelledby="ch-mine-h">
            <h2 id="ch-mine-h" className="ch-panel-h">My entries{mineOpen.length > 0 && <span className="ch-count">{mineOpen.length}</span>}</h2>
            {mineOpen.length === 0
              ? <p className="ch-quiet">No entries yet{data.can.log ? ': log your first one above.' : '.'}</p>
              : (
                <ul className="ch-entries">
                  {mineOpen.map((e) => (
                    <EntryRow key={e.id} c={c} entry={e} editable={canChangeEntry(viewer, e, c, today)} data={data}
                      onSaved={replaceEntry} onDelete={deleteEntry} />
                  ))}
                </ul>
              )}
            {mineOpen.length > 0 && !data.can.change_own && (
              <p className="ch-quiet">Entries closed for changes after {fmtDay(data.entries_close_on, { year: true })}.</p>
            )}
            {mineOpen.length > 0 && data.can.change_own && !data.can.manage && data.status !== 'upcoming' && (
              <p className="ch-quiet">You can change your entries until {fmtDay(data.entries_close_on, { weekday: true, year: true })}.</p>
            )}
          </section>
        </div>
        <div className="ch-col-main">
          <Boards data={data} viewer={viewer} />
          {data.all_entries && (
            <details className="ch-panel ch-all">
              <summary className="ch-panel-h">All entries <span className="ch-count">{data.all_entries.length}</span> <span className="ch-org-tag">Organizers</span></summary>
              <p className="ch-quiet">Newest first. You can fix or delete anyone’s entry; deleted entries are kept and can be restored.</p>
              {data.all_entries.length === 0 ? <p className="ch-quiet">Nobody has logged anything yet.</p> : (
                <ul className="ch-entries">
                  {data.all_entries.map((e) => (
                    <EntryRow key={e.id} c={c} entry={e} editable data={data} showName onSaved={replaceEntry} onDelete={deleteEntry} />
                  ))}
                </ul>
              )}
            </details>
          )}
        </div>
      </div>
      {toast && (
        <div className="ch-toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="ch-toast-undo" onClick={toast.undo}>Undo</button>}
        </div>
      )}
      {confirmUI}
    </div>
  );
}

// ------------------------------------------------------------------ your standing

function Standing({ data }) {
  const c = data.challenge;
  const me = data.me;
  const n = data.boards.individuals.length;
  return (
    <section className="ch-panel ch-standing" aria-labelledby="ch-standing-h">
      <h2 id="ch-standing-h" className="ch-panel-h">Your standing</h2>
      {me.score == null ? (
        <p className="ch-quiet">{data.can.log || data.status === 'upcoming' ? 'No stats yet.' : 'You didn’t log anything in this challenge.'}</p>
      ) : (
        <div className="ch-standing-row">
          {me.rank ? <Medal rank={me.rank} size={34} /> : null}
          <div className="ch-standing-main">
            <span className="ch-standing-score">{fmtScore(c, me.score)}</span>
            <span className="ch-standing-meta">
              {me.rank ? <>Rank <b>#{me.rank}</b> of {n} · </> : me.ranked ? null : <>Not ranked (test or disabled account) · </>}
              {me.entries_counted} {me.entries_counted === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Log my stats

function LogStats({ data, onLogged }) {
  const c = data.challenge;
  const bounds = data.bounds;
  const [date, setDate] = useState(() => clampDate(data.today, bounds));
  const [touched, setTouched] = useState(false);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isCount = c.aggregation === 'count';

  // The viewer's own local date (design §10(a)), once on the client, unless they already picked one.
  useEffect(() => {
    if (!touched) setDate(clampDate(localISO(new Date()), bounds));
  }, [bounds?.min, bounds?.max]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!data.can.log) {
    return (
      <section className="ch-panel ch-log" id="log" aria-labelledby="ch-log-h">
        <h2 id="ch-log-h" className="ch-panel-h">Log my stats</h2>
        <p className="ch-quiet ch-why"><IconAlert size={14} /> {whyNoLog(data)}</p>
      </section>
    );
  }

  const submit = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    setErr('');
    let v = 1;
    if (!isCount) {
      v = parseValue(value);
      if (v == null) { setErr(value.trim() ? 'Enter a number from 0 to 1,000,000 (up to 2 decimals).' : `Enter your ${c.metric_label.toLowerCase()}.`); return; }
    }
    if (!date || date < bounds.min || date > bounds.max) { setErr(`Pick a date from ${fmtDay(bounds.min)} to ${fmtDay(bounds.max)}.`); return; }
    setBusy(true);
    try {
      const r = await api(`/api/culture/challenges/${c.id}/entries`, { method: 'POST', body: { entry_date: date, value: v, note } });
      setValue('');
      setNote('');
      onLogged(r.entry);
    } catch (e) {
      setErr(e.message || 'That didn’t save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ch-panel ch-log" id="log" aria-labelledby="ch-log-h">
      <h2 id="ch-log-h" className="ch-panel-h">Log my stats</h2>
      <form className="ch-log-form" onSubmit={submit} noValidate>
        <label className="ch-field">
          <span className="ch-label">Date</span>
          <input type="date" className="field ch-input" value={date} min={bounds.min} max={bounds.max}
            onChange={(e) => { setTouched(true); setDate(e.target.value); }} required />
        </label>
        {!isCount && (
          <label className="ch-field">
            <span className="ch-label">{c.metric_label}{c.higher_is_better ? '' : ' (lower is better)'}</span>
            <span className="ch-value">
              <input type="text" inputMode="decimal" autoComplete="off" className="field ch-input" placeholder="e.g. 3.5" value={value}
                onChange={(e) => setValue(e.target.value)} aria-describedby="ch-log-hint" />
              {c.unit && <span className="ch-unit">{c.unit}</span>}
            </span>
          </label>
        )}
        <label className="ch-field ch-field-note">
          <span className="ch-label">Note <span className="ch-opt">(optional)</span></span>
          <input type="text" className="field ch-input" maxLength={LIMITS.note} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={isCount ? 'What did you do?' : 'Anything to add?'} />
        </label>
        {err && <p className="ch-error" role="alert">{err}</p>}
        <div className="ch-log-actions">
          <button type="submit" className="btn btn-lime ch-log-btn wi" disabled={busy}>
            <IconCheck size={15} /> {busy ? 'Saving…' : 'Log it'}
          </button>
          <span id="ch-log-hint" className="ch-hint">
            {c.aggregation === 'sum' ? 'Each entry adds to your total.' : c.aggregation === 'max'
              ? `Your ${c.higher_is_better ? 'best' : 'lowest'} single entry counts.` : 'Every entry counts as one.'}
            {' '}Up to {MAX_ENTRIES_PER_DAY} a day.
          </span>
        </div>
      </form>
    </section>
  );
}

// ------------------------------------------------------------------ one entry (mine, or any for organizers)

function EntryRow({ c, entry, editable, data, showName = false, onSaved, onDelete }) {
  const [edit, setEdit] = useState(null);         // { entry_date, value, note, base }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [conflict, setConflict] = useState(null);
  const isCount = c.aggregation === 'count';
  const label = `${fmtDay(entry.entry_date, { weekday: true })}${isCount ? '' : ` · ${fmtScore(c, entry.value)}`}${entry.note ? ` · ${entry.note}` : ''}`;

  const open = () => {
    setErr('');
    setConflict(null);
    setEdit({ entry_date: entry.entry_date, value: fmtNumber(entry.value).replace(/,/g, ''), note: entry.note, base: entry.note });
  };
  const save = async (baseOverride) => {
    if (!edit || busy) return;
    const body = {};
    if (edit.entry_date !== entry.entry_date) body.entry_date = edit.entry_date;
    if (!isCount) {
      const v = parseValue(edit.value);
      if (v == null) { setErr('Enter a number from 0 to 1,000,000 (up to 2 decimals).'); return; }
      if (v !== Number(entry.value)) body.value = v;
    }
    if (edit.note.trim() !== String(entry.note || '').trim() || baseOverride !== undefined) {
      body.note = edit.note;
      body.base = { note: baseOverride !== undefined ? baseOverride : edit.base };
    }
    if (!Object.keys(body).length) { setEdit(null); return; }
    setBusy(true);
    setErr('');
    try {
      const r = await api(`/api/culture/entries/${entry.id}`, { method: 'PATCH', body });
      setConflict(null);
      setEdit(null);
      onSaved(r.row);
    } catch (e) {
      if (e instanceof ConflictError) {
        setConflict(e.json);
        if (e.current) onSaved({ ...entry, note: e.current.note ?? entry.note });
      } else setErr(e.message || 'That didn’t save.');
    } finally {
      setBusy(false);
    }
  };

  if (edit) {
    const b = data.bounds;
    return (
      <li className="ch-entry is-editing">
        <div className="ch-entry-edit">
          {showName && <span className="ch-entry-who">{entry.user_name || entry.username}</span>}
          <label className="ch-field">
            <span className="ch-label">Date</span>
            <input type="date" className="field ch-input" value={edit.entry_date} min={c.starts_on} max={b ? b.max : c.ends_on}
              onChange={(e) => setEdit({ ...edit, entry_date: e.target.value })} />
          </label>
          {!isCount && (
            <label className="ch-field">
              <span className="ch-label">{c.metric_label}</span>
              <span className="ch-value">
                <input type="text" inputMode="decimal" className="field ch-input" value={edit.value}
                  onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
                {c.unit && <span className="ch-unit">{c.unit}</span>}
              </span>
            </label>
          )}
          <label className="ch-field ch-field-note">
            <span className="ch-label">Note</span>
            <input type="text" className="field ch-input" maxLength={LIMITS.note} value={edit.note}
              onChange={(e) => setEdit({ ...edit, note: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
          </label>
          {conflict && (
            <ConflictNotice conflict={conflict} field="note" mine={edit.note}
              onKeepMine={(theirs) => save(theirs)}
              onUseTheirs={() => { setEdit({ ...edit, note: conflict.current?.note ?? '', base: conflict.current?.note ?? '' }); setConflict(null); }} />
          )}
          {err && <p className="ch-error" role="alert">{err}</p>}
          <div className="ch-entry-actions">
            <button type="button" className="btn btn-plain btn-sm" disabled={busy} onClick={() => { setEdit(null); setConflict(null); setErr(''); }}>Cancel</button>
            <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => save()}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </li>
    );
  }
  return (
    <li className={`ch-entry${entry.counted === false ? ' not-counted' : ''}`}>
      <div className="ch-entry-main">
        {showName && <span className="ch-entry-who">{entry.user_name || entry.username}</span>}
        <span className="ch-entry-date">{fmtDay(entry.entry_date, { weekday: true })}</span>
        {!isCount && <span className="ch-entry-value">{fmtScore(c, entry.value)}</span>}
        {entry.note && <span className="ch-entry-note">{entry.note}</span>}
        {entry.counted === false && <span className="ch-entry-flag">Outside the challenge dates: not counted</span>}
        {entry.updated_by && String(entry.updated_by) !== String(entry.user_id) && entry.updated_by_name && (
          <span className="ch-entry-flag">Edited by {entry.updated_by_name}</span>
        )}
      </div>
      {editable && (
        <div className="ch-entry-btns">
          <button type="button" className="ch-icon-btn" onClick={open} aria-label={`Edit the entry for ${fmtDay(entry.entry_date)}`} title="Edit"><IconPencil size={15} /></button>
          <button type="button" className="ch-icon-btn danger" onClick={() => onDelete(entry, label)} aria-label={`Delete the entry for ${fmtDay(entry.entry_date)}`} title="Delete"><IconTrash size={15} /></button>
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ leaderboards

const TABS = [
  { key: 'individuals', label: 'Individuals' },
  { key: 'offices', label: 'Offices' },
  { key: 'departments', label: 'Departments' },
];

function Boards({ data, viewer }) {
  const [tab, setTab] = useState('individuals');
  const c = data.challenge;
  const rows = data.boards[tab] || [];
  const meIdx = data.boards.individuals.findIndex((r) => r.user_id === String(viewer.id));
  // 'You' pinned at the top of the Individuals board once you're below the first three rows (design §10(a)).
  const meRow = meIdx >= 3 ? data.boards.individuals[meIdx] : null;
  const onKey = (e, i) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.key);
    document.getElementById(`ch-tab-${next.key}`)?.focus();
  };
  return (
    <section className="ch-panel ch-board" aria-labelledby="ch-board-h">
      <div className="ch-board-head">
        <h2 id="ch-board-h" className="ch-panel-h">Leaderboard</h2>
        <div className="ch-tabs" role="tablist" aria-label="Leaderboards">
          {TABS.map((t, i) => (
            <button key={t.key} id={`ch-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key} aria-controls="ch-board-panel"
              tabIndex={tab === t.key ? 0 : -1} className={`ch-tab${tab === t.key ? ' on' : ''}`} onClick={() => setTab(t.key)}
              onKeyDown={(e) => onKey(e, i)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div id="ch-board-panel" role="tabpanel" aria-labelledby={`ch-tab-${tab}`}>
        {tab === 'individuals' ? (
          rows.length === 0 ? <p className="ch-quiet ch-board-empty">No stats logged yet. {data.can.log ? 'Be the first!' : ''}</p> : (
            <>
              {meRow && (
                <div className="ch-you-pin" aria-label="Your place">
                  <PersonRow c={c} r={meRow} you pinned />
                </div>
              )}
              <ol className="ch-rows">
                {rows.map((r) => <PersonRow key={r.user_id} c={c} r={r} you={r.user_id === String(viewer.id)} />)}
              </ol>
            </>
          )
        ) : rows.length === 0 ? <p className="ch-quiet ch-board-empty">No stats logged yet.</p> : (
          <ol className="ch-rows">
            {rows.map((g) => <GroupRow key={g.id} c={c} g={g} kind={tab} />)}
          </ol>
        )}
        <p className="ch-board-foot">
          {tab === 'individuals'
            ? `Ranked by ${metricLine(c).toLowerCase()}. Ties share a rank.`
            : `Each person counts once, under the ${tab === 'offices' ? 'office' : 'department'} of their latest entry. Ranked by ${GROUP_RANKS[c.group_rank].label.toLowerCase()}.`}
        </p>
      </div>
    </section>
  );
}

function PersonRow({ c, r, you = false, pinned = false }) {
  const Tag = pinned ? 'div' : 'li';
  return (
    <Tag className={`ch-row${you ? ' is-you' : ''}${pinned ? ' is-pinned' : ''}${r.rank <= 3 ? ` top-${r.rank}` : ''}`}>
      <span className="ch-row-rank"><Medal rank={r.rank} size={26} /></span>
      <Headshot user={{ id: r.user_id, username: r.username, name: r.name, avatar_v: r.avatar_v }} size={30} />
      <span className="ch-row-main">
        <span className="ch-row-name">
          <Link href={`/people/${r.user_id}`} prefetch={false}>{r.name}</Link>
          {you && <span className="ch-you-tag">You</span>}
        </span>
        <span className="ch-row-meta">
          {r.office_name && <span>{r.office_name}</span>}
          {r.department_name && <DeptTag name={r.department_name} color={r.department_color} />}
        </span>
      </span>
      <span className="ch-row-score">
        <b>{fmtScore(c, r.score)}</b>
        {c.aggregation !== 'count' && <span className="ch-row-sub">{r.entries} {r.entries === 1 ? 'entry' : 'entries'}</span>}
      </span>
    </Tag>
  );
}

function GroupRow({ c, g, kind }) {
  const avg = c.group_rank === 'avg';
  return (
    <li className={`ch-row ch-grow${g.rank <= 3 ? ` top-${g.rank}` : ''}`}>
      <span className="ch-row-rank"><Medal rank={g.rank} size={26} /></span>
      <span className="ch-row-main">
        <span className="ch-row-name">
          {kind === 'departments' && <span className="ch-dot" style={{ background: g.color || '#5B5859' }} aria-hidden="true" />}
          {g.name}
        </span>
        <span className="ch-row-meta"><IconUsers size={12} /> {g.participants} {g.participants === 1 ? 'person' : 'people'}</span>
      </span>
      <span className="ch-row-score">
        <b>{fmtScore(c, avg ? g.average : g.total)}</b>
        <span className="ch-row-sub">{avg ? `avg · total ${fmtNumber(g.total)}` : `total · avg ${fmtNumber(g.average)}`}</span>
      </span>
    </li>
  );
}
