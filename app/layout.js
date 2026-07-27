import './globals.css';

export const metadata = {
  title: 'TeamBoard',
  description: 'A simple shared project & task board for your team.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
