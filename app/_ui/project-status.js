import { IconCheck } from '../icons';
import { SCHEDULE_STATUSES, scheduleOf } from '@/lib/projects';

// The A6 stage stepper and schedule status pieces (design-amendments A6.5, A6.6), shared by the project page and
// the reports. A plain module (no 'use client', no hooks): the report pages render it on the server without
// handlers, the project page passes onPick from its client components.

// steps = lib/projects.js stageSteps(stages, current): [{ key, label, short, state: done | current | upcoming }].
// With onPick each stage is a button (click = make it current); without, plain text. `full` shows the long labels
// (the report); otherwise the short ones with the long label as a tooltip.
export function StageStepper({ steps, onPick = null, disabled = false, full = false, className = '' }) {
  if (!steps || !steps.length) return null;
  const at = steps.findIndex((s) => s.state === 'current');
  return (
    <ol className={`stage-steps${onPick ? ' pick' : ''}${full ? ' full' : ''}${className ? ` ${className}` : ''}`} aria-label="Project stages">
      {steps.map((s, i) => {
        const inner = (
          <>
            <span className="stage-dot" aria-hidden="true">{s.state === 'done' ? <IconCheck size={12} /> : i + 1}</span>
            <span className="stage-name">{full ? s.label : s.short}</span>
            <span className="sr-only">{s.state === 'done' ? ' (done)' : s.state === 'current' ? ' (current stage)' : ''}</span>
          </>
        );
        return (
          <li key={s.key} className={`stage-step ${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            {onPick ? (
              <button
                type="button"
                className="stage-btn"
                disabled={disabled}
                title={s.state === 'current' ? `Current stage: ${s.label}` : `Make ${s.label} the current stage`}
                aria-label={full ? undefined : s.label + (s.state === 'current' ? ', current stage' : s.state === 'done' ? ', done' : '')}
                onClick={() => { if (s.state !== 'current') onPick(s.key); }}
              >{inner}</button>
            ) : (
              <span className="stage-btn" title={s.label}>{inner}</span>
            )}
          </li>
        );
      })}
      {at < 0 && <li className="stage-none muted">No current stage</li>}
    </ol>
  );
}

// The schedule status as a badge (reports, read-only views). '' -> "Not set".
export function ScheduleBadge({ status, empty = 'Not set' }) {
  const s = scheduleOf(status);
  if (!s) return <span className="sched-badge none">{empty}</span>;
  return <span className={`sched-badge k-${s.key}`} style={{ '--sc': s.color }}><span className="sched-dot" aria-hidden="true" />{s.label}</span>;
}

// The segmented button on the project page: Ahead / On track / Behind; clicking the active one clears it.
export function ScheduleButtons({ value, onPick, disabled = false }) {
  return (
    <div className="sched-seg" role="group" aria-label="Schedule status">
      {SCHEDULE_STATUSES.map((s) => {
        const on = value === s.key;
        return (
          <button
            key={s.key}
            type="button"
            className={`sched-btn k-${s.key}${on ? ' on' : ''}`}
            style={{ '--sc': s.color }}
            aria-pressed={on}
            disabled={disabled}
            title={on ? `${s.label}: click again to clear` : `Mark the schedule ${s.label}`}
            onClick={() => onPick(on ? '' : s.key)}
          >
            <span className="sched-dot" aria-hidden="true" />{s.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- A11 project header strip pieces (design-amendments A11, direction B) ----

// The schedule as one choice of three, a real radio group (Behind / On track / Ahead): click, or arrow keys / Home /
// End move the choice (and save it), with a roving tabindex; hover text says what a click does; a marked Behind turns
// brick (CSS). '' = not set: nothing is marked and the first option takes the focus. disabled = read-only (archived).
const RADIO_ORDER = ['behind', 'on_track', 'ahead'];
export function ScheduleRadios({ value, onPick, disabled = false, labelledBy }) {
  const opts = RADIO_ORDER.map((k) => SCHEDULE_STATUSES.find((s) => s.key === k));
  const at = opts.findIndex((s) => s.key === value);
  const pick = (i, el) => {
    const s = opts[(i + opts.length) % opts.length];
    if (disabled) return;
    if (s.key !== value) onPick(s.key);
    const btns = el?.parentElement?.querySelectorAll('[role="radio"]');
    btns?.[(i + opts.length) % opts.length]?.focus();
  };
  const onKey = (i, e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (d) { e.preventDefault(); pick(i + d, e.currentTarget); return; }
    if (e.key === 'Home') { e.preventDefault(); pick(0, e.currentTarget); }
    if (e.key === 'End') { e.preventDefault(); pick(opts.length - 1, e.currentTarget); }
  };
  return (
    <div className="ps-radios" role="radiogroup" aria-labelledby={labelledBy} aria-disabled={disabled || undefined}>
      {opts.map((s, i) => {
        const on = s.key === value;
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            className={`ps-opt k-${s.key}`}
            disabled={disabled && !on}
            aria-disabled={disabled || undefined}
            title={disabled ? `Schedule: ${value ? scheduleOf(value).label : 'not set'}` : on ? `The schedule is ${s.label}` : `Mark the schedule ${s.label}`}
            onClick={(e) => { if (!on) pick(i, e.currentTarget); }}
            onKeyDown={(e) => onKey(i, e)}
          >
            <span className="ps-dot" aria-hidden="true" />{s.label}
          </button>
        );
      })}
    </div>
  );
}
