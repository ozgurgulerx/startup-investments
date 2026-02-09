import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Build Atlas — How AI startups are really built',
  description:
    'Build Atlas decodes how AI startups are really built. Monthly dossiers, architecture signals, and reusable build blueprints.',
  keywords: ['AI', 'startups', 'architecture', 'build patterns', 'GenAI', 'dossiers'],
  authors: [{ name: 'Build Atlas' }],
  icons: {
    icon: '/buildatlas-navbar-mark.svg',
    apple: '/buildatlas-site-mark.svg',
  },
  openGraph: {
    title: 'Build Atlas — How AI startups are really built',
    description: 'Build Atlas decodes how AI startups are really built. Monthly dossiers, architecture signals, and reusable build blueprints.',
    type: 'website',
  },
  // Deployer-written build marker used for smoke-checks and cache/debug.
  // Safe to expose (commit SHA only).
  other: {
    'ba-build-sha': process.env.NEXT_PUBLIC_BUILD_SHA || 'unknown',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

