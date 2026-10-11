'use client';
import { useState } from 'react';
import { IconAlert } from '../icons';
import { copyText } from './tasks';

// What a field shows after a 409 (design §7.4). The caller has already merged error.current into its state,
// so the field shows their text; this sits under the field:
//   "Kyler Hugg changed this while you were editing."  [Keep mine] [Use theirs] [Copy mine]
//   Keep mine -> onKeepMine(theirValue): resend your text with base = their value.
//   Use theirs -> onUseTheirs(): just dismiss.
//   <ConflictNotice conflict={err} field="title" mine={myText} onKeepMine={(base) => save(myText, base)} onUseTheirs={clear} />
export default function ConflictNotice({ conflict, field, mine, onKeepMine, onUseTheirs }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!conflict) return null;
  const theirs = conflict.current ? conflict.current[field] : undefined;
  const keep = async () => {
    setBusy(true);
    try { await onKeepMine(theirs ?? ''); } finally { setBusy(false); }
  };
  return (
    <div className="conflict" role="alert">
      <div className="conflict-msg"><IconAlert size={15} /> <span>{conflictMessage(conflict)}</span></div>
      <div className="conflict-actions">
        <button type="button" className="btn btn-ink btn-xs" disabled={busy} onClick={keep}>Keep mine</button>
        <button type="button" className="btn btn-plain btn-xs" disabled={busy} onClick={onUseTheirs}>Use theirs</button>
        <button type="button" className="btn btn-plain btn-xs" onClick={async () => { if (await copyText(mine ?? '')) setCopied(true); }}>
          {copied ? 'Copied' : 'Copy mine'}
        </button>
      </div>
    </div>
  );
}

export function conflictMessage(conflict) {
  if (conflict?.message) return conflict.message;
  const who = conflict?.current?.updated_by_name;
  return who ? `${who} changed this while you were editing.` : 'Someone else changed this while you were editing.';
}

// Draft editors (meeting editor, thread edit, event and challenge forms, profile): the editor stays open and
// lists each conflicting field with their version, plus Overwrite with mine / Discard mine and reload.
//   labels: { title: 'Title', notes: 'Notes', ... }
export function DraftConflict({ conflict, labels = {}, onOverwrite, onDiscard }) {
  if (!conflict) return null;
  const fields = conflict.fields?.length ? conflict.fields : Object.keys(labels);
  return (
    <div className="conflict conflict-draft" role="alert">
      <div className="conflict-msg"><IconAlert size={15} /> <span>{conflictMessage(conflict)}</span></div>
      <dl className="conflict-fields">
        {fields.map((f) => (
          <div key={f}>
            <dt>{labels[f] || f}: their version</dt>
            <dd>{String(conflict.current?.[f] ?? '') || <span className="muted">(empty)</span>}</dd>
          </div>
        ))}
      </dl>
      <div className="conflict-actions">
        <button type="button" className="btn btn-ink btn-xs" onClick={onOverwrite}>Overwrite with mine</button>
        <button type="button" className="btn btn-plain btn-xs" onClick={onDiscard}>Discard mine and reload</button>
      </div>
    </div>
  );
}
