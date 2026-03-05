import { describe, it, expect } from 'vitest';
import { rowToCard, extractBrief, dedupeFundingTimelineEvents, getFundingTimelineFingerprint } from './news';
import {
  newsItemCardOutputSchema,
  dailyBriefOutputSchema,
  newsEditionOutputSchema,
} from '../validation';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_DB_ROW: Record<string, unknown> = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  title: 'Startup raises $10M Series A',
  summary: 'A promising AI startup has closed a funding round.',
  image_url: 'https://example.com/image.jpg',
  primary_url: 'https://example.com/article',
  published_at: '2026-02-10T08:00:00Z',
  story_type: 'funding',
  topic_tags: ['ai', 'funding'],
  entities: ['Acme AI', 'Sequoia'],
  rank_score: 0.85,
  rank_reason: 'high funding signal',
  trust_score: 0.9,
  source_count: 3,
  primary_source: 'TechCrunch',
  sources: ['TechCrunch', 'Bloomberg', 'Reuters'],
  builder_takeaway: 'Consider similar fundraising strategies',
  llm_model: 'gpt-5-nano',
  llm_summary: 'AI startup secures Series A for expansion.',
  llm_signal_score: 0.78,
  llm_confidence_score: 0.92,
  llm_topic_tags: ['ai', 'enterprise'],
  llm_story_type: 'funding_round',
  upvote_count: 5,
};

const MINIMAL_DB_ROW: Record<string, unknown> = {
  id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  title: 'Quick news item',
  summary: 'Brief summary.',
  primary_url: 'https://example.com/news',
  published_at: '2026-02-10',
  story_type: 'news',
  topic_tags: [],
  entities: [],
  rank_score: 0.5,
  rank_reason: 'default',
  trust_score: 0.6,
  source_count: 1,
  primary_source: 'Blog',
  sources: ['Blog'],
};

const FULL_STATS_JSON: Record<string, any> = {
  daily_brief: {
    headline: 'AI funding surges in Q1 2026',
    summary: 'Multiple AI startups raised significant rounds this week.',
    bullets: [
      'Acme AI raised $10M Series A',
      'WidgetCo launched new platform',
      'Three acquisitions announced',
    ],
    themes: ['funding', 'launches', 'M&A'],
    generated_at: '2026-02-10T06:00:00Z',
    cluster_count: 42,
  },
  total_clusters: 42,
  top_story_count: 5,
  story_type_counts: { funding: 10, launch: 8, acquisition: 3 },
  topic_counts: { ai: 15, fintech: 8, saas: 6 },
  updated_at: '2026-02-10T06:00:00Z',
};

// ---------------------------------------------------------------------------
// rowToCard contract tests
// ---------------------------------------------------------------------------

describe('rowToCard output contract', () => {
  it('validates full DB row against schema', () => {
    const card = rowToCard(FULL_DB_ROW);
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it('validates minimal DB row (no LLM fields)', () => {
    const card = rowToCard(MINIMAL_DB_ROW);
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it('handles null LLM fields gracefully', () => {
    const row = {
      ...MINIMAL_DB_ROW,
      llm_summary: null,
      llm_signal_score: null,
      llm_confidence_score: null,
      llm_topic_tags: null,
      llm_story_type: null,
      llm_model: null,
      builder_takeaway: null,
      upvote_count: null,
    };
    const card = rowToCard(row);
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(true);
    expect(card.llm_summary).toBeUndefined();
    expect(card.llm_signal_score).toBeUndefined();
    expect(card.builder_takeaway).toBeUndefined();
  });

  it('handles missing arrays by defaulting to empty', () => {
    const row = { ...MINIMAL_DB_ROW, topic_tags: undefined, entities: undefined, sources: undefined };
    const card = rowToCard(row);
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(true);
    expect(card.topic_tags).toEqual([]);
    expect(card.entities).toEqual([]);
    expect(card.sources).toEqual([]);
  });

  it('rejects card with empty id (schema requires min 1)', () => {
    const row = { ...MINIMAL_DB_ROW, id: '' };
    const card = rowToCard(row);
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(false);
  });

  it('rejects card with empty title (schema requires min 1)', () => {
    const row = { ...MINIMAL_DB_ROW, title: '' };
    const card = rowToCard(row);
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(false);
  });

  it('builder_takeaway is undefined when llm_model is absent', () => {
    const row = { ...FULL_DB_ROW, llm_model: null };
    const card = rowToCard(row);
    expect(card.builder_takeaway).toBeUndefined();
    expect(card.builder_takeaway_is_llm).toBe(false);
  });

  it('llm_signal_score within 0-1 range passes', () => {
    const card = rowToCard({ ...FULL_DB_ROW, llm_signal_score: 0.5 });
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(true);
  });

  it('llm_signal_score out of range fails schema', () => {
    const card = rowToCard({ ...FULL_DB_ROW, llm_signal_score: 1.5 });
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(false);
  });

  it('llm_confidence_score out of range fails schema', () => {
    const card = rowToCard({ ...FULL_DB_ROW, llm_confidence_score: -0.1 });
    const result = newsItemCardOutputSchema.safeParse(card);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractBrief contract tests
// ---------------------------------------------------------------------------

describe('extractBrief output contract', () => {
  it('validates full stats_json brief against schema', () => {
    const brief = extractBrief(FULL_STATS_JSON);
    expect(brief).toBeDefined();
    const result = dailyBriefOutputSchema.safeParse(brief);
    expect(result.success).toBe(true);
  });

  it('returns undefined when no daily_brief key', () => {
    const brief = extractBrief({ total_clusters: 10 });
    expect(brief).toBeUndefined();
  });

  it('returns undefined when headline is empty', () => {
    const brief = extractBrief({ daily_brief: { headline: '', summary: 'test', bullets: ['a'] } });
    expect(brief).toBeUndefined();
  });

  it('returns undefined when daily_brief is null', () => {
    const brief = extractBrief({ daily_brief: null });
    expect(brief).toBeUndefined();
  });

  it('handles missing optional fields', () => {
    const brief = extractBrief({
      daily_brief: {
        headline: 'Test headline',
        summary: 'Test summary',
        bullets: ['Bullet one'],
      },
    });
    expect(brief).toBeDefined();
    const result = dailyBriefOutputSchema.safeParse(brief);
    expect(result.success).toBe(true);
    expect(brief!.themes).toBeUndefined();
    expect(brief!.generated_at).toBeUndefined();
    expect(brief!.cluster_count).toBeUndefined();
  });

  it('defaults bullets to empty array when not an array', () => {
    const brief = extractBrief({
      daily_brief: {
        headline: 'Headline',
        summary: 'Summary',
        bullets: 'not an array',
      },
    });
    expect(brief).toBeDefined();
    expect(brief!.bullets).toEqual([]);
    // Schema requires min 1 bullet, so this should fail validation
    const result = dailyBriefOutputSchema.safeParse(brief);
    expect(result.success).toBe(false);
  });

  it('themes defaults to undefined when not an array', () => {
    const brief = extractBrief({
      daily_brief: {
        headline: 'Headline',
        summary: 'Summary',
        bullets: ['one'],
        themes: 'not an array',
      },
    });
    expect(brief).toBeDefined();
    expect(brief!.themes).toBeUndefined();
    const result = dailyBriefOutputSchema.safeParse(brief);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Timeline funding dedupe (defense-in-depth)
// ---------------------------------------------------------------------------

describe('dedupeFundingTimelineEvents', () => {
  const baseFundingEvent = {
    event_type: 'cap_funding_raised',
    event_key: 'Series A',
    domain: 'capital',
    display_name: 'Funding Raised',
    confidence: 0.9,
    effective_date: '2026-03-01',
    detected_at: '2026-03-01T10:00:00Z',
    event_title: 'Raises Series A',
    event_content: 'Company raised funding',
    cluster_id: '11111111-1111-1111-1111-111111111111',
    source_type: 'news',
    region: 'global',
  } as const;

  it('builds same fingerprint for normalized funding tokens', () => {
    const a = getFundingTimelineFingerprint({
      id: 'a',
      ...baseFundingEvent,
      metadata_json: {
        funding_amount: '$ 10,000,000',
        lead_investor: 'Sequoia   Capital',
      },
    });
    const b = getFundingTimelineFingerprint({
      id: 'b',
      ...baseFundingEvent,
      event_key: ' series a ',
      metadata_json: {
        mentioned_amount: '$10000000',
        lead_investor: 'sequoia capital',
      },
    });
    expect(a).toBe(b);
  });

  it('removes exact duplicate funding events while preserving order', () => {
    const events = [
      {
        id: '1',
        ...baseFundingEvent,
        metadata_json: { funding_amount: '$10,000,000', lead_investor: 'Sequoia Capital' },
      },
      {
        id: '2',
        ...baseFundingEvent,
        event_key: 'series a',
        cluster_id: '22222222-2222-2222-2222-222222222222',
        metadata_json: { mentioned_amount: '$ 10 000 000', lead_investor: 'sequoia   capital' },
      },
      {
        id: '3',
        ...baseFundingEvent,
        event_type: 'prod_launched',
        event_key: '',
        metadata_json: { product_launched: 'Studio v2' },
      },
    ];

    const deduped = dedupeFundingTimelineEvents(events);
    expect(deduped.map((e) => e.id)).toEqual(['1', '3']);
  });

  it('keeps non-funding events untouched', () => {
    const events = [
      {
        id: 'a',
        ...baseFundingEvent,
        event_type: 'prod_launched',
        event_key: '',
        metadata_json: { product_launched: 'Launch' },
      },
      {
        id: 'b',
        ...baseFundingEvent,
        event_type: 'prod_launched',
        event_key: '',
        metadata_json: { product_launched: 'Launch' },
      },
    ];

    const deduped = dedupeFundingTimelineEvents(events);
    expect(deduped.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// newsEditionOutputSchema structural test
// ---------------------------------------------------------------------------

describe('newsEditionOutputSchema', () => {
  it('validates a complete edition object', () => {
    const edition = {
      edition_date: '2026-02-10',
      generated_at: '2026-02-10T06:00:00Z',
      items: [rowToCard(FULL_DB_ROW), rowToCard(MINIMAL_DB_ROW)],
      brief: extractBrief(FULL_STATS_JSON),
      stats: {
        total_clusters: 42,
        top_story_count: 5,
        story_type_counts: { funding: 10 },
        topic_counts: { ai: 15 },
        updated_at: '2026-02-10T06:00:00Z',
      },
    };
    const result = newsEditionOutputSchema.safeParse(edition);
    expect(result.success).toBe(true);
  });

  it('validates edition without brief', () => {
    const edition = {
      edition_date: '2026-02-10',
      generated_at: '2026-02-10T06:00:00Z',
      items: [],
      stats: {
        total_clusters: 0,
        top_story_count: 0,
        story_type_counts: {},
        topic_counts: {},
        updated_at: '2026-02-10T06:00:00Z',
      },
    };
    const result = newsEditionOutputSchema.safeParse(edition);
    expect(result.success).toBe(true);
  });

  it('rejects invalid edition_date format', () => {
    const edition = {
      edition_date: 'Feb 10, 2026',
      generated_at: '2026-02-10T06:00:00Z',
      items: [],
      stats: {
        total_clusters: 0,
        top_story_count: 0,
        story_type_counts: {},
        topic_counts: {},
        updated_at: '2026-02-10T06:00:00Z',
      },
    };
    const result = newsEditionOutputSchema.safeParse(edition);
    expect(result.success).toBe(false);
  });

  it('rejects missing stats field', () => {
    const edition = {
      edition_date: '2026-02-10',
      generated_at: '2026-02-10T06:00:00Z',
      items: [],
    };
    const result = newsEditionOutputSchema.safeParse(edition);
    expect(result.success).toBe(false);
  });
});
