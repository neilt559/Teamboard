import CultureNav from './CultureNav';

// /culture and everything under it (design §2.1, §10): a sub-nav (Overview, Brackets, GeoGuessr) above each
// page. Release 3 adds Challenge and Calendar here. The (app) layout and each page do the auth checks; this
// layout reads no data.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export default function CultureLayout({ children }) {
  return (
    <div className="culture">
      <CultureNav />
      {children}
    </div>
  );
}
