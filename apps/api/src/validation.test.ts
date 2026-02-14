import { describe, it, expect } from 'vitest';
import { syncRequestSchema, newsSignalMergeSchema, investorNewsQuerySchema } from './validation';

describe('syncRequestSchema', () => {
  it('accepts valid startup data', () => {
    const result = syncRequestSchema.safeParse({
      startups: [{
        name: 'Acme AI',
        description: 'An AI company',
        website: 'https://acme.ai',
        location: 'San Francisco, California, United States, North America',
        industries: 'AI, SaaS',
        roundType: 'Series A',
        amountUsd: '10000000',
        announcedDate: '2026-01-15',
        fundingStage: 'Early Stage Venture',
        leadInvestors: 'Sequoia',
      }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal startup data (only name required)', () => {
    const result = syncRequestSchema.safeParse({
      startups: [{ name: 'MinimalCo' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startups[0].description).toBe('');
      expect(result.data.startups[0].website).toBe('');
    }
  });

  it('rejects empty startups array', () => {
    const result = syncRequestSchema.safeParse({ startups: [] });
    expect(result.success).toBe(false);
  });

  it('rejects missing startups field', () => {
    const result = syncRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects startup without name', () => {
    const result = syncRequestSchema.safeParse({
      startups: [{ description: 'No name provided' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects startup with empty name', () => {
    const result = syncRequestSchema.safeParse({
      startups: [{ name: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding max length', () => {
    const result = syncRequestSchema.safeParse({
      startups: [{ name: 'x'.repeat(501) }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects description exceeding max length', () => {
    const result = syncRequestSchema.safeParse({
      startups: [{ name: 'Test', description: 'x'.repeat(5001) }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects array exceeding 5000 items', () => {
    const startups = Array.from({ length: 5001 }, (_, i) => ({ name: `Company ${i}` }));
    const result = syncRequestSchema.safeParse({ startups });
    expect(result.success).toBe(false);
  });

  it('rejects non-array startups', () => {
    const result = syncRequestSchema.safeParse({ startups: 'not an array' });
    expect(result.success).toBe(false);
  });
});

describe('newsSignalMergeSchema', () => {
  it('accepts valid user_id + anon_id payload', () => {
    const result = newsSignalMergeSchema.safeParse({
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      anon_id: 'anon-cookie-id',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing anon_id', () => {
    const result = newsSignalMergeSchema.safeParse({
      user_id: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(false);
  });
});

describe('investorNewsQuerySchema', () => {
  it('accepts query without days (all-time)', () => {
    const result = investorNewsQuerySchema.safeParse({ scope: 'global', limit: '10', offset: '0' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toBeUndefined();
      expect(result.data.limit).toBe(10);
    }
  });

  it('accepts days when provided', () => {
    const result = investorNewsQuerySchema.safeParse({ scope: 'turkey', days: '30', limit: '25' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days).toBe(30);
    }
  });

  it('rejects days beyond max', () => {
    const result = investorNewsQuerySchema.safeParse({ scope: 'global', days: '40000' });
    expect(result.success).toBe(false);
  });
});
