import { z } from 'zod';

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
