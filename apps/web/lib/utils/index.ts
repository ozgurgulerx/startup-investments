import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, compact = false): string {
  if (compact) {
    if (value >= 1_000_000_000) {
      return `$${(value / 1_000_000_000).toFixed(1)}B`;
    }
    if (value >= 1_000_000) {
      return `$${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `$${(value / 1_000).toFixed(0)}K`;
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number, compact = false): string {
  if (compact) {
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}K`;
    }
  }
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatPercentage(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function getPatternColor(pattern: string): string {
  const colors: Record<string, string> = {
    'Agentic Architectures': 'pattern-agentic',
    'Vertical Data Moats': 'pattern-vertical-data',
    'RAG (Retrieval-Augmented Generation)': 'pattern-rag',
    'Micro-model Meshes': 'pattern-micro-model',
    'Continuous-learning Flywheels': 'pattern-flywheel',
    'Guardrail-as-LLM': 'pattern-guardrail',
  };
  return colors[pattern] || 'bg-muted text-muted-foreground';
}

export function getStageColor(stage: string): string {
  const normalized = stage.toLowerCase().replace(/[^a-z]/g, '');
  const colors: Record<string, string> = {
    seed: 'stage-seed',
    preseed: 'stage-seed',
    seriesa: 'stage-series-a',
    seriesb: 'stage-series-b',
    seriesc: 'stage-series-c',
    seriesd: 'stage-series-d',
    seriese: 'stage-series-d',
  };
  return colors[normalized] || 'bg-muted text-muted-foreground';
}

export function calculateChange(current: number, previous: number): {
  value: number;
  direction: 'up' | 'down' | 'neutral';
  formatted: string;
} {
  if (previous === 0) {
    return { value: 0, direction: 'neutral', formatted: 'N/A' };
  }
  const change = ((current - previous) / previous) * 100;
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';
  const formatted = `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
  return { value: change, direction, formatted };
}
