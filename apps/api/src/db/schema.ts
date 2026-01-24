import { pgTable, uuid, varchar, text, integer, boolean, timestamp, date, bigint, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Startups table
export const startups = pgTable('startups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  website: varchar('website', { length: 500 }),
  foundedDate: date('founded_date'),
  headquartersCity: varchar('headquarters_city', { length: 100 }),
  headquartersCountry: varchar('headquarters_country', { length: 100 }),
  continent: varchar('continent', { length: 50 }),
  industry: varchar('industry', { length: 100 }),
  pattern: varchar('pattern', { length: 100 }),
  stage: varchar('stage', { length: 50 }),
  employeeCount: integer('employee_count'),
  genaiNative: boolean('genai_native').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Funding rounds table
export const fundingRounds = pgTable('funding_rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  startupId: uuid('startup_id').notNull().references(() => startups.id, { onDelete: 'cascade' }),
  roundType: varchar('round_type', { length: 50 }).notNull(),
  amountUsd: bigint('amount_usd', { mode: 'number' }),
  announcedDate: date('announced_date'),
  leadInvestor: varchar('lead_investor', { length: 255 }),
  valuationUsd: bigint('valuation_usd', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Investors table
export const investors = pgTable('investors', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  type: varchar('type', { length: 50 }),
  website: varchar('website', { length: 500 }),
  headquartersCountry: varchar('headquarters_country', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Investments junction table
export const investments = pgTable('investments', {
  id: uuid('id').primaryKey().defaultRandom(),
  fundingRoundId: uuid('funding_round_id').notNull().references(() => fundingRounds.id, { onDelete: 'cascade' }),
  investorId: uuid('investor_id').notNull().references(() => investors.id, { onDelete: 'cascade' }),
  isLead: boolean('is_lead').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueInvestment: uniqueIndex('unique_investment').on(table.fundingRoundId, table.investorId),
}));

// Newsletters table
export const newsletters = pgTable('newsletters', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 500 }).notNull(),
  content: text('content').notNull(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  status: varchar('status', { length: 20 }).default('draft'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Relations
export const startupsRelations = relations(startups, ({ many }) => ({
  fundingRounds: many(fundingRounds),
}));

export const fundingRoundsRelations = relations(fundingRounds, ({ one, many }) => ({
  startup: one(startups, {
    fields: [fundingRounds.startupId],
    references: [startups.id],
  }),
  investments: many(investments),
}));

export const investorsRelations = relations(investors, ({ many }) => ({
  investments: many(investments),
}));

export const investmentsRelations = relations(investments, ({ one }) => ({
  fundingRound: one(fundingRounds, {
    fields: [investments.fundingRoundId],
    references: [fundingRounds.id],
  }),
  investor: one(investors, {
    fields: [investments.investorId],
    references: [investors.id],
  }),
}));
