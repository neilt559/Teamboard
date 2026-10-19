'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IconCheck, IconFile, IconPaperclip } from '@/app/icons';
import { reportEmail } from './report-email';
import logo from '@/public/brand/cage-logo-horizontal.png';

// The report pages' buttons (design-amendments A6.6, A6.7), hidden when printing: Back, Copy for email
// (ClipboardItem with text/html + text/plain, so it pastes formatted into Outlook or Gmail; falls back to plain
// text, then to a hidden textarea + execCommand) with a "Copied" confirmation, and Save as PDF (window.print():
// the print CSS hides the app and lays the report out on Letter pages; pick "Save as PDF" as the printer).
// reports = the lib/queries/reports.js report objects the page renders (the email is built from them only);
// preparedBy = the title block's "Prepared by" (the viewer: name, position, email).
async function copyReport(html, text) {
  try {
    if (typeof window !== 'undefined' && window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return 'rich';
    }
  } catch { /* not allowed here: fall back */ }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'plain';
    }
  } catch { /* fall back */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    if (ok) return 'plain';
  } catch { /* nothing left */ }
  return null;
}

export default function ReportActions({ reports, reportDate, owner = '', preparedBy = null, backHref, backLabel = 'Back' }) {
  const [state, setState] = useState(null);          // null | 'rich' | 'plain' | 'fail'
  const timer = useRef(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    // The logo is a public /_next/static file, so the pasted email can load it without a sign-in.
    const logoUrl = new URL(logo.src, window.location.origin).href;
    const { html, text } = reportEmail(reports, { reportDate, owner, preparedBy, logoUrl });
    const r = await copyReport(html, text);
    setState(r || 'fail');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), r ? 4000 : 8000);
  };
  const none = !(reports || []).length;

  return (
    <div className="rp-actions">
      <Link href={backHref} prefetch={false} className="btn btn-plain">{backLabel}</Link>
      <span className="spacer" />
      <button type="button" className="btn btn-plain wi rp-copy" onClick={copy} disabled={none}>
        {state === 'rich' || state === 'plain' ? <IconCheck size={15} /> : <IconPaperclip size={15} />}
        {state === 'rich' || state === 'plain' ? 'Copied' : 'Copy for email'}
      </button>
      <button type="button" className="btn btn-lime wi rp-print" onClick={() => window.print()} disabled={none}>
        <IconFile size={15} /> Save as PDF
      </button>
      <p className="rp-actions-note" role="status" aria-live="polite">
        {state === 'rich' && 'Copied. Paste it into an email: the formatting comes along.'}
        {state === 'plain' && 'Copied as plain text. Paste it into an email.'}
        {state === 'fail' && 'Your browser blocked copying. Select the report and copy it by hand.'}
        {!state && 'Save as PDF opens the print dialog: pick “Save as PDF” as the printer.'}
      </p>
    </div>
  );
}
