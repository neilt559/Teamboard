'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/app/_ui/api';
import { useConfirm } from '@/app/_ui/ConfirmDialog';
import { IconPencil, IconX, IconRestore, IconArchive } from '@/app/icons';

// Organizer actions on an event page (design §10(b) "Organizers and admins create, edit, cancel and archive"):
// Edit; Cancel event (it stays on the calendar struck through, "Cancelled") / Restore it; Archive (it leaves the
// calendar; nothing is deleted) / Restore from the archive. Each asks first, then refreshes the page.
export default function EventActions({ event }) {
  const router = useRouter();
  const [confirmUI, ask] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const t = `“${event.title}”`;

  const run = async (opts, body, method = 'PATCH') => {
    if (busy) return;
    if (opts && !(await ask(opts))) return;
    setBusy(true);
    setErr('');
    try {
      await api(`/api/culture/events/${event.id}`, { method, ...(body ? { body } : {}) });
      router.refresh();
    } catch (e) {
      setErr(e.message || 'That didn’t save.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ev-actions">
      {!event.archived && (
        <Link href={`/culture/events/${event.id}/edit`} prefetch={false} className="btn btn-ink wi"><IconPencil size={15} /> Edit</Link>
      )}
      {!event.archived && !event.cancelled && (
        <button type="button" className="btn btn-plain wi" disabled={busy}
          onClick={() => run({ title: `Cancel ${t}?`, lines: ['It stays on the calendar, struck through and marked Cancelled, so people know it’s off. You can restore it later.'], confirmLabel: 'Cancel event', cancelLabel: 'Keep it', danger: true }, { cancelled: true })}>
          <IconX size={15} /> Cancel event
        </button>
      )}
      {!event.archived && event.cancelled && (
        <button type="button" className="btn btn-plain wi" disabled={busy} onClick={() => run(null, { cancelled: false })}>
          <IconRestore size={15} /> Restore event
        </button>
      )}
      {!event.archived && (
        <button type="button" className="btn btn-plain wi" disabled={busy}
          onClick={() => run({ title: `Archive ${t}?`, lines: ['It disappears from the calendar for everyone. Nothing is deleted: organizers can restore it from this page.'], confirmLabel: 'Archive', danger: true }, null, 'DELETE')}>
          <IconArchive size={15} /> Archive
        </button>
      )}
      {event.archived && (
        <button type="button" className="btn btn-lime wi" disabled={busy} onClick={() => run(null, { archived: false })}>
          <IconRestore size={15} /> Restore from the archive
        </button>
      )}
      {err && <p className="ev-error" role="alert">{err}</p>}
      {confirmUI}
    </div>
  );
}
