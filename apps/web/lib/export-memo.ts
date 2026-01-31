/**
 * Export watchlist as markdown memo
 */

import type { StartupAnalysis } from '@startup-intelligence/shared';
import { formatCurrency } from './utils';

export interface ExportMemoOptions {
  includePatterns?: boolean;
  includeFunding?: boolean;
  includeDescription?: boolean;
}

export function generateWatchlistMemo(
  startups: StartupAnalysis[],
  options: ExportMemoOptions = {}
): string {
  const {
    includePatterns = true,
    includeFunding = true,
    includeDescription = true,
  } = options;

  const lines: string[] = [];
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Header
  lines.push('# Watchlist Export');
  lines.push('');
  lines.push(`*Generated: ${now}*`);
  lines.push('');
  lines.push(`**${startups.length} companies tracked**`);
  lines.push('');

  // Summary stats
  const totalFunding = startups.reduce((sum, s) => sum + (s.funding_amount || 0), 0);
  const genaiCount = startups.filter(s => s.uses_genai).length;

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total funding tracked: ${formatCurrency(totalFunding, true)}`);
  lines.push(`- GenAI companies: ${genaiCount} (${((genaiCount / startups.length) * 100).toFixed(0)}%)`);
  lines.push('');

  // Company list
  lines.push('## Companies');
  lines.push('');

  for (const startup of startups) {
    lines.push(`### ${startup.company_name}`);
    lines.push('');

    if (startup.website) {
      lines.push(`**Website:** [${startup.website}](${startup.website})`);
      lines.push('');
    }

    if (includeFunding && startup.funding_amount) {
      const stage = startup.funding_stage?.replace(/_/g, ' ') || 'Unknown stage';
      lines.push(`**Funding:** ${formatCurrency(startup.funding_amount, true)} (${stage})`);
      lines.push('');
    }

    if (includeDescription && startup.description) {
      lines.push(`**Description:** ${startup.description}`);
      lines.push('');
    }

    if (includePatterns && startup.build_patterns && startup.build_patterns.length > 0) {
      const patterns = startup.build_patterns.map(p => p.name).join(', ');
      lines.push(`**Patterns:** ${patterns}`);
      lines.push('');
    }

    if (startup.uses_genai) {
      lines.push('*Uses Generative AI*');
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  // Footer
  lines.push('');
  lines.push('*Exported from Build Atlas*');

  return lines.join('\n');
}

export function downloadMemo(content: string, filename = 'watchlist-export.md'): void {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
