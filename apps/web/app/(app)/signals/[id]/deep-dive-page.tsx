'use client';

import { useState } from 'react';
import type { DeepDiveResponse } from '@/lib/api/client';
import type { DeepDiveTab } from './types';
import { DeepDiveHeader } from './deep-dive-header';
import { TabNavigation } from './tab-navigation';
import { DeltaBoardTab } from './delta-board-tab';
import { HowItWorksTab } from './how-it-works-tab';
import { CaseStudiesTab } from './case-studies-tab';
import { ExplorerTab } from './explorer-tab';
import { CounterevienceTab } from './counterevidence-tab';

interface DeepDivePageProps {
  data: DeepDiveResponse;
}

export function DeepDivePage({ data }: DeepDivePageProps) {
  const [activeTab, setActiveTab] = useState<DeepDiveTab>('delta');

  const { deep_dive, signal, diff } = data;
  if (!deep_dive || !signal) return null;

  const content = deep_dive.content_json;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <DeepDiveHeader
        signal={signal}
        version={deep_dive.version}
        createdAt={deep_dive.created_at}
        diff={diff}
        sampleCount={deep_dive.sample_count}
      />

      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="min-h-[400px]">
        {activeTab === 'delta' && (
          <DeltaBoardTab signal={signal} content={content} diff={diff} />
        )}
        {activeTab === 'mechanism' && (
          <HowItWorksTab content={content} signal={signal} />
        )}
        {activeTab === 'cases' && (
          <CaseStudiesTab
            content={content}
            signalId={signal.id}
          />
        )}
        {activeTab === 'explorer' && (
          <ExplorerTab signalId={signal.id} />
        )}
        {activeTab === 'counter' && (
          <CounterevienceTab content={content} />
        )}
      </div>
    </div>
  );
}
