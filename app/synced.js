'use client';
import { useState, useEffect, useRef } from 'react';

// Text box for shared data that several people may edit at once.
//  • Shows other people's changes as they arrive — except while you're typing
//    in it, so your words never get yanked out from under you.
//  • Saves on blur ONLY if you changed the text since you clicked in, so just
//    clicking in and out can never write an old value back over someone
//    else's newer edit.
// onSave(text) may return false to reject the text (it then snaps back).
export function SyncedField({ as = 'input', value, onSave, onFocus, onBlur, ...rest }) {
  const latest = value == null ? '' : String(value);
  const [text, setText] = useState(latest);
  const focused = useRef(false);
  const atFocus = useRef(latest);

  useEffect(() => { if (!focused.current) setText(latest); }, [latest]);

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
          if (onSave(text) === false) setText(latest);
        } else if (text !== latest) {
          setText(latest); // someone else changed it while you were in here
        }
        if (onBlur) onBlur(e);
      }}
    />
  );
}

export const SyncedTextarea = (props) => <SyncedField as="textarea" {...props} />;
