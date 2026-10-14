import { redirect } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';

// /threads/office/[officeId]: an office space became that office's Suggestions/Announcements board
// (design-amendments A10.1). The board page decides who reads it (the same 404 as a missing office otherwise).
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const validId = (v) => /^[1-9][0-9]{0,17}$/.test(String(v ?? ''));

export default async function OfficeSpacePage({ params }) {
  await requirePageViewer();
  redirect(validId(params.officeId) ? `/suggestions/office/${params.officeId}` : '/suggestions');
}
