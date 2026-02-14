import { describe, expect, it, vi } from 'vitest';
import { makeSubscriptionsService } from './subscriptions';

describe('subscriptions service (alerts)', () => {
  it('applies notification preference filters in SQL (count + data)', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(')) {
        return { rows: [{ count: '1' }] };
      }
      return {
        rows: [
          {
            id: '00000000-0000-0000-0000-000000000001',
            user_id: '00000000-0000-0000-0000-0000000000aa',
            scope: 'global',
            delta_id: '00000000-0000-0000-0000-0000000000bb',
            severity: 3,
            status: 'unread',
            reason: '{"match_type":"startup"}',
            narrative: null,
            created_at: '2026-02-14T00:00:00Z',
            headline: 'Test headline',
            delta_type: 'funding_round',
            magnitude: 0.9,
            startup_name: 'Acme',
            startup_slug: 'acme',
          },
        ],
      };
    });

    const pool = { query } as any;
    const service = makeSubscriptionsService(pool);

    const result = await service.getAlerts({
      userId: '00000000-0000-0000-0000-0000000000aa',
      scope: 'global',
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(1);
    expect(result.alerts).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(2);

    const countSql = String(query.mock.calls[0]?.[0] || '');
    const dataSql = String(query.mock.calls[1]?.[0] || '');

    for (const sql of [countSql, dataSql]) {
      expect(sql).toContain('user_notification_preferences');
      expect(sql).toContain('mute_low_severity');
      expect(sql).toContain('muted_delta_types');
      expect(sql).toContain('ANY');
    }
  });

  it('falls back when user_notification_preferences is missing', async () => {
    let call = 0;
    const query = vi.fn(async (sql: string) => {
      call += 1;
      if (call === 1) {
        const err: any = new Error('relation "user_notification_preferences" does not exist');
        err.code = '42P01';
        throw err;
      }
      if (sql.includes('COUNT(')) {
        return { rows: [{ count: '2' }] };
      }
      return {
        rows: [
          {
            id: '00000000-0000-0000-0000-000000000002',
            user_id: '00000000-0000-0000-0000-0000000000aa',
            scope: 'global',
            delta_id: '00000000-0000-0000-0000-0000000000cc',
            severity: 4,
            status: 'unread',
            reason: '{"match_type":"pattern"}',
            narrative: null,
            created_at: '2026-02-14T00:00:00Z',
            headline: 'Fallback headline',
            delta_type: 'signal_spike',
            magnitude: 0.5,
            startup_name: null,
            startup_slug: null,
          },
        ],
      };
    });

    const pool = { query } as any;
    const service = makeSubscriptionsService(pool);

    const result = await service.getAlerts({
      userId: '00000000-0000-0000-0000-0000000000aa',
      scope: 'global',
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(2);
    expect(result.alerts).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(3);

    const firstSql = String(query.mock.calls[0]?.[0] || '');
    const secondSql = String(query.mock.calls[1]?.[0] || '');
    const thirdSql = String(query.mock.calls[2]?.[0] || '');

    expect(firstSql).toContain('user_notification_preferences');
    expect(secondSql).not.toContain('user_notification_preferences');
    expect(thirdSql).not.toContain('user_notification_preferences');
  });
});

