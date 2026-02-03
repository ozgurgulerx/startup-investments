// Central copy configuration for Build Atlas
// Supports two audience modes: builders (default) and investors

export type Audience = 'builders' | 'investors';

export const COPY = {
  builders: {
    heroHeadline: "How AI startups really win.",
    heroSubhead:
      "Build Atlas turns funded AI companies into decision-grade dossiers: product wedge, moat, execution, and category momentum—so builders can learn and investors can underwrite faster.",
    heroBullets: [
      "Diligence-ready breakdowns in minutes, not weeks",
      "Moat + GTM clarity, not vibes",
      "Comparable rounds, peers, and what to watch next"
    ],
    primaryCTA: "Browse dossiers",
    primaryCTAHref: "/dealbook",
    secondaryCTA: "Sign in to personalize",
    secondaryCTAHref: "/login",
  },
  investors: {
    heroHeadline: "Less narrative. More signal.",
    heroSubhead:
      "Build Atlas converts AI startup noise into structured signal: moat mechanics, distribution truth, and momentum indicators across every funded company we track.",
    heroBullets: [
      "Separate durable moats from demo theater",
      "Identify infra/platform timing shifts before the crowd",
      "Track who's compounding—by pattern, not hype"
    ],
    primaryCTA: "Browse deal flow",
    primaryCTAHref: "/dealbook",
    secondaryCTA: "Sign in to personalize",
    secondaryCTAHref: "/login",
  },
} as const;

export const SUPPORTING_LINE =
  "Decision-grade dossiers across: Wedge, Moat, Execution, and Momentum—grounded in architecture, data advantage, and GTM.";

// Standardized metrics labels
// NOTE: Values are updated automatically by the sync-to-database workflow
// from monthly_stats.json. Do not edit manually.
export const METRICS = {
  companies: {
    value: "293",
    label: "Funded companies tracked",
    shortLabel: "Companies tracked",
    description: "AI startups that raised funding this month",
  },
  capital: {
    value: "$32.1B",
    label: "Capital mapped",
    shortLabel: "Capital mapped",
    description: "Total funding raised across all tracked deals",
  },
  genai: {
    value: "56%",
    label: "GenAI adoption",
    shortLabel: "GenAI adoption",
    description: "Share of startups building on generative AI",
  },
  patterns: {
    value: "6",
    label: "Build patterns detected",
    shortLabel: "Patterns detected",
    description: "Distinct architecture patterns identified",
  },
} as const;

// Canonical terminology for site-wide consistency
export const TERMINOLOGY = {
  brand: "Build Atlas",
  dossiers: "Dossiers",        // company pages / company intel pages
  brief: "Brief",              // monthly landscape summary
  signals: "Signals",          // build patterns / insights
  capital: "Capital",          // capital & momentum trends
  library: "Library",          // archive of past briefs
  watchlist: "Watchlist",      // saved companies (requires login)
} as const;

// Navigation items (canonical)
export const NAV_ITEMS = [
  { label: 'Brief', href: '/brief' },
  { label: 'Dossiers', href: '/dealbook' },
  { label: 'Signals', href: '/signals' },
  { label: 'Capital', href: '/capital' },
  { label: 'Library', href: '/library' },
  { label: 'Watchlist', href: '/watchlist', requiresAuth: true },
] as const;

// Sign-in messaging (no Pro/gated language)
export const SIGN_IN_COPY = {
  title: "Sign in to personalize",
  subtitle: "Access dossiers, filters, and exports",
  body: "Create watchlists, save filters, and get a tailored feed. All content remains free — signing in just unlocks personal features.",
  primaryCTA: "Sign in",
  secondaryCTA: "Continue browsing",
} as const;

// FAQ items (no Pro/pricing language)
export const FAQ_ITEMS = [
  {
    question: "How often is Build Atlas updated?",
    answer: "We publish a new Brief by the 5th of each month covering the previous month. Company dossiers are refreshed continuously as new information surfaces."
  },
  {
    question: "What funding stages do you cover?",
    answer: "Seed through Series D, with a focus on AI and AI-adjacent companies. We include deals $1M+ to maintain signal quality."
  },
  {
    question: "How are architecture signals detected?",
    answer: "Our system analyzes company websites, documentation, job postings, and technical content to identify stack choices and architecture patterns. Each signal includes a confidence score."
  },
  {
    question: "Do I need an account?",
    answer: "No. Browsing is open. An account only enables watchlists, saved filters, and personalized recommendations."
  },
  {
    question: "Can I export the data?",
    answer: "Yes, dossiers can be exported to CSV and briefs can be downloaded as PDF."
  },
] as const;
