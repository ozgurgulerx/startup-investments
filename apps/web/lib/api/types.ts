// Shared API response types that are safe to import from Client Components.
//
// IMPORTANT:
// - Do not import runtime code from `@/lib/api/client` here.
// - `@/lib/api/client` is server-only (it carries API key logic).

export interface StageAdoption {
  adopters: number;
  total: number;
  pct: number;
}

export interface StageContext {
  adoption_by_stage: Record<string, StageAdoption>;
  stage_acceleration: string | null;
  computed_at: string;
}

export interface SignalExplain {
  definition: string;
  why: string;
  examples: string[];
  risk: string;
  time_horizon: string;
  top_evidence: Array<{
    snippet: string;
    source: string;
    date: string;
    url?: string;
  }>;
}

export interface SignalItem {
  id: string;
  domain: string;
  cluster_name: string | null;
  claim: string;
  region: string;
  conviction: number;
  momentum: number;
  impact: number;
  adoption_velocity: number;
  status: 'candidate' | 'emerging' | 'accelerating' | 'established' | 'decaying';
  evidence_count: number;
  unique_company_count: number;
  first_seen_at: string;
  last_evidence_at: string | null;
  stage_context?: StageContext;
  explain?: SignalExplain;
  explain_generated_at?: string;
  evidence_timeline?: number[];
  evidence_timeline_meta?: {
    bin_count: number;
    timeline_start: string;
    timeline_end: string;
  };
  confidence_score?: number;
  freshness_score?: number;
  evidence_diversity_score?: number;
  reason_short?: string;
  linked_story_count?: number;
  top_story_ids?: string[];
  claim_structured?: {
    what_changed?: string;
    vs_previous_window?: string;
    why_now?: string;
  };
}

export interface SignalsSummaryResponse {
  rising: SignalItem[];
  established: SignalItem[];
  decaying: SignalItem[];
  stats: {
    total: number;
    by_status: Record<string, number>;
    by_domain: Record<string, number>;
  };
  last_pipeline_run_at?: string | null;
  stale?: boolean;
  stale_reason?: string | null;
}

export interface SignalsListResponse {
  signals: SignalItem[];
  total: number;
}

export interface DeepDiveContent {
  tldr: string;
  mechanism: string;
  patterns: Array<{ archetype: string; description: string; startups: string[] }>;
  case_studies: Array<{
    startup_slug: string;
    startup_name: string;
    summary: string;
    key_moves: string[];
  }>;
  thresholds: Array<{ metric: string; value: string; action: string }>;
  failure_modes: Array<{ mode: string; description: string; example: string | null }>;
  watchlist: Array<{ startup_slug: string; why: string }>;
}

export interface DeepDiveResponse {
  deep_dive: {
    id: string;
    signal_id: string;
    version: number;
    status: string;
    content_json: DeepDiveContent;
    sample_startup_ids: string[];
    sample_count: number;
    generation_model: string | null;
    generation_cost_tokens: number | null;
    evidence_hash: string | null;
    created_at: string;
  } | null;
  signal: SignalItem | null;
  diff: {
    from_version: number;
    to_version: number;
    diff_json: Record<string, any>;
    created_at: string;
  } | null;
  meta?: {
    schema_missing: boolean;
    unlinked_evidence_count: number;
    startups_with_evidence: number;
    startups_eligible: number;
    occurrences_total: number;
    latest_status: string | null;
    latest_version: number | null;
    latest_created_at: string | null;
  } | null;
}

export interface OccurrenceItem {
  id: string;
  signal_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string;
  funding_stage: string | null;
  score: number;
  features_json: Record<string, any>;
  explain_json: Record<string, any>;
  evidence_count: number;
  computed_at: string;
}

export interface MoveItem {
  id: string;
  signal_id: string;
  startup_id: string;
  startup_name: string;
  startup_slug: string;
  move_type: string;
  what_happened: string;
  why_it_worked: string | null;
  unique_angle: string | null;
  timestamp_hint: string | null;
  evidence_ids: string[];
  confidence: number;
  extracted_at: string;
}

export interface DeltaEvent {
  id: string;
  startup_id: string | null;
  startup_name: string | null;
  startup_slug: string | null;
  signal_id: string | null;
  delta_type: string;
  domain: string;
  region: string;
  old_value: string | null;
  new_value: string | null;
  magnitude: number | null;
  direction: string | null;
  headline: string;
  detail: string | null;
  evidence_json: Record<string, any>;
  period: string | null;
  effective_at: string;
}

export interface MoversSummaryResponse {
  top_movers: DeltaEvent[];
  by_type: Record<string, number>;
  total: number;
}

export interface DeltaFeedResponse {
  events: DeltaEvent[];
  total: number;
}
