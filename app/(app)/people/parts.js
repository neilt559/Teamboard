// Small pieces shared by the directory and profiles. No hooks and no 'use client', so server and client
// components can both use them. The department tag is agent I1's app/_ui/DeptTag.js (one look everywhere).
export { default as DeptTag } from '@/app/_ui/DeptTag';

// "Lisle · Land Dev" (either part may be missing).
export function whereText(office, team) {
  return [office?.name, team?.name].filter(Boolean).join(' · ');
}
