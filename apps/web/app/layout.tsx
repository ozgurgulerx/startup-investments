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
  title: 'AI Startup Intelligence | Build Patterns Monthly',
  description:
    'Monthly AI startup funding analysis and insights. Discover build patterns, track trends, and get actionable intelligence.',
  keywords: ['AI', 'startups', 'funding', 'venture capital', 'build patterns', 'GenAI'],
  authors: [{ name: 'AI Startup Intelligence' }],
  openGraph: {
    title: 'AI Startup Intelligence',
    description: 'Monthly AI startup funding analysis and insights',
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
