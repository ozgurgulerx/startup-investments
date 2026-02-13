import { describe, it, expect, vi } from 'vitest';
import { makeLandscapesService } from './landscapes';

describe('landscapes service', () => {
  it('queries patterns via array membership (not jsonb casts)', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM investments')) return { rows: [] };
      if (sql.includes('FROM pattern_correlations')) return { rows: [] };
      if (sql.includes('FROM startup_state_snapshot ss')) {
        return {
          rows: [{
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Acme AI',
            slug: 'acme-ai',
            money_raised_usd: 1000000,
            funding_stage: 'seed',
          }],
        };
      }
      return { rows: [] };
    });

    const pool = { query } as any;
    const service = makeLandscapesService(pool);

    const result = await service.getClusterDetail({ pattern: 'RAG', scope: 'global' });
    expect(result).not.toBeNull();

    const firstSql = String(query.mock.calls[0]?.[0] || '');
    expect(firstSql).toContain('@> ARRAY[$2]::text[]');
    expect(firstSql).toContain('JOIN startups s2');
    expect(firstSql).toContain('s2.dataset_region = $1');
    expect(firstSql).not.toContain('::jsonb');
  });

  it('does not run substring fallback for Unclassified', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const pool = { query } as any;
    const service = makeLandscapesService(pool);

    const result = await service.getClusterDetail({ pattern: 'Unclassified', scope: 'global' });
    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('uses substring fallback when exact match returns empty', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM investments')) return { rows: [] };
      if (sql.includes('FROM pattern_correlations')) return { rows: [] };
      if (sql.includes('ILIKE')) {
        return {
          rows: [{
            id: '00000000-0000-0000-0000-000000000002',
            name: 'FallbackCo',
            slug: 'fallbackco',
            money_raised_usd: 500000,
            funding_stage: null,
          }],
        };
      }
      // First (exact) pattern query returns empty
      return { rows: [] };
    });

    const pool = { query } as any;
    const service = makeLandscapesService(pool);

    const result = await service.getClusterDetail({ pattern: 'SomePattern', scope: 'global' });
    expect(result).not.toBeNull();

    const sqls = query.mock.calls.map(c => String(c[0] || ''));
    expect(sqls.some(s => s.includes('ILIKE'))).toBe(true);
  });
});
