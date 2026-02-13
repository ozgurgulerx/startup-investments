/**
 * Brief snapshot validation — non-blocking checks for generation completeness.
 *
 * All checks log warnings; none block generation.
 */

import type { BriefSnapshot, BuilderActionRef } from './brief';

const VALID_REF_PREFIXES = ['/news', '/signals', '/company', '/dealbook'];
const VALID_STATUSES = ['draft', 'ready', 'sealed'];

export function validateBriefSnapshot(
  snapshot: BriefSnapshot,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // metrics exists and has valid numbers
  if (!snapshot.metrics) {
    errors.push('metrics is missing');
  } else {
    if (typeof snapshot.metrics.totalFunding !== 'number' || snapshot.metrics.totalFunding < 0) {
      errors.push('metrics.totalFunding must be >= 0');
    }
    if (typeof snapshot.metrics.dealCount !== 'number' || snapshot.metrics.dealCount < 0) {
      errors.push('metrics.dealCount must be >= 0');
    }
  }

  // topSignals length > 0 (warn, not error — empty periods are legitimate)
  if (!Array.isArray(snapshot.topSignals) || snapshot.topSignals.length === 0) {
    errors.push('warning: topSignals is empty');
  }

  // builderActions length 0–5 (warn if 0)
  if (!Array.isArray(snapshot.builderActions)) {
    errors.push('builderActions is not an array');
  } else {
    if (snapshot.builderActions.length === 0) {
      errors.push('warning: builderActions is empty');
    }
    if (snapshot.builderActions.length > 5) {
      errors.push(`builderActions has ${snapshot.builderActions.length} items (max 5)`);
    }
    // Validate each ref URL
    for (const action of snapshot.builderActions) {
      if (Array.isArray(action.refs)) {
        for (const ref of action.refs as BuilderActionRef[]) {
          if (!ref.url || !VALID_REF_PREFIXES.some((p) => ref.url.startsWith(p))) {
            errors.push(`invalid BuilderActionRef URL: "${ref.url}"`);
          }
        }
      }
    }
  }

  // executiveSummary non-empty
  if (typeof snapshot.executiveSummary !== 'string' || snapshot.executiveSummary.trim() === '') {
    errors.push('executiveSummary is empty');
  }

  // methodology.bullets length > 0
  if (!snapshot.methodology || !Array.isArray(snapshot.methodology.bullets) || snapshot.methodology.bullets.length === 0) {
    errors.push('methodology.bullets is empty');
  }

  // patternLandscape is an array
  if (!Array.isArray(snapshot.patternLandscape)) {
    errors.push('patternLandscape is not an array');
  }

  // verticalLandscape exists and has expected arrays
  if (
    !snapshot.verticalLandscape ||
    !Array.isArray(snapshot.verticalLandscape.topVerticals) ||
    !Array.isArray(snapshot.verticalLandscape.topSubVerticals)
  ) {
    errors.push('verticalLandscape is invalid');
  }

  // topDeals is an array
  if (!Array.isArray(snapshot.topDeals)) {
    errors.push('topDeals is not an array');
  }

  // status is valid
  if (!VALID_STATUSES.includes(snapshot.status)) {
    errors.push(`invalid status: "${snapshot.status}"`);
  }

  // "valid" means no hard errors — warnings (prefixed with "warning:") don't fail
  const hardErrors = errors.filter((e) => !e.startsWith('warning:'));
  return { valid: hardErrors.length === 0, errors };
}
