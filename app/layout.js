import './globals.css';
// One stylesheet per area (design §15 M0). shell.css styles the signed-in frame; the others belong to the
// agents that build those pages and start empty.
import './styles/shell.css';
import './styles/home.css';
import './styles/board.css';
import './styles/threads.css';
import './styles/culture.css';
import './styles/calendar.css';
import './styles/admin.css';
import './styles/profile.css';
import './styles/directory.css';
import './styles/geo.css';

export const metadata = {
  title: { default: 'TeamBoard', template: '%s · TeamBoard' },
  description: 'A simple shared project & task board for your team.',
};

// Phones are the main device: no zoom lock (inputs use 16 px text instead), and the bottom bar sits above
// the home indicator (viewport-fit=cover + env(safe-area-inset-bottom) in shell.css).
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#5B5859',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
