import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';

export const metadata: Metadata = {
  title: {
    default: 'Polygon Dashboard - Real-time Gas & Analytics',
    template: '%s | Polygon Dashboard',
  },
  description: 'Real-time Polygon blockchain analytics dashboard tracking gas prices, finality times, MGAS/s, TPS, and transaction fees. Monitor network performance with live charts and historical data.',
  keywords: ['Polygon', 'MATIC', 'gas tracker', 'blockchain analytics', 'finality', 'TPS', 'MGAS', 'crypto dashboard', 'web3'],
  authors: [{ name: 'Polygon Dashboard' }],
  creator: 'Polygon Dashboard',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://polygon-dashboard.mudit.blog',
    siteName: 'Polygon Dashboard',
    title: 'Polygon Dashboard - Real-time Gas & Analytics',
    description: 'Real-time Polygon blockchain analytics dashboard tracking gas prices, finality times, MGAS/s, TPS, and transaction fees.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Polygon Dashboard - Real-time Gas & Analytics',
    description: 'Real-time Polygon blockchain analytics dashboard tracking gas prices, finality times, MGAS/s, and TPS.',
  },
  robots: {
    index: true,
    follow: true,
  },
  metadataBase: new URL('https://polygon-dashboard.mudit.blog'),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-gray-100 min-h-screen">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
