'use client';
import { Fragment, useState } from 'react';
import { IconExternal, IconPaperclip } from '@/app/icons';
import { SyncedField } from '@/app/synced';
import { byPos, copyText, isFilePath, isWebUrl } from '@/app/_ui/tasks';

// The old "Additional project info" rows (inventory §1.7). Neil removed the section on 2026-10-15 in favor of the
// Report Egnyte Link; rows written before stay (nothing is deleted) and show here, folded, only on projects that
// have some, so their links can be copied over and the rows deleted. No new rows. Web links get "Open" (new
// tab); local and UNC paths get "Copy", because browsers can't open them (rule 47). Delete asks first.
export default function ProjectInfo({ rows, ctx }) {
  const { ro, actions, conflictUI, focusId } = ctx;
  const list = [...(rows || [])].sort(byPos);
  if (!list.length) return null;
  return (
    <details className="info-panel info-old">
      <summary className="notes-label"><IconPaperclip size={14} /> Earlier project info ({list.length}) <span>· copy what the owner needs into the Egnyte folder</span></summary>
      {list.length > 0 && (
        <div className="info-table">
          <div className="info-row info-row-head">
            <div>Item</div>
            <div>Info / link</div>
            <div />
          </div>
          {list.map((r) => (
            <InfoRow key={r.id} r={r} ro={ro} actions={actions} conflictUI={conflictUI} autoFocus={focusId === `info:${r.id}`} />
          ))}
        </div>
      )}
    </details>
  );
}

function InfoRow({ r, ro, actions, conflictUI, autoFocus }) {
  const [copied, setCopied] = useState(null);       // null | 'ok' | 'fail'
  const copy = async () => {
    const ok = await copyText(r.value);
    setCopied(ok ? 'ok' : 'fail');
    setTimeout(() => setCopied(null), 1200);
  };
  const notices = [conflictUI(`info:${r.id}:label`), conflictUI(`info:${r.id}:value`)].filter(Boolean);
  return (
    <Fragment>
      <div className="info-row">
        <div className="info-label-cell">
          {ro ? (
            <span className="info-input info-ro">{r.label || <span className="muted">Item name</span>}</span>
          ) : (
            <SyncedField
              className="info-input"
              value={r.label}
              placeholder="Item name"
              aria-label="Item name"
              maxLength={300}
              autoFocus={autoFocus}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              onSave={(v, base) => actions.saveInfoText(r.id, 'label', v, base)}
            />
          )}
        </div>
        <div className="info-value-cell">
          {ro ? (
            <span className="info-input info-ro">{r.value || <span className="muted">—</span>}</span>
          ) : (
            <SyncedField
              className="info-input"
              value={r.value}
              placeholder="Type info, a web link, or a file path…"
              aria-label="Info or link"
              maxLength={4000}
              onSave={(v, base) => actions.saveInfoText(r.id, 'value', v, base)}
            />
          )}
          {isWebUrl(r.value) && (
            <a className="info-action" href={r.value.trim()} target="_blank" rel="noopener noreferrer" title="Open link in a new tab">Open <IconExternal size={12} /></a>
          )}
          {!isWebUrl(r.value) && isFilePath(r.value) && (
            <button type="button" className="info-action" title="Copy path — paste into File Explorer's address bar" onClick={copy}>
              {copied === 'ok' ? 'Copied!' : copied === 'fail' ? 'Copy failed' : 'Copy'}
            </button>
          )}
        </div>
        {!ro ? (
          <button type="button" className="row-x info-del" title="Delete row" aria-label="Delete row" onClick={() => actions.deleteInfo(r)}>×</button>
        ) : <span />}
      </div>
      {notices.length > 0 && <div className="info-conflicts">{notices}</div>}
    </Fragment>
  );
}
