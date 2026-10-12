'use client';
import { useEffect, useMemo, useState } from 'react';
import { IconCrop, IconSearch, IconCamera } from '../icons';
import PhotoCropper, { fileToSource } from '../photo-cropper';
import { api } from './api';
import { Headshot } from './Headshot';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';
import { displayName } from '@/lib/policy';

// "Voter photos" (moved from app/bracket-ui.js VoterPhotosModal; inventory §1.16), plus a search box for
// a company-sized list (design §2.3). Anyone can still set anyone's photo (Neil's deliberate choice, rule 50);
// the server records who changed it (users.avatar_set_by / avatar_set_at).
//
//   <VoterPhotos users={users} me={viewer} onSetAvatar={setAvatar} onClose={close} />   as before, or
//   <VoterPhotos me={viewer} onClose={close} onChanged={(id, patch) => ...} />          loads people itself
//
// users: [{ id, username, display_name?, name?, avatar_v, avatar_crop, has_src }]; without it the modal loads
// everyone from GET /api/users/search?photos=1. onSetAvatar(userId, payload | null) may be the page's own
// handler; without it the modal calls the API itself (saveAvatar below) and reports each change through
// onChanged(userId, { avatar_v, avatar_crop, has_src }). zz_ test accounts are never listed (rule 51).

// PUT (payload = { image, crop, source? } from the cropper) or DELETE (payload = null) a user's headshot.
// Resolves to { id, avatar_v, avatar_crop, has_src }; errors throw with the server's message.
export async function saveAvatar(userId, payload) {
  if (payload) {
    const r = await api(`/api/avatar/${userId}`, { method: 'PUT', body: payload });
    return { id: String(userId), avatar_v: r.avatar_v ?? null, avatar_crop: r.avatar_crop ?? null, has_src: !!r.has_src };
  }
  await api(`/api/avatar/${userId}`, { method: 'DELETE' });
  return { id: String(userId), avatar_v: null, avatar_crop: null, has_src: false };
}

const same = (a, b) => a != null && b != null && String(a) === String(b);
const nameOf = (u) => u?.name || displayName(u);

export default function VoterPhotos({ users: given, me, onSetAvatar, onChanged, onClose }) {
  const [list, setList] = useState(() => (Array.isArray(given) ? given : null));
  const [loadErr, setLoadErr] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState({});
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(null);     // { user, src, crop, fresh } while the cropper is open
  const [removing, setRemoving] = useState(null);   // user whose photo is about to be removed

  // The page's list wins when it changes (e.g. after its own refresh).
  useEffect(() => { if (Array.isArray(given)) setList(given); }, [given]);
  useEffect(() => {
    if (Array.isArray(given)) return undefined;
    let live = true;
    api('/api/users/search?photos=1&limit=500', { quiet: true })
      .then((r) => { if (live) setList(Array.isArray(r.users) ? r.users : []); })
      .catch((e) => { if (live) { setList([]); setLoadErr(e.message || 'Couldn’t load the list.'); } });
    return () => { live = false; };
  }, [given]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (list || [])
      .filter((u) => !/^zz_/.test(u.username || ''))      // zz_* accounts are throwaway logins left over from testing
      .filter((u) => !n || nameOf(u).toLowerCase().includes(n) || String(u.username).toLowerCase().includes(n));
  }, [list, q]);

  const apply = async (userId, payload) => {
    let patch;
    if (onSetAvatar) {
      const r = await onSetAvatar(userId, payload);
      patch = payload
        ? { avatar_v: r?.avatar_v ?? Date.now(), avatar_crop: r?.avatar_crop ?? null, has_src: r ? !!r.has_src : true }
        : { avatar_v: null, avatar_crop: null, has_src: false };
    } else {
      const r = await saveAvatar(userId, payload);
      patch = { avatar_v: r.avatar_v, avatar_crop: r.avatar_crop, has_src: r.has_src };
    }
    setList((l) => (l || []).map((u) => (same(u.id, userId) ? { ...u, ...patch } : u)));
    if (onChanged) onChanged(String(userId), patch);
  };

  // A new photo opens straight into the cropper.
  const pick = async (u, file) => {
    if (!file) return;
    setErr('');
    setBusy((b) => ({ ...b, [u.id]: true }));
    try { setEditing({ user: u, src: await fileToSource(file), crop: null, fresh: true }); }
    catch (e) { setErr(e.message || 'Couldn’t read that image'); }
    finally { setBusy((b) => ({ ...b, [u.id]: false })); }
  };
  // Re-crop a photo that's already saved, starting from where it was left (same-origin, so the canvas isn't tainted).
  const adjust = (u) => {
    let crop = null;
    try { crop = typeof u.avatar_crop === 'string' ? JSON.parse(u.avatar_crop || 'null') : (u.avatar_crop || null); } catch {}
    setEditing({ user: u, src: `/api/avatar/${u.id}?src=1&v=${u.avatar_v}`, crop, fresh: false });
  };

  if (editing) {
    return (
      <PhotoCropper
        title={`Photo for ${nameOf(editing.user)}`}
        src={editing.src}
        initialCrop={editing.crop}
        fresh={editing.fresh}
        onCancel={() => setEditing(null)}
        onSave={async (payload) => { await apply(editing.user.id, payload); setEditing(null); }}
      />
    );
  }

  return (
    <>
      <Modal
        title="Voter photos"
        icon={<IconCamera size={20} />}
        className="bk-photos vp-modal"
        onClose={onClose}
        actions={<button type="button" className="btn btn-ink" onClick={onClose}>Done</button>}
      >
        <p className="bk-photos-sub">A person’s photo shows up next to whatever they vote for. Anyone can set anyone’s, so one person can load the whole office. After picking a photo you can drag and zoom it to fit the circle.</p>
        <div className="vp-search">
          <IconSearch size={15} />
          <input
            className="field"
            type="search"
            placeholder="Search by name"
            aria-label="Search people"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {(err || loadErr) && <div className="bk-err" role="alert">{err || loadErr}</div>}
        {list === null && <p className="bk-photos-sub">Loading…</p>}
        {shown.map((u) => (
          <div key={u.id} className="bk-photo-row">
            <Headshot user={u} size={40} />
            <span className="bk-photo-name">{nameOf(u)}{me && same(me.id, u.id) && <em> (you)</em>}</span>
            {u.has_src && u.avatar_v && (
              <button type="button" className="btn btn-plain btn-sm wi" onClick={() => adjust(u)} title="Re-crop or zoom this photo"><IconCrop size={13} /> Adjust</button>
            )}
            <label className="btn btn-plain btn-sm bk-upload">
              {busy[u.id] ? 'Opening…' : (u.avatar_v ? 'New photo' : 'Upload photo')}
              <input type="file" accept="image/*" hidden onChange={(e) => { pick(u, e.target.files[0]); e.target.value = ''; }} />
            </label>
            {u.avatar_v && <button type="button" className="bk-link" onClick={() => setRemoving(u)}>Remove</button>}
          </div>
        ))}
        {list !== null && !shown.length && (
          <p className="bk-photos-sub">{q.trim() ? `No one matches “${q.trim()}”.` : 'No accounts yet.'}</p>
        )}
      </Modal>
      {removing && (
        <ConfirmDialog
          title={`Remove ${nameOf(removing)}’s photo?`}
          confirmLabel="Remove"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={() => { apply(removing.id, null).catch((e) => setErr(e.message || 'Couldn’t remove the photo')); }}
        />
      )}
    </>
  );
}

export { VoterPhotos, VoterPhotos as VoterPhotosModal };
