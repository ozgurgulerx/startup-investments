import type { NewsItemCard } from '@startup-intelligence/shared';

export interface NewsSections {
  topStories: NewsItemCard[];
  breaking: NewsItemCard[];
  deepReads: NewsItemCard[];
  byTopic: Record<string, NewsItemCard[]>;
  topicOrder: string[];
  remaining: NewsItemCard[];
}

interface SectionOptions {
  breakingWindowMs?: number;
  topStoriesCount?: number;
  maxBreaking?: number;
  maxDeepReads?: number;
  deepReadThreshold?: number;
  minTopicItems?: number;
  maxTopics?: number;
}

const DEFAULTS: Required<SectionOptions> = {
  breakingWindowMs: 4 * 60 * 60 * 1000,
  topStoriesCount: 5,
  maxBreaking: 6,
  maxDeepReads: 4,
  deepReadThreshold: 0.7,
  minTopicItems: 2,
  maxTopics: 6,
};

export function sectionNewsItems(
  items: NewsItemCard[],
  generatedAt: string,
  options?: SectionOptions,
): NewsSections {
  const opts = { ...DEFAULTS, ...options };
  const empty: NewsSections = {
    topStories: [],
    breaking: [],
    deepReads: [],
    byTopic: {},
    topicOrder: [],
    remaining: [],
  };

  if (!items.length) return empty;

  // For sparse editions, only do top stories + remaining
  if (items.length < 10) {
    return {
      ...empty,
      topStories: items.slice(0, opts.topStoriesCount),
      remaining: items.slice(opts.topStoriesCount),
    };
  }

  const assigned = new Set<string>();

  // 1. Top Stories — first N items (already rank-ordered from DB)
  const topStories = items.slice(0, opts.topStoriesCount);
  for (const item of topStories) assigned.add(item.id);

  // Pool for remaining sections
  const pool = items.filter((item) => !assigned.has(item.id));

  // 2. Breaking — published within the window
  const editionTime = new Date(generatedAt).getTime();
  const cutoff = Number.isFinite(editionTime)
    ? editionTime - opts.breakingWindowMs
    : Date.now() - opts.breakingWindowMs;

  const breaking = pool
    .filter((item) => {
      const t = new Date(item.published_at).getTime();
      return Number.isFinite(t) && t > cutoff;
    })
    .sort(
      (a, b) =>
        new Date(b.published_at).getTime() -
        new Date(a.published_at).getTime(),
    )
    .slice(0, opts.maxBreaking);
  for (const item of breaking) assigned.add(item.id);

  // 3. Deep Reads — high LLM signal or builder takeaway
  const deepReads = pool
    .filter((item) => !assigned.has(item.id))
    .filter(
      (item) =>
        (typeof item.llm_signal_score === 'number' &&
          item.llm_signal_score >= opts.deepReadThreshold) ||
        (typeof item.builder_takeaway === 'string' &&
          item.builder_takeaway.length > 0),
    )
    .sort((a, b) => {
      const sa = typeof a.llm_signal_score === 'number' ? a.llm_signal_score : 0;
      const sb = typeof b.llm_signal_score === 'number' ? b.llm_signal_score : 0;
      return sb - sa;
    })
    .slice(0, opts.maxDeepReads);
  for (const item of deepReads) assigned.add(item.id);

  // 4. By Topic — group remaining by first topic_tag, topics with 2+ items
  const topicMap = new Map<string, NewsItemCard[]>();
  for (const item of pool) {
    if (assigned.has(item.id)) continue;
    const tag = item.topic_tags[0];
    if (!tag) continue;
    const normalized = tag.toLowerCase();
    if (!topicMap.has(normalized)) topicMap.set(normalized, []);
    topicMap.get(normalized)!.push(item);
  }

  const byTopic: Record<string, NewsItemCard[]> = {};
  const topicOrder: string[] = [];

  // Sort topics by item count descending, take top N with enough items
  const sortedTopics = [...topicMap.entries()]
    .filter(([, items]) => items.length >= opts.minTopicItems)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, opts.maxTopics);

  for (const [topic, topicItems] of sortedTopics) {
    // Capitalize first letter for display
    const displayTopic = topic.charAt(0).toUpperCase() + topic.slice(1);
    byTopic[displayTopic] = topicItems.sort(
      (a, b) => b.rank_score - a.rank_score,
    );
    topicOrder.push(displayTopic);
    for (const item of topicItems) assigned.add(item.id);
  }

  // 5. Remaining — everything not assigned
  const remaining = items.filter((item) => !assigned.has(item.id));

  return { topStories, breaking, deepReads, byTopic, topicOrder, remaining };
}
