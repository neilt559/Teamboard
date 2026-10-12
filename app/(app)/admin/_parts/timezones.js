// Office time zones (design §3.2: offices.tz, NULL shown as America/Chicago). A plain module: the office
// routes validate with it and /admin/org builds its picker from it.

export const DEFAULT_TZ = 'America/Chicago';

// The zones CAGE offices use, plus the rest of the US, in a sensible order for the picker.
export const TIME_ZONES = [
  { tz: 'America/New_York', label: 'Eastern (New York)' },
  { tz: 'America/Chicago', label: 'Central (Chicago)' },
  { tz: 'America/Denver', label: 'Mountain (Denver)' },
  { tz: 'America/Phoenix', label: 'Arizona, no DST (Phoenix)' },
  { tz: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { tz: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { tz: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
];

// A real IANA zone name, or null. Anything Intl accepts is allowed (an admin may need another one).
export function validTimeZone(v) {
  if (typeof v !== 'string') return null;
  const tz = v.trim();
  if (!tz || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return tz;
  } catch {
    return null;
  }
}

export const tzLabel = (tz) => TIME_ZONES.find((z) => z.tz === tz)?.label || tz || TIME_ZONES[1].label;

// "4:05 PM" in that zone.
export function localTime(tz, ms = Date.now()) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz || DEFAULT_TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return '';
  }
}
