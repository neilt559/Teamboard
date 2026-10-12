'use client';
import { Fragment, useEffect, useState } from 'react';
import { IconBuilding, IconCheck, IconCrop, IconCamera } from '@/app/icons';
import PhotoCropper, { fileToSource } from '@/app/photo-cropper';
import DeptTag from '@/app/_ui/DeptTag';
import UserPicker from '@/app/_ui/UserPicker';
import ConfirmDialog from '@/app/_ui/ConfirmDialog';
import { Headshot } from '@/app/_ui/Headshot';
import { saveAvatar } from '@/app/_ui/VoterPhotos';

// The profile fields, shared by the /welcome wizard and Settings > Profile (design §5.2, §5.3: "same form").
// Data comes from lib/queries/profile.js (offices with tz, teams, departments, positions with levels, bosses,
// people). Everything is a plain control with a 44 px target on phones.

// The current time, set after mount (so server and browser render the same HTML), ticking each minute.
export function useNow() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function localTime(now, tz) {
  if (now == null) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Chicago', hour: 'numeric', minute: '2-digit' }).format(new Date(now));
  } catch { return ''; }
}

// Office cards with each office's local time (step 2 "Where you work").
export function OfficeCards({ offices, value, onChange, currentId = null, disabled = false }) {
  const now = useNow();
  const list = offices.filter((o) => !o.archived || String(o.id) === String(currentId));
  return (
    <div className="pf-offices" role="radiogroup" aria-label="Office">
      {list.map((o) => {
        const on = String(value ?? '') === String(o.id);
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className={`pf-office${on ? ' on' : ''}`}
            onClick={() => onChange(String(o.id))}
          >
            <IconBuilding size={18} />
            <span className="pf-office-name">{o.name}</span>
            <span className="pf-office-time">{localTime(now, o.tz) || ' '}</span>
            {String(currentId ?? '') === String(o.id) && <span className="pf-office-cur">Your office</span>}
            {on && <IconCheck size={15} className="pf-office-check" />}
          </button>
        );
      })}
    </div>
  );
}

// Department chips with a live preview of the tag people will see.
export function DeptChips({ departments, value, onChange, currentId = null }) {
  const list = departments.filter((d) => !d.archived || String(d.id) === String(currentId));
  const sel = list.find((d) => String(d.id) === String(value ?? ''));
  return (
    <div>
      <div className="pf-chips" role="radiogroup" aria-label="Department">
        {list.map((d) => {
          const on = sel && sel.id === d.id;
          return (
            <button key={d.id} type="button" role="radio" aria-checked={!!on} className={`pf-chip${on ? ' on' : ''}`}
              onClick={() => onChange(String(d.id))}>
              <span className="dept-dot" style={{ background: d.color }} aria-hidden="true" />
              {d.name}
            </button>
          );
        })}
      </div>
      <p className="pf-preview">Your tag: {sel ? <DeptTag dept={sel} /> : <span className="muted">pick a department</span>}</p>
    </div>
  );
}

const LEVEL_TEXT = {
  1: 'Sees projects you’re added to',
  2: 'Sees every project in your office',
  3: 'Sees every project in the company',
  4: 'Sees everything, including every office’s meeting minutes',
};

// Positions grouped by what they let you see. Anything above max(1, approved level) needs an admin (§4.2a);
// admins' own picks apply at once.
export function PositionGroups({ positions, value, onChange, approvedLevel = 1, isAdmin = false, currentIds = [] }) {
  const cur = currentIds.filter(Boolean).map(String);
  const list = positions.filter((p) => !p.archived || cur.includes(String(p.id)));
  const levels = [...new Set(list.map((p) => p.level))].sort((a, b) => a - b);
  const free = Math.max(1, Number(approvedLevel) || 1);
  return (
    <div className="pf-positions">
      {levels.map((lv) => (
        <fieldset key={lv} className="pf-pos-group">
          <legend>
            {LEVEL_TEXT[lv] || `Level ${lv}`}
            {lv > free && !isAdmin && <span className="pf-needs">: needs admin approval</span>}
          </legend>
          <div className="pf-pos-list">
            {list.filter((p) => p.level === lv).map((p) => {
              const on = String(value ?? '') === String(p.id);
              return (
                <label key={p.id} className={`pf-pos${on ? ' on' : ''}`}>
                  <input type="radio" name="tb-position" value={p.id} checked={on} onChange={() => onChange(String(p.id))} />
                  <span>{p.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function positionNote({ positions, positionId, approvedId, approvedLevel = 1, isAdmin = false }) {
  const p = positions.find((x) => String(x.id) === String(positionId ?? ''));
  if (!p || isAdmin) return null;
  if (String(positionId) === String(approvedId ?? '')) return null;
  if (p.level <= Math.max(1, Number(approvedLevel) || 1)) return null;
  return `${p.name}: pending admin approval. Until then you see the projects you’re assigned to. You’ll keep working normally meanwhile.`;
}

// Teams in one office (plus extra offices for Settings), and "No home team yet" (the pick is the home team; the
// rosters the person is on are listed under it, RosterLine).
export function TeamSelect({ teams, officeIds, value, onChange, id = 'pf-team', currentId = null, offices = [] }) {
  const want = (officeIds || []).filter(Boolean).map(String);
  const list = teams.filter((t) => (want.includes(String(t.office_id)) && !t.archived) || String(t.id) === String(currentId ?? ''));
  const officeName = (oid) => offices.find((o) => String(o.id) === String(oid))?.name || '';
  const multi = want.length > 1;
  return (
    <select id={id} className="field pf-select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No home team yet</option>
      {list.map((t) => (
        <option key={t.id} value={t.id}>{t.name}{multi ? ` (${officeName(t.office_id)})` : ''}{t.archived ? ' (archived)' : ''}</option>
      ))}
    </select>
  );
}

// The team rosters the person is on (A4), read-only under the home-team pick: the roster (set by the team's PM or
// an admin), not the pick, adds them to a team's projects, so a person with no home team can still be on rosters.
//   rosters: [{ id, name, role: 'pm' | 'member', archived }] (lib/queries/profile.js)
export function RosterLine({ rosters }) {
  const list = Array.isArray(rosters) ? rosters : [];
  return (
    <p className="pf-help pf-rosters" data-testid="my-rosters">
      {list.length ? (
        <>
          On the roster of{' '}
          {list.map((t, i) => (
            <Fragment key={t.id}>
              {i ? ', ' : ''}<b>{t.name}</b>{t.role === 'pm' ? ' (PM)' : ''}{t.archived ? ' (archived)' : ''}
            </Fragment>
          ))}
          .
        </>
      ) : 'Not on any team roster yet.'}
    </p>
  );
}

// Boss: any active account, or "Not listed yet" (they may not have signed up). Names are display_name || username.
export function BossPicker({ bosses, value, onChange }) {
  return (
    <UserPicker
      options={bosses}
      value={value}
      onChange={onChange}
      noneLabel="Not listed yet"
      placeholder="Search by name"
      label="Your boss"
    />
  );
}

// "Is one of these you?" (§5.2 step 3). value: a person id, 'add_me', or ''.
export function PersonChoice({ people, value, onChange, allowAddMe = true }) {
  return (
    <div className="pf-people" role="radiogroup" aria-label="Your name on tasks">
      {people.map((p) => {
        const on = String(value) === String(p.id);
        return (
          <label key={p.id} className={`pf-person${on ? ' on' : ''}`}>
            <input type="radio" name="tb-person" checked={on} onChange={() => onChange(String(p.id))} />
            <span className="pf-person-dot" style={{ background: p.color || '#5B5859' }} aria-hidden="true" />
            <span className="pf-person-name">{p.name}</span>
            {p.mine && <span className="acct-tag pending">You asked</span>}
            {p.requested && !p.mine && <span className="pf-person-note">Someone has asked for this name</span>}
          </label>
        );
      })}
      {allowAddMe && (
        <label className={`pf-person${value === 'add_me' ? ' on' : ''}`}>
          <input type="radio" name="tb-person" checked={value === 'add_me'} onChange={() => onChange('add_me')} />
          <span className="pf-person-name">None of these, add me</span>
        </label>
      )}
    </div>
  );
}

// My own photo: upload (opens the cropper), adjust, remove. Saved right away through PUT/DELETE /api/avatar/:me,
// which works before the profile is finished. onChange({ avatar_v, avatar_crop, has_src }).
export function PhotoEditor({ me, photo, onChange, size = 96 }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(false);
  const user = { ...me, ...photo };

  const pick = async (file) => {
    if (!file) return;
    setErr('');
    setBusy(true);
    try { setEditing({ src: await fileToSource(file), crop: null, fresh: true }); }
    catch (e) { setErr(e.message || 'Couldn’t read that image'); }
    finally { setBusy(false); }
  };
  const adjust = () => {
    let crop = null;
    try { crop = typeof photo.avatar_crop === 'string' ? JSON.parse(photo.avatar_crop || 'null') : photo.avatar_crop || null; } catch {}
    setEditing({ src: `/api/avatar/${me.id}?src=1&v=${photo.avatar_v}`, crop, fresh: false });
  };
  const remove = async () => {
    setErr('');
    try { onChange(await saveAvatar(me.id, null)); } catch (e) { setErr(e.message || 'Couldn’t remove the photo'); }
  };

  return (
    <div className="pf-photo">
      <Headshot user={user} size={size} className="pf-photo-hs" />
      <div className="pf-photo-actions">
        <label className="btn btn-ink btn-sm wi pf-upload">
          <IconCamera size={14} /> {busy ? 'Opening…' : (photo.avatar_v ? 'New photo' : 'Upload photo')}
          <input type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files[0]); e.target.value = ''; }} />
        </label>
        {photo.avatar_v && photo.has_src && (
          <button type="button" className="btn btn-plain btn-sm wi" onClick={adjust}><IconCrop size={13} /> Adjust</button>
        )}
        {photo.avatar_v && <button type="button" className="btn btn-plain btn-sm" onClick={() => setConfirm(true)}>Remove</button>}
      </div>
      {err && <div className="bk-err" role="alert">{err}</div>}
      {editing && (
        <PhotoCropper
          title="Your photo"
          src={editing.src}
          initialCrop={editing.crop}
          fresh={editing.fresh}
          onCancel={() => setEditing(null)}
          onSave={async (payload) => { onChange(await saveAvatar(me.id, payload)); setEditing(null); }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title="Remove your photo?"
          confirmLabel="Remove"
          danger
          onClose={() => setConfirm(false)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
