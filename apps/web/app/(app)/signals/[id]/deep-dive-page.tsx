'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { DeepDiveResponse } from '@/lib/api/types';
import type { DeepDiveTab } from './types';
import { LEGACY_TAB_REDIRECT } from './types';
import { safeInternalPath } from '@/lib/url';
import { DeepDiveHeader } from './deep-dive-header';
import { TabNavigation } from './tab-navigation';
import { DeltaBoardTab } from './delta-board-tab';
import { HowItWorksTab } from './how-it-works-tab';
import { CaseStudiesTab } from './case-studies-tab';
import { ExplorerTab } from './explorer-tab';
import { RelevanceTab } from './relevance-tab';
import { CounterevienceTab } from './counterevidence-tab';
import { CommunityTab } from './community-tab';

interface DeepDivePageProps {
  data: DeepDiveResponse;
}

function mapTab(raw: string | null): DeepDiveTab {
  const normalized = String(raw || 'delta').toLowerCase().trim();
  return LEGACY_TAB_REDIRECT[normalized] || 'delta';
}

export function DeepDivePage({ data }: DeepDivePageProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get('tab');
  const fromStory = searchParams.get('fromStory');
  const fromNewsRegion = String(searchParams.get('fromNewsRegion') || 'global');
  const originPath = safeInternalPath(searchParams.get('originPath'), { allowedPrefixes: ['/news'] });
  const canonicalTab = useMemo(() => mapTab(rawTab), [rawTab]);
  const [activeTab, setActiveTab] = useState<DeepDiveTab>(canonicalTab);

  const { deep_dive, signal, diff } = data;

  useEffect(() => {
    setActiveTab(canonicalTab);
  }, [canonicalTab]);

  useEffect(() => {
    const normalizedRaw = String(rawTab || '').toLowerCase().trim();
    if (!normalizedRaw || normalizedRaw === canonicalTab) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', canonicalTab);
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [canonicalTab, rawTab, router, searchParams]);

  const handleTabChange = useCallback((tab: DeepDiveTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', tab);
    router.replace(`?${next.toString()}`, { scroll: false });
  }, [router, searchParams]);

  if (!deep_dive || !signal) return null;
  const content = deep_dive.content_json;
  const backToStoryHref = (() => {
    if (originPath) return originPath;
    if (!fromStory) return null;
    const qs = new URLSearchParams();
    if (fromNewsRegion && fromNewsRegion !== 'global') qs.set('region', fromNewsRegion);
    qs.set('story', fromStory);
    return `/news?${qs.toString()}`;
  })();

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {backToStoryHref && (
        <Link
          href={backToStoryHref}
          className="inline-flex items-center gap-1.5 text-xs text-accent-info hover:text-accent-info/80 transition-colors"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to originating story
        </Link>
      )}
      <DeepDiveHeader
        signal={signal}
        version={deep_dive.version}
        createdAt={deep_dive.created_at}
        diff={diff}
        sampleCount={deep_dive.sample_count}
      />

      <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      <div className="min-h-[400px]">
        {activeTab === 'delta' && (
          <DeltaBoardTab signal={signal} content={content} diff={diff} />
        )}
        {activeTab === 'evidence' && (
          <CaseStudiesTab
            content={content}
            signalId={signal.id}
            region={signal.region as ('global' | 'turkey')}
          />
        )}
        {(activeTab === 'actions' || activeTab === 'mechanism') && (
          <HowItWorksTab content={content} signal={signal} />
        )}
        {activeTab === 'explorer' && (
          <ExplorerTab signalId={signal.id} region={signal.region as ('global' | 'turkey')} />
        )}
        {activeTab === 'relevance' && (
          <RelevanceTab signalId={signal.id} region={signal.region as ('global' | 'turkey')} />
        )}
        {activeTab === 'counter' && (
          <CounterevienceTab content={content} />
        )}
        {activeTab === 'community' && (
          <CommunityTab signalId={signal.id} />
        )}
      </div>
    </div>
  );
}
