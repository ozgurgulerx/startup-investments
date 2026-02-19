import { describe, it, expect, vi } from 'vitest';
import { makeSignalsService } from './signals';

describe('signals claim currency formatting', () => {
  it('sanitizes duplicate dollar symbols in claims', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ cnt: '1' }] };
      return {
        rows: [{
          id: '00000000-0000-0000-0000-000000000001',
          domain: 'capital',
          cluster_name: null,
          claim: 'AI funding: $$4740.1B across 412 deals in 30 days',
          region: 'global',
          conviction: 0.8,
          momentum: 0.9,
          impact: 0.7,
          adoption_velocity: 0.5,
          status: 'accelerating',
          evidence_count: 10,
          unique_company_count: 7,
          first_seen_at: new Date('2026-01-01T00:00:00.000Z'),
          last_evidence_at: new Date('2026-01-30T00:00:00.000Z'),
          metadata_json: null,
        }],
      };
    });

    const service = makeSignalsService({ query } as any);
    const result = await service.getSignalsList({ region: 'global' });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].claim).toBe('AI funding: $4740.1B across 412 deals in 30 days');
  });

  it('sanitizes spaced currency symbols in claims', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(*)')) return { rows: [{ cnt: '1' }] };
      return {
        rows: [{
          id: '00000000-0000-0000-0000-000000000002',
          domain: 'capital',
          cluster_name: null,
          claim: 'AI funding: $ 4.7B across 12 deals in 30 days',
          region: 'global',
          conviction: 0.8,
          momentum: 0.9,
          impact: 0.7,
          adoption_velocity: 0.5,
          status: 'accelerating',
          evidence_count: 10,
          unique_company_count: 7,
          first_seen_at: new Date('2026-01-01T00:00:00.000Z'),
          last_evidence_at: new Date('2026-01-30T00:00:00.000Z'),
          metadata_json: null,
        }],
      };
    });

    const service = makeSignalsService({ query } as any);
    const result = await service.getSignalsList({ region: 'global' });

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].claim).toBe('AI funding: $4.7B across 12 deals in 30 days');
  });
});
