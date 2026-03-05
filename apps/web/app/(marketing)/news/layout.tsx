import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Build Atlas Signal Feed — Live startup signals',
  description: 'Corroborated signals ranked by impact, confidence, and sources.',
};

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
