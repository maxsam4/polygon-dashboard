import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

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
    <html lang="en" suppressHydrationWarning className={jetbrainsMono.variable}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.classList.add(t)}else if(window.matchMedia('(prefers-color-scheme:light)').matches){document.documentElement.classList.add('light')}else{document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}})()`,
          }}
        />
      </head>
      <body className="font-mono bg-background text-foreground min-h-screen">
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
