// Central copy configuration for Build Atlas.
// Investor-first messaging is enabled by default and can be rolled back with:
// NEXT_PUBLIC_INVESTOR_COPY_IA_V1=false

export type Audience = 'builders' | 'investors';

export const INVESTOR_COPY_IA_V1_ENABLED =
  process.env.NEXT_PUBLIC_INVESTOR_COPY_IA_V1 !== 'false';

export const CANONICAL_LABELS = {
  brand: 'Build Atlas',
  dossiers: 'Dossiers',
  signals: 'Signals',
  signalFeed: 'Signal Feed',
  brief: 'Brief',
  capital: 'Capital',
  investors: 'Investors',
  watchlist: 'Watchlist',
  deepDives: 'Deep Dives',
  researchTools: 'Research Tools',
  benchmarks: 'Benchmarks',
  landscapes: 'Landscapes',
} as const;

export const ROUTE_MESSAGING = {
  home: {
    label: 'Home',
    headline: 'Move from startup noise to underwriting-ready conviction.',
    subhead:
      'Build Atlas turns funded AI companies into evidence-backed dossiers, then connects those dossiers to live pattern and capital signals.',
    primaryAction: { label: 'Explore Dossiers', href: '/dealbook' },
    secondaryAction: { label: 'See Live Signals', href: '/news' },
  },
  dealbook: {
    label: CANONICAL_LABELS.dossiers,
    headline: 'Find companies that match your conviction criteria.',
    subhead:
      'Filter by stage, pattern, and market context to compare companies on moat, execution, and momentum.',
    primaryAction: { label: 'Open Dossiers', href: '/dealbook' },
  },
  signals: {
    label: CANONICAL_LABELS.signals,
    headline: 'Track pattern momentum before it shows up in consensus.',
    subhead:
      'See cross-company shifts in architecture, GTM, and capital behavior that can change underwriting assumptions.',
    primaryAction: { label: 'Open Signals', href: '/signals' },
  },
  watchlist: {
    label: CANONICAL_LABELS.watchlist,
    headline: 'Monitor the companies and signals that matter to your thesis.',
    subhead:
      'Track alerts, follow signal changes, and keep diligence priorities in one place.',
    primaryAction: { label: 'Open Watchlist', href: '/watchlist' },
  },
  signalFeed: {
    label: CANONICAL_LABELS.signalFeed,
    headline: 'Follow high-signal startup developments as they happen.',
    subhead:
      'Live updates are ranked by impact, corroboration, and trust so you can triage what matters faster.',
    primaryAction: { label: 'Open Signal Feed', href: '/news' },
  },
} as const;

export const COPY = {
  investors: {
    heroHeadline: 'Underwrite faster with evidence-backed startup conviction.',
    heroSubhead:
      'Build Atlas unifies company dossiers, live pattern signals, and capital context so investors can move from first look to defensible decision in minutes.',
    heroBullets: [
      'Compare funded AI companies on moat, execution, and momentum',
      'Validate claims with corroborated signals and source traceability',
      'Track pattern shifts and risk changes across your watch universe',
    ],
    primaryCTA: 'Explore Dossiers',
    primaryCTAHref: '/dealbook',
    secondaryCTA: 'See Live Signals',
    secondaryCTAHref: '/news',
    heroSearchPlaceholder: 'Search companies, theses, and patterns...',
  },
  builders: {
    heroHeadline: 'See how funded AI startups earn and defend advantage.',
    heroSubhead:
      'Build Atlas breaks companies into wedge, moat, execution, and momentum so teams can learn what works before scaling the wrong bets.',
    heroBullets: [
      'Study GTM and moat tradeoffs with real company comparables',
      'Benchmark architecture and product choices by funding stage',
      'Follow emerging patterns that influence category direction',
    ],
    primaryCTA: 'Explore Dossiers',
    primaryCTAHref: '/dealbook',
    secondaryCTA: 'See Live Signals',
    secondaryCTAHref: '/news',
    heroSearchPlaceholder: 'Search companies, theses, and patterns...',
  },
} as const;

export const SUPPORTING_LINE =
  'From first look to conviction: dossiers, signal momentum, and capital context in one investor workflow.';

export type MetricsData = {
  companies: { value: string; label: string; shortLabel: string; description: string };
  capital: { value: string; label: string; shortLabel: string; description: string };
  genai: { value: string; label: string; shortLabel: string; description: string };
  patterns: { value: string; label: string; shortLabel: string; description: string };
};

export const METRICS: MetricsData = {
  companies: {
    value: '301',
    label: 'Funded companies tracked',
    shortLabel: 'Companies tracked',
    description: 'AI startups mapped in the current data window',
  },
  capital: {
    value: '$32.2B',
    label: 'Capital mapped',
    shortLabel: 'Capital mapped',
    description: 'Funding represented across tracked companies',
  },
  genai: {
    value: '56%',
    label: 'GenAI adoption',
    shortLabel: 'GenAI adoption',
    description: 'Share of tracked companies building on GenAI',
  },
  patterns: {
    value: '6',
    label: 'Patterns detected',
    shortLabel: 'Patterns detected',
    description: 'Recurring architecture and GTM patterns detected',
  },
};

// Backward-compatible alias kept for existing imports.
export const TERMINOLOGY = {
  brand: CANONICAL_LABELS.brand,
  dossiers: CANONICAL_LABELS.dossiers,
  brief: CANONICAL_LABELS.brief,
  signals: CANONICAL_LABELS.signals,
  capital: CANONICAL_LABELS.capital,
  library: CANONICAL_LABELS.deepDives,
  watchlist: CANONICAL_LABELS.watchlist,
} as const;

export type NavItemConfig = {
  label: string;
  href: string;
  requiresAuth?: boolean;
  regionAware?: boolean;
  group?: 'primary' | 'secondary';
};

export const NAV_ITEMS: NavItemConfig[] = [
  { label: CANONICAL_LABELS.dossiers, href: '/dealbook', regionAware: true, group: 'primary' },
  { label: CANONICAL_LABELS.signals, href: '/signals', regionAware: true, group: 'primary' },
  { label: CANONICAL_LABELS.brief, href: '/brief', regionAware: true, group: 'primary' },
  { label: CANONICAL_LABELS.capital, href: '/capital', regionAware: true, group: 'primary' },
  { label: CANONICAL_LABELS.investors, href: '/investors', regionAware: true, group: 'primary' },
  { label: CANONICAL_LABELS.watchlist, href: '/watchlist', requiresAuth: true, group: 'primary' },
  { label: CANONICAL_LABELS.deepDives, href: '/library', group: 'primary' },
  { label: CANONICAL_LABELS.benchmarks, href: '/benchmarks', regionAware: true, group: 'secondary' },
  { label: CANONICAL_LABELS.landscapes, href: '/landscapes', regionAware: true, group: 'secondary' },
];

export const PRIMARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.group !== 'secondary');
export const SECONDARY_NAV_ITEMS = NAV_ITEMS.filter((item) => item.group === 'secondary');

export const SIGN_IN_COPY = {
  title: 'Sign in to personalize',
  subtitle: 'Save watchlists, alerts, and diligence paths',
  body: 'Create watchlists, save filters, and follow the signals relevant to your investment thesis. Browsing remains open.',
  primaryCTA: 'Sign in',
  secondaryCTA: 'Continue browsing',
} as const;

export const FAQ_ITEMS = [
  {
    question: 'How often is Build Atlas updated?',
    answer:
      'The pipeline ingests and ranks signal updates throughout the day, with dossier and timeline updates reflected as new evidence lands.',
  },
  {
    question: 'What companies are included?',
    answer:
      'Build Atlas focuses on funded AI and AI-adjacent startups across Seed to Series D+ with enough evidence to support comparison-level analysis.',
  },
  {
    question: 'How should investors use Signals vs Dossiers?',
    answer:
      'Use Signals to detect cross-company momentum shifts, then open Dossiers to validate company-level moat, execution, and underwriting implications.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'No. Core exploration is open. An account enables watchlists, saved filters, and personalized tracking.',
  },
] as const;
