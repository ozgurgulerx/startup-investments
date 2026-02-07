import { describe, it, expect } from 'vitest';
import { slugify, parseLocation, parseFundingAmount } from './utils';

describe('slugify', () => {
  it('converts basic names to slugs', () => {
    expect(slugify('OpenAI')).toBe('openai');
    expect(slugify('Acme Inc')).toBe('acme-inc');
  });

  it('handles special characters', () => {
    expect(slugify('Acme & Sons')).toBe('acme-sons');
    expect(slugify('Acme.io')).toBe('acme-io');
    expect(slugify('Acme, Inc.')).toBe('acme-inc');
  });

  it('removes leading/trailing dashes', () => {
    expect(slugify('--test--')).toBe('test');
    expect(slugify('  spaces  ')).toBe('spaces');
  });

  it('handles unicode and numbers', () => {
    expect(slugify('Web3 Labs')).toBe('web3-labs');
    expect(slugify('AI4ALL')).toBe('ai4all');
  });
});

describe('parseLocation', () => {
  it('parses 4-part location correctly (City, State, Country, Continent)', () => {
    const result = parseLocation('San Francisco, California, United States, North America');
    expect(result.city).toBe('San Francisco');
    expect(result.country).toBe('United States');
    expect(result.continent).toBe('North America');
  });

  it('parses 3-part location (City, Country, Continent)', () => {
    const result = parseLocation('London, United Kingdom, Europe');
    expect(result.city).toBe('London');
    expect(result.country).toBe('United Kingdom');
    expect(result.continent).toBe('Europe');
  });

  it('parses 2-part location (Country, Continent)', () => {
    const result = parseLocation('United States, North America');
    expect(result.city).toBe(null);
    expect(result.country).toBe('United States');
    expect(result.continent).toBe('North America');
  });

  it('handles single value', () => {
    const result = parseLocation('Global');
    expect(result.city).toBe('Global');
    expect(result.country).toBe(null);
    expect(result.continent).toBe(null);
  });

  it('handles empty string', () => {
    const result = parseLocation('');
    expect(result.city).toBe(null);
    expect(result.country).toBe(null);
    expect(result.continent).toBe(null);
  });
});

describe('parseFundingAmount', () => {
  it('parses plain numbers', () => {
    expect(parseFundingAmount('1000000')).toBe(1000000);
  });

  it('parses commas and currency symbols', () => {
    expect(parseFundingAmount('$10,500,000')).toBe(10500000);
  });

  it('returns null for invalid inputs', () => {
    expect(parseFundingAmount('')).toBe(null);
    expect(parseFundingAmount('abc')).toBe(null);
  });
});
