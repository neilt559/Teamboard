'use client';
import { useEffect, useState } from 'react';

// An office's local clock ("3:42 PM CDT"), from offices.tz (design §2.1). The server renders it with the
// request's time; the browser keeps it current. Times differ by at most a minute between the two renders.
export function fmtLocalTime(ms, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || 'America/Chicago', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
      .format(new Date(ms));
  } catch {
    return '';
  }
}

export default function LocalTime({ tz, now, className = 'local-time' }) {
  const [t, setT] = useState(now);
  useEffect(() => {
    setT(Date.now());
    const id = setInterval(() => setT(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return <span className={className} suppressHydrationWarning>{fmtLocalTime(t, tz)}</span>;
}
