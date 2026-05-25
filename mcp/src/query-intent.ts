/**
 * Query Intent Detection for gordo-ledger
 * S345: Dynamic boost adjustment based on query content type intent
 *
 * Detects what kind of content the user is likely looking for and returns
 * adjusted boost multipliers to improve retrieval precision without
 * regressing other query types.
 *
 * Intent types:
 * - code: Looking for code files, functions, classes, implementations
 * - session: Looking for session history, what happened when
 * - decision: Looking for ratified decisions, closes, agreements
 * - issue: Looking for issue discussions, bugs, features
 * - memory: Looking for behavioral guidance, preferences, patterns
 * - general: No specific intent detected, use default boosts
 */

export interface QueryIntent {
  type: 'code' | 'session' | 'decision' | 'issue' | 'memory' | 'general';
  confidence: number;  // 0-1 how confident we are
  signals: string[];   // Which patterns matched
}

export interface DynamicBoosts {
  conversation: number;
  memory: number;
  session: number;
  issue: number;
  commit: number;
  docs: number;
  code: number;
}

// Default boosts (copied from memory-manager-v2 for reference)
const DEFAULT_BOOSTS: DynamicBoosts = {
  conversation: 2.5,
  memory: 2.0,
  session: 2.0,
  issue: 1.5,
  commit: 1.2,
  docs: 1.0,
  code: 1.0,
};

// Code intent patterns
const CODE_PATTERNS = {
  // CamelCase identifiers (function/class names)
  camelCase: /\b[a-z]+[A-Z][a-zA-Z]*\b/,
  // PascalCase identifiers (class names)
  pascalCase: /\b[A-Z][a-z]+[A-Z][a-zA-Z]*\b/,
  // snake_case identifiers
  snakeCase: /\b[a-z]+_[a-z_]+\b/,
  // File extensions
  fileExt: /\.\w{2,4}\b/,
  // Code-related keywords
  keywords: /\b(function|class|method|implement|interface|type|const|variable|parameter|return|module|import|export|api|endpoint|handler)\b/i,
  // Path-like patterns
  filePath: /\b[\w-]+\/[\w-]+/,
  // Explicit code request
  explicit: /\b(code|source|implementation|definition|where is .+ defined|how is .+ implemented)\b/i,
};

// Session intent patterns
const SESSION_PATTERNS = {
  // Session numbers: S123, session 45
  sessionNum: /\b(?:S|session\s*)(\d+)\b/i,
  // Date references
  dateRef: /\b(yesterday|today|last (?:session|week|month)|this (?:week|month))\b/i,
  // Session-related keywords
  keywords: /\b(session|happened|did we|when did|what did|discussed|worked on)\b/i,
  // Explicit session request
  explicit: /\b(in session|during session|session where|which session)\b/i,
};

// Decision intent patterns
const DECISION_PATTERNS = {
  // High-confidence: project-specific decision terms
  tierRef: /\btier\s*[0-3]\b/i,
  wwgdRef: /\bwwgd\b/i,
  // Decision keywords
  keywords: /\b(decided|ratified|closed|agreed|consensus|bilateral|constitutional)\b/i,
  // Record references
  recordRef: /\b(record-\d+|record \d+|ratification|seal)\b/i,
  // Process keywords
  process: /\b(deliberation|disposition|close|resolution)\b/i,
};

// Issue intent patterns
const ISSUE_PATTERNS = {
  // Issue numbers
  issueNum: /#\d+\b/,
  // Issue keywords (handle plurals with s?)
  keywords: /\b(issues?|bugs?|features?|tickets?|milestones?|blocked|gap-fill|idea-raw)\b/i,
  // Status keywords
  status: /\b(open|closed|resolved|wontfix|duplicate)\b/i,
};

// Memory intent patterns
const MEMORY_PATTERNS = {
  // Memory keywords
  keywords: /\b(remember|preference|feedback|discipline|pattern|convention|rule|should|shouldn't|always|never)\b/i,
  // Behavioral patterns
  behavioral: /\b(bias|avoid|don't|prefer|default to|when I|how to)\b/i,
  // Reference to memory system
  explicit: /\b(memory|auto-memory|feedback memory|project memory)\b/i,
};

function countMatches(query: string, patterns: Record<string, RegExp>): { count: number; signals: string[] } {
  let count = 0;
  const signals: string[] = [];

  for (const [name, pattern] of Object.entries(patterns)) {
    // Create global version of pattern to count all matches
    const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
    const matches = query.match(globalPattern);

    if (matches && matches.length > 0) {
      // For patterns with alternations (multiple keywords), count each unique match
      const uniqueMatches = new Set(matches.map(m => m.toLowerCase()));
      count += uniqueMatches.size;
      signals.push(name);
    }
  }

  return { count, signals };
}

/**
 * Detect query intent for content type boosting
 */
export function detectQueryIntent(query: string): QueryIntent {
  const codeMatches = countMatches(query, CODE_PATTERNS);
  const sessionMatches = countMatches(query, SESSION_PATTERNS);
  const decisionMatches = countMatches(query, DECISION_PATTERNS);
  const issueMatches = countMatches(query, ISSUE_PATTERNS);
  const memoryMatches = countMatches(query, MEMORY_PATTERNS);

  // Find highest scoring intent
  const scores = [
    { type: 'code' as const, count: codeMatches.count, signals: codeMatches.signals },
    { type: 'session' as const, count: sessionMatches.count, signals: sessionMatches.signals },
    { type: 'decision' as const, count: decisionMatches.count, signals: decisionMatches.signals },
    { type: 'issue' as const, count: issueMatches.count, signals: issueMatches.signals },
    { type: 'memory' as const, count: memoryMatches.count, signals: memoryMatches.signals },
  ];

  scores.sort((a, b) => b.count - a.count);
  const best = scores[0];

  // High-confidence single signals that can trigger intent on their own
  // These are distinctive enough to indicate intent without additional context
  const highConfidenceSingles = new Set([
    'explicit',      // Explicit requests ("show me the code", "in session", etc.)
    'sessionNum',    // S123, session 45
    'issueNum',      // #123
    'recordRef',     // record-034
    'tierRef',       // Tier 0, Tier 1, etc.
    'wwgdRef',       // WWGD grants
    'camelCase',     // findSimilar, getSession
    'pascalCase',    // MemoryManager, HNSWConfig
    'snakeCase',     // compute_hash, bm25_index
    'fileExt',       // .ts, .py
    'filePath',      // src/parser, mcp/src
    'dateRef',       // yesterday, last session
  ]);

  const hasHighConfidenceSignal = best.signals.some(s => highConfidenceSingles.has(s));

  // Trigger intent if:
  // - 2+ signals of any type, OR
  // - 1 high-confidence signal
  if (best.count >= 2 || (best.count === 1 && hasHighConfidenceSignal)) {
    // Confidence scales with signal count
    // High-confidence singles get 0.5, 2 signals get 0.66, 3+ get 1.0
    const baseConfidence = hasHighConfidenceSignal && best.count === 1 ? 0.5 : Math.min(best.count / 3, 1.0);
    return {
      type: best.type,
      confidence: baseConfidence,
      signals: best.signals,
    };
  }

  return {
    type: 'general',
    confidence: 1.0,
    signals: [],
  };
}

/**
 * Get dynamic boost multipliers based on query intent
 * Returns adjusted boosts that emphasize the relevant content type
 * while not completely zeroing out others (to allow cross-category discovery)
 */
export function getDynamicBoosts(intent: QueryIntent): DynamicBoosts {
  if (intent.type === 'general' || intent.confidence < 0.3) {
    return { ...DEFAULT_BOOSTS };
  }

  // Base all adjustments on defaults, then modify
  const boosts = { ...DEFAULT_BOOSTS };

  switch (intent.type) {
    case 'code':
      // Boost code significantly, reduce session/conversation
      boosts.code = 3.0;
      boosts.docs = 1.5;      // Docs often explain code
      boosts.conversation = 1.5;
      boosts.session = 1.2;
      boosts.issue = 1.0;
      boosts.memory = 0.8;
      boosts.commit = 1.5;    // Commits mention code changes
      break;

    case 'session':
      // Boost session and conversation
      boosts.session = 3.0;
      boosts.conversation = 3.0;
      boosts.commit = 1.5;    // Commits have session references
      boosts.memory = 1.5;    // Memory often references sessions
      boosts.code = 0.5;
      boosts.docs = 0.8;
      break;

    case 'decision':
      // Boost decision-related content
      boosts.session = 2.5;   // Decisions live in session logs
      boosts.memory = 2.5;    // Decisions become memory
      boosts.commit = 2.0;    // Ratification commits
      boosts.conversation = 2.0;
      boosts.docs = 1.5;      // Constitutional docs
      boosts.issue = 1.5;     // Issues track decisions
      boosts.code = 0.3;      // Code rarely relevant to decisions
      break;

    case 'issue':
      // Boost issue-related content
      boosts.issue = 3.0;
      boosts.session = 1.5;   // Sessions reference issues
      boosts.commit = 1.5;    // Commits close issues
      boosts.code = 0.5;
      break;

    case 'memory':
      // Boost memory and behavioral content
      boosts.memory = 3.0;
      boosts.session = 2.0;   // Memory comes from sessions
      boosts.conversation = 2.0;
      boosts.docs = 1.5;      // CLAUDE.md etc
      boosts.code = 0.3;
      break;
  }

  return boosts;
}

/**
 * Apply intent-based boost adjustment to search results
 * Used post-search to re-score based on detected intent
 */
export function applyIntentBoosts(
  results: Array<{ similarity: number; contentType?: string }>,
  intent: QueryIntent
): void {
  const boosts = getDynamicBoosts(intent);

  for (const result of results) {
    const contentType = result.contentType as keyof DynamicBoosts;
    const boost = boosts[contentType] ?? 1.0;
    result.similarity = Math.min(result.similarity * boost, 1.0);
  }
}
