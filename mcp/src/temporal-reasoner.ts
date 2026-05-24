/**
 * Temporal Reasoning Layer for gordo-ledger
 *
 * Detects temporal intent in queries and applies temporal logic to search results.
 * Helps answer questions like:
 * - "When did X first happen?" → sort by date ascending, return earliest match
 * - "What was the most recent Y?" → sort by date descending, return latest
 * - "What happened before/after Z?" → filter by date relative to anchor
 */

import type { SearchResult } from './types.js';

export interface TemporalIntent {
  type: 'first' | 'last' | 'before' | 'after' | 'during' | 'sequence' | 'none';
  anchor?: string;  // Reference date or event for relative queries
  sortOrder: 'asc' | 'desc' | 'relevance';  // How to order results
  boostRecent?: boolean;  // Boost more recent results
  boostOld?: boolean;     // Boost older results
}

// Patterns that indicate temporal intent
const TEMPORAL_PATTERNS = {
  first: [
    /\bfirst\b/i,
    /\bearliest\b/i,
    /\binitial(?:ly)?\b/i,
    /\borigin(?:al|ally)?\b/i,
    /\bstart(?:ed|ing)?\b/i,
    /\bbegan\b/i,
    /\bbeginning\b/i,
    /\bwhen did .+ (?:start|begin|first)/i,
  ],
  last: [
    /\blast\b/i,
    /\blatest\b/i,
    /\bmost recent\b/i,
    /\brecent(?:ly)?\b/i,
    /\bcurrent(?:ly)?\b/i,
    /\bnow\b/i,
    /\btoday\b/i,
  ],
  before: [
    /\bbefore\b/i,
    /\bprior to\b/i,
    /\bpreceding\b/i,
    /\bearlier than\b/i,
    /\buntil\b/i,
  ],
  after: [
    /\bafter\b/i,
    /\bsince\b/i,
    /\bfollowing\b/i,
    /\blater than\b/i,
    /\bfrom .+ onwards\b/i,
  ],
  sequence: [
    /\bwhat .+ next\b/i,
    /\bpick up\b/i,
    /\bcontinue[ds]?\b/i,
    /\binterrupt(?:ed|ion)?\b/i,
    /\bleft incomplete\b/i,
    /\bcarry over\b/i,
    /\bhand(?:ed)? off\b/i,
  ],
};

// Patterns that indicate comparison questions (should NOT trigger temporal reasoning)
const COMPARISON_PATTERNS = [
  /\bbefore or after\b/i,
  /\bafter or before\b/i,
  /\bdid .+ (?:happen |occur |come )before\b/i,
  /\bwas .+ before or\b/i,
  /\bwhich (?:came|happened|occurred) (?:first|earlier|before)\b/i,
];

// Date-related words that might be anchors
const DATE_ANCHOR_PATTERNS = [
  /(?:in |during |around )?(january|february|march|april|may|june|july|august|september|october|november|december)\s*(?:\d{4})?/i,
  /(?:in |during |around )?(\d{4})/,
  /(?:in |during |around )?(q[1-4])\s*(?:\d{4})?/i,
  /session\s*(\d+)/i,
  /(s\d+)/i,
  /(yesterday|today|this week|last week|this month|last month)/i,
];

/**
 * Detect temporal intent in a query
 */
export function detectTemporalIntent(query: string): TemporalIntent {
  const lowerQuery = query.toLowerCase();

  // Skip temporal reasoning for comparison questions
  // These ask ABOUT temporal relationships, not FOR temporal filtering
  for (const pattern of COMPARISON_PATTERNS) {
    if (pattern.test(lowerQuery)) {
      return {
        type: 'none',
        sortOrder: 'relevance',
      };
    }
  }

  // Check for sequence queries (highest priority - specific workflow pattern)
  for (const pattern of TEMPORAL_PATTERNS.sequence) {
    if (pattern.test(lowerQuery)) {
      return {
        type: 'sequence',
        sortOrder: 'desc',  // Most recent first to find latest incomplete work
        boostRecent: true,
      };
    }
  }

  // Check for "first" patterns
  for (const pattern of TEMPORAL_PATTERNS.first) {
    if (pattern.test(lowerQuery)) {
      return {
        type: 'first',
        sortOrder: 'asc',
        boostOld: true,
      };
    }
  }

  // Check for "last/recent" patterns
  for (const pattern of TEMPORAL_PATTERNS.last) {
    if (pattern.test(lowerQuery)) {
      return {
        type: 'last',
        sortOrder: 'desc',
        boostRecent: true,
      };
    }
  }

  // Check for relative temporal queries
  for (const pattern of TEMPORAL_PATTERNS.before) {
    if (pattern.test(lowerQuery)) {
      const anchor = extractDateAnchor(query);
      return {
        type: 'before',
        anchor,
        sortOrder: 'desc',  // Most recent before anchor
      };
    }
  }

  for (const pattern of TEMPORAL_PATTERNS.after) {
    if (pattern.test(lowerQuery)) {
      const anchor = extractDateAnchor(query);
      return {
        type: 'after',
        anchor,
        sortOrder: 'asc',  // Earliest after anchor
      };
    }
  }

  // No temporal intent detected
  return {
    type: 'none',
    sortOrder: 'relevance',
  };
}

/**
 * Extract a date anchor from the query
 */
function extractDateAnchor(query: string): string | undefined {
  for (const pattern of DATE_ANCHOR_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      return match[1] || match[0];
    }
  }
  return undefined;
}

/**
 * Apply temporal reasoning to search results
 *
 * CONSERVATIVE APPROACH: Only apply gentle boosting to high-relevance results.
 * Don't reorder aggressively - trust the semantic ranking as primary signal.
 */
export function applyTemporalReasoning(
  results: SearchResult[],
  intent: TemporalIntent
): SearchResult[] {
  if (intent.type === 'none') {
    return results;  // No temporal modification
  }

  // Make a copy to avoid mutating input
  let processed = [...results];

  // For "first" queries, boost the earliest among high-relevance results
  // Don't resort - just boost
  if (intent.type === 'first') {
    processed = boostEarliestRelevant(processed);
  }

  // For "last" queries, boost the latest among high-relevance results
  if (intent.type === 'last') {
    processed = boostLatestRelevant(processed);
  }

  // For sequence queries, boost results with handoff/incomplete markers
  if (intent.type === 'sequence') {
    processed = boostSequenceMarkers(processed);
  }

  // Re-sort by boosted similarity and assign ranks
  processed.sort((a, b) => b.similarity - a.similarity);
  processed = processed.map((r, i) => ({ ...r, rank: i + 1 }));

  return processed;
}

/**
 * Compare ISO date strings
 */
function compareDates(a: string, b: string): number {
  const dateA = new Date(a || '1970-01-01');
  const dateB = new Date(b || '1970-01-01');
  return dateA.getTime() - dateB.getTime();
}

/**
 * Apply temporal boost factor to scores
 */
function applyTemporalBoost(
  results: SearchResult[],
  intent: TemporalIntent
): SearchResult[] {
  if (results.length === 0) return results;

  // Find date range
  const dates = results.map(r => new Date(r.date || '1970-01-01').getTime());
  const minDate = Math.min(...dates);
  const maxDate = Math.max(...dates);
  const range = maxDate - minDate || 1;  // Avoid division by zero

  return results.map(r => {
    const date = new Date(r.date || '1970-01-01').getTime();
    const position = (date - minDate) / range;  // 0 = oldest, 1 = newest

    let boost = 1.0;
    if (intent.boostRecent) {
      boost = 1.0 + (position * 0.3);  // Up to 30% boost for recent
    } else if (intent.boostOld) {
      boost = 1.0 + ((1 - position) * 0.3);  // Up to 30% boost for old
    }

    return {
      ...r,
      similarity: Math.min(r.similarity * boost, 1.0),
    };
  });
}

/**
 * Boost the earliest result that has high relevance
 * Conservative: only boost if already high-relevance, small boost factor
 */
function boostEarliestRelevant(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results;

  // Find results with similarity > 0.6 (high relevance threshold)
  const relevant = results.filter(r => r.similarity > 0.6);
  if (relevant.length === 0) return results;

  // Sort relevant by date ascending
  relevant.sort((a, b) => compareDates(a.date, b.date));
  const earliest = relevant[0];

  // Gentle boost (15%) to earliest relevant - don't overwhelm semantic ranking
  return results
    .map(r => r.sessionId === earliest.sessionId
      ? { ...r, similarity: Math.min(r.similarity * 1.15, 1.0) }
      : r
    )
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Boost the latest result that has high relevance
 * Conservative: only boost if already high-relevance, small boost factor
 */
function boostLatestRelevant(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return results;

  // Find results with similarity > 0.6 (high relevance threshold)
  const relevant = results.filter(r => r.similarity > 0.6);
  if (relevant.length === 0) return results;

  // Sort relevant by date descending
  relevant.sort((a, b) => compareDates(b.date, a.date));
  const latest = relevant[0];

  // Gentle boost (15%) to latest relevant - don't overwhelm semantic ranking
  return results
    .map(r => r.sessionId === latest.sessionId
      ? { ...r, similarity: Math.min(r.similarity * 1.15, 1.0) }
      : r
    )
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Boost results that contain sequence/continuity markers
 */
function boostSequenceMarkers(results: SearchResult[]): SearchResult[] {
  const sequenceKeywords = [
    'next session',
    'pick up',
    'continue',
    'incomplete',
    'interrupted',
    'left off',
    'carry over',
    'handoff',
    'todo',
    'pending',
    'blocked',
    'waiting',
  ];

  return results.map(r => {
    const content = (r.content || '').toLowerCase();
    const summary = (r.summary || '').toLowerCase();
    const text = content + ' ' + summary;

    // Only boost if already reasonably relevant
    if (r.similarity < 0.4) return r;

    const markerCount = sequenceKeywords.filter(kw => text.includes(kw)).length;
    if (markerCount > 0) {
      // Conservative boost: 5% per marker, max 25%
      const boost = 1.0 + Math.min(markerCount * 0.05, 0.25);
      return { ...r, similarity: Math.min(r.similarity * boost, 1.0) };
    }
    return r;
  }).sort((a, b) => b.similarity - a.similarity);
}

/**
 * Check if temporal reasoning is available
 */
export function isTemporalReasoningAvailable(): boolean {
  return true;  // Always available, no external dependencies
}

/**
 * Get a description of the temporal intent for debugging/logging
 */
export function describeIntent(intent: TemporalIntent): string {
  switch (intent.type) {
    case 'first':
      return 'Looking for earliest/first occurrence';
    case 'last':
      return 'Looking for most recent occurrence';
    case 'before':
      return `Looking for events before ${intent.anchor || 'reference point'}`;
    case 'after':
      return `Looking for events after ${intent.anchor || 'reference point'}`;
    case 'sequence':
      return 'Looking for continuity/handoff between sessions';
    default:
      return 'No temporal reasoning applied';
  }
}
