'use client';
import { IconExternal, IconFolder } from '@/app/icons';
import { SyncedField } from '@/app/synced';

// "Report Egnyte Link" (Neil, 2026-10-15): one link per project to the Egnyte folder holding everything the owner
// might want; the owner report and its email copy show it as "Project documents: Open the Egnyte folder". Anyone
// who can see the project edits it (like the Status Report); the server keeps only an http(s) address (a pasted
// "cagecivil.egnyte.com/…" gets https://). Replaces the old "Additional project info" section.
export default function ReportLink({ project: p, ro, actions, conflictUI }) {
  const link = p.report_link || '';
  const hid = `rl-h-${p.id}`;
  return (
    <div className="info-panel rl-panel" id="report-link">
      <h2 className="notes-label sec-h" id={hid}><IconFolder size={14} /> Report Egnyte Link <span>· the owner report links to this folder</span></h2>
      <div className="rl-row">
        {ro ? (
          <span className={`rl-ro${link ? '' : ' info-empty'}`}>{link || 'No link.'}</span>
        ) : (
          <SyncedField
            className="info-input rl-input"
            value={link}
            placeholder="Paste the Egnyte folder link (https://…)"
            aria-labelledby={hid}
            maxLength={2000}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            onSave={(v, base) => actions.saveProjectText('report_link', v.trim(), base)}
          />
        )}
        {link && (
          <a className="btn btn-plain btn-sm wi rl-open" href={link} target="_blank" rel="noopener noreferrer"><IconExternal size={13} /> Open</a>
        )}
      </div>
      {conflictUI(`project:${p.id}:report_link`)}
    </div>
  );
}
