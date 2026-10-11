'use client';
import { useState, useEffect, useRef } from 'react';

// Text box for shared data that several people may edit at once.
//  • Shows other people's changes as they arrive — except while you're typing
//    in it, so your words never get yanked out from under you.
//  • Saves on blur ONLY if you changed the text since you clicked in, so just
//    clicking in and out can never write an old value back over someone
//    else's newer edit.
// onSave(text, base) gets the text and the value the field held when you
// clicked in (the base the server compares against, design §7.4). It may:
//  • return false to reject the text (it then snaps back);
//  • return a promise of the stored value (e.g. trimmed by the server): the
//    field shows it, and it becomes the base for the next edit. A promise that
//    resolves to false snaps back; a rejected promise leaves your text in place
//    (the caller shows the error or the conflict notice).
export function SyncedField({ as = 'input', value, onSave, onFocus, onBlur, ...rest }) {
  const latest = value == null ? '' : String(value);
  const [text, setText] = useState(latest);
  const focused = useRef(false);
  const atFocus = useRef(latest);
  // Newest value known to be on the server: the prop, or a stored value a save returned
  // before the parent caught up.
  const known = useRef(latest);

  useEffect(() => {
    known.current = latest;
    if (!focused.current) setText(latest);
  }, [latest]);

  const adopt = (stored) => {
    if (stored === false) {
      if (!focused.current) setText(known.current);
      return;
    }
    if (stored == null || typeof stored === 'boolean') return;
    known.current = String(stored);
    if (!focused.current) setText(known.current);
  };

  const Tag = as;
  return (
    <Tag
      {...rest}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => { focused.current = true; atFocus.current = text; if (onFocus) onFocus(e); }}
      onBlur={(e) => {
        focused.current = false;
        if (text !== atFocus.current) {
          const r = onSave(text, atFocus.current);
          if (r === false) setText(known.current);
          else if (r && typeof r.then === 'function') r.then(adopt, () => {});
        } else if (text !== known.current) {
          setText(known.current); // someone else changed it while you were in here
        }
        if (onBlur) onBlur(e);
      }}
    />
  );
}

export const SyncedTextarea = (props) => <SyncedField as="textarea" {...props} />;
