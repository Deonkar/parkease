import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'ParkEase — Find & Book Parking in Seconds',
  description:
    'ParkEase is a peer-to-peer parking marketplace for India. Find, book, and pay for parking spaces near you.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
