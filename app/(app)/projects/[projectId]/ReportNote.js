'use client';
import { IconNote } from '@/app/icons';
import { SyncedField } from '@/app/synced';
import { REPORT_NOTE_MAX } from '@/lib/projects';

// "Report note" (Neil, 2026-10-16: "a small little 'Notes:' section at the bottom" of the owner report, "light gray
// ... pretty small ... I want to be able to fill it out and change it"). One short paragraph per project; the report
// prints it under the submittal & permit log as "Notes: ..." and leaves the line out when it is empty. It stays from
// week to week until someone changes it. Anyone who can see the project edits it (like the Status Report).
export default function ReportNote({ project: p, ro, actions, conflictUI }) {
  const note = p.report_note || '';
  const hid = `rn-h-${p.id}`;
  return (
    <div className="info-panel rn-panel" id="report-note">
      <h2 className="notes-label sec-h" id={hid}><IconNote size={14} /> Report note <span>· printed small at the bottom of the owner report</span></h2>
      {ro ? (
        <p className={`rn-ro${note ? '' : ' info-empty'}`}>{note || 'No note.'}</p>
      ) : (
        <SyncedField
          as="textarea"
          className="info-input rn-input"
          rows={2}
          value={note}
          placeholder="e.g. This weekly update is a brief summary of the project. Please contact the CAGE team with any questions."
          aria-labelledby={hid}
          maxLength={REPORT_NOTE_MAX}
          onSave={(v, base) => actions.saveProjectText('report_note', v.replace(/\s+/g, ' ').trim(), base)}
        />
      )}
      {conflictUI(`project:${p.id}:report_note`)}
    </div>
  );
}
