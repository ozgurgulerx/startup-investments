import { z } from 'zod';

// =============================================================================
// Reusable primitives
// =============================================================================

const paginationPage = z.coerce.number().int().min(1).max(1000).default(1);
const paginationLimit = z.coerce.number().int().min(1).max(100).default(25);
const periodParam = z.string().max(10).regex(/^(all|\d{4}-\d{2})$/).default('all');
function optionalTrimmedString(max: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }, z.string().max(max).optional());
}

// Querystring params frequently arrive as `""` or `"   "`. Treat blanks as "not provided"
// so filtering + caching semantics stay aligned.
const optionalString = optionalTrimmedString(500);
const optionalSearchString = optionalTrimmedString(200);
const optionalTopicString = optionalTrimmedString(100);
const datasetRegionParam = z.enum(['global', 'turkey']).default('global');
const newsRegionParam = z.enum(['global', 'turkey']).default('global');
const newsDateParam = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

// =============================================================================
// GET endpoint schemas
// =============================================================================

export const startupsQuerySchema = z.object({
  page: paginationPage,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  region: datasetRegionParam,
});

export const companyQuerySchema = z.object({
  period: periodParam,
  region: datasetRegionParam,
});

export const statsQuerySchema = z.object({
  period: periodParam,
  region: datasetRegionParam,
});

export const periodsQuerySchema = z.object({
  region: datasetRegionParam,
});

export const dealBookQuerySchema = z.object({
  period: periodParam,
  region: datasetRegionParam,
  page: paginationPage,
  limit: paginationLimit,
  stage: optionalString,
  pattern: optionalString,
  continent: optionalString,
  vertical: optionalString,
  verticalId: optionalString,
  subVerticalId: optionalString,
  leafId: optionalString,
  minFunding: z.coerce.number().int().min(0).optional(),
  maxFunding: z.coerce.number().int().min(0).optional(),
  usesGenai: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['funding', 'name', 'date']).default('funding'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: optionalSearchString,
});

export const dealBookFiltersQuerySchema = z.object({
  period: periodParam,
  region: datasetRegionParam,
  verticalId: optionalString,
  subVerticalId: optionalString,
});

export const investorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const newsLatestQuerySchema = z.object({
  region: newsRegionParam,
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const newsEditionQuerySchema = z.object({
  region: newsRegionParam,
  date: newsDateParam,
  topic: optionalTopicString,
  limit: z.coerce.number().int().min(1).max(100).default(40),
});

export const newsTopicsQuerySchema = z.object({
  region: newsRegionParam,
  date: newsDateParam,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const newsArchiveQuerySchema = z.object({
  region: newsRegionParam,
  limit: z.coerce.number().int().min(1).max(180).default(30),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const newsSourcesQuerySchema = z.object({
  region: newsRegionParam,
});

export const newsBriefQuerySchema = z.object({
  region: newsRegionParam,
});

export const newsSearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  region: newsRegionParam,
  limit: z.coerce.number().int().min(1).max(50).default(20),
  story_type: optionalTrimmedString(50),
  topic: optionalTopicString,
  date_from: newsDateParam,
  date_to: newsDateParam,
});

export const newsBriefArchiveQuerySchema = z.object({
  region: newsRegionParam,
  type: z.enum(['weekly', 'monthly']).default('weekly'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

// =============================================================================
// Admin / POST schemas
// =============================================================================

export const syncStartupSchema = z.object({
  name: z.string().min(1).max(500),
  description: z.string().max(5000).optional().default(''),
  website: z.string().max(1000).optional().default(''),
  location: z.string().max(500).optional().default(''),
  industries: z.string().max(500).optional().default(''),
  roundType: z.string().max(100).optional().default(''),
  amountUsd: z.string().max(50).optional().default(''),
  announcedDate: z.string().max(20).optional().default(''),
  fundingStage: z.string().max(100).optional().default(''),
  leadInvestors: z.string().max(1000).optional().default(''),
});

export const syncRequestSchema = z.object({
  startups: z.array(syncStartupSchema).min(1).max(5000),
});
