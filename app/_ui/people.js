// Colors for "names on tasks" (the people table): /people/names, /admin/people, Settings (my color).
// A plain module on purpose (no 'use client', no React): route handlers and server components import
// PERSON_COLORS, normHex and toHex from here too (PUT /api/profile picks a random color for "add me",
// PATCH /api/people/:id validates hex). A 'use client' file would hand server code client references
// instead of the real values, with no build error. ColorControl keeps local state, so it lives in
// ./ColorControl.js (which must stay 'use client') and is re-exported here.

export { ColorControl } from './ColorControl';

export const PERSON_COLORS = ['#5B5859', '#CBCE00', '#0086c0', '#e2445c', '#fdab3d', '#00c875', '#a25ddc', '#ff158a', '#037f4c', '#7f5347'];

// Normalize a typed hex ("5b5859", "#ABC", "#5B5859") to "#rrggbb", or null if invalid.
export function normHex(s) {
  if (!s) return null;
  let h = String(s).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  if (/^[0-9a-fA-F]{6}$/.test(h)) return '#' + h.toLowerCase();
  return null;
}
export function toHex(v) { return normHex(v) || '#5b5859'; }
