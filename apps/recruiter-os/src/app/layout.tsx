import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RecruiterOS',
  description:
    'A daily operating workspace for military recruiters. Turn scattered applicant conversations into recruiter-ready case files.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 375px-wide screens must work without horizontal overflow; pinch-zoom stays
  // available because disabling it is an accessibility failure.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
