'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import type { NewsEdition } from '@startup-intelligence/shared';
import { NewsHeroCard } from './news-hero-card';
import { NewsCard } from './news-card';
import { TopicChipBar } from './topic-chip-bar';

interface DailyNewsModuleProps {
  className?: string;
}

export function DailyNewsModule({ className }: DailyNewsModuleProps) {
  const [edition, setEdition] = useState<NewsEdition | null>(null);
  const [topics, setTopics] = useState<Array<{ topic: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [editionRes, topicsRes] = await Promise.all([
          fetch('/api/news/latest', { cache: 'no-store' }),
          fetch('/api/news/topics', { cache: 'no-store' }),
        ]);

        if (!mounted) return;

        if (editionRes.ok) {
          const data = (await editionRes.json()) as NewsEdition;
          setEdition(data);
        }

        if (topicsRes.ok) {
          const data = (await topicsRes.json()) as Array<{ topic: string; count: number }>;
          setTopics(data);
        }
      } catch (error) {
        console.error('Failed to load daily news module', error);
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const featured = edition?.items?.[0] || null;
  const rest = useMemo(() => (edition?.items || []).slice(1, 5), [edition]);

  if (loading) {
    return (
      <section className={`py-16 ${className || ''}`}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="animate-pulse space-y-4">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-10 w-96 rounded bg-muted" />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="h-60 rounded-xl bg-muted" />
              <div className="grid gap-4">
                <div className="h-28 rounded-xl bg-muted" />
                <div className="h-28 rounded-xl bg-muted" />
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (!edition || !featured) {
    return null;
  }

  return (
    <section className={`relative overflow-hidden py-16 ${className || ''}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_20%,rgba(245,158,11,0.15),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(245,158,11,0.10),transparent_35%)]" />

      <div className="relative max-w-6xl mx-auto px-6">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="label-xs text-accent">Live Intelligence Layer</div>
            <h2 className="mt-2 text-3xl font-light tracking-tight text-foreground">Daily Startup News</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Ranked global startup signals with source diversity, recency weighting, and AI-priority clustering.
            </p>
          </div>
          <Link href="/news" className="inline-flex items-center text-sm text-accent hover:text-accent/80">
            View full daily brief
          </Link>
        </div>

        <TopicChipBar topics={topics} />

        <div className="mt-6 grid gap-4 lg:grid-cols-5">
          <motion.div
            className="lg:col-span-3"
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.4 }}
          >
            <NewsHeroCard item={featured} />
          </motion.div>

          <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-1">
            {rest.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.35, delay: 0.08 * (i + 1) }}
              >
                <NewsCard item={item} />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
