import type { Metadata } from 'next';
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

export const metadata: Metadata = {
  title: 'Build Atlas — How AI startups are really built',
  description:
    'Build Atlas decodes how AI startups are really built. Monthly dossiers, architecture signals, and reusable build blueprints.',
  keywords: ['AI', 'startups', 'architecture', 'build patterns', 'GenAI', 'dossiers'],
  authors: [{ name: 'Build Atlas' }],
  openGraph: {
    title: 'Build Atlas — How AI startups are really built',
    description: 'Build Atlas decodes how AI startups are really built. Monthly dossiers, architecture signals, and reusable build blueprints.',
    type: 'website',
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

