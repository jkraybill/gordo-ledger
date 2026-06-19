/**
 * Node Classifier - Routes documents to appropriate node types
 * Part of gordo-ledger MCP Server v1.0.0-rc16
 *
 * Implements the roundtable recommendation: deterministic pre-pass
 * to classify sources before LLM extraction. Artifacts are second-class;
 * only sessions get full relationship extraction.
 */

import { NodeType } from './types.js';

/**
 * Classification result
 */
export interface ClassificationResult {
  nodeType: NodeType;
  shouldExtractRelationships: boolean;  // Only true for Tier 1 deliberation sources
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

/**
 * Classify a document ID to determine its node type
 *
 * Rules (in priority order):
 * 1. Session_NNN → session (Tier 1, extract)
 * 2. issue-NNN → issue (Tier 1, extract)
 * 3. commit-XXXXX → commit (Tier 2, no extract)
 * 4. pattern_XXX → pattern (already extracted)
 * 5. decision_XXX → decision (already extracted)
 * 6. File paths with known artifact extensions → artifact (Tier 2, no extract)
 * 7. SESSION_LOG.md chunks → session (Tier 1, extract) - these are session content
 * 8. Unknown → session with low confidence (legacy fallback)
 */
export function classifyNode(id: string): ClassificationResult {
  // Actual session nodes (Session_001, Session_433, etc.)
  if (/^Session_\d+$/.test(id)) {
    return {
      nodeType: 'session',
      shouldExtractRelationships: true,
      confidence: 'high',
      reason: 'Matches Session_NNN pattern'
    };
  }

  // SESSION_LOG.md chunks (SESSION_LOG.md:1001-2000)
  // These ARE session content, just chunked - should extract
  if (/^SESSION_LOG\.md:\d+-\d+$/.test(id)) {
    return {
      nodeType: 'session',
      shouldExtractRelationships: true,
      confidence: 'high',
      reason: 'SESSION_LOG chunk contains session content'
    };
  }

  // GitHub issues (issue-123)
  if (/^issue-\d+$/.test(id)) {
    return {
      nodeType: 'issue',
      shouldExtractRelationships: true,
      confidence: 'high',
      reason: 'Matches issue-NNN pattern'
    };
  }

  // Git commits (commit-abc123)
  if (/^commit-[a-f0-9]+$/.test(id)) {
    return {
      nodeType: 'commit',
      shouldExtractRelationships: false,
      confidence: 'high',
      reason: 'Matches commit-HASH pattern'
    };
  }

  // Pattern nodes (already classified)
  if (/^pattern_/.test(id)) {
    return {
      nodeType: 'pattern',
      shouldExtractRelationships: false,
      confidence: 'high',
      reason: 'Already a pattern node'
    };
  }

  // Decision nodes (already classified)
  if (/^decision_/.test(id)) {
    return {
      nodeType: 'decision',
      shouldExtractRelationships: false,
      confidence: 'high',
      reason: 'Already a decision node'
    };
  }

  // File paths - classify by extension/path
  if (id.includes('/') || id.includes('.')) {
    const artifactType = classifyArtifactType(id);
    return {
      nodeType: 'artifact',
      shouldExtractRelationships: false,
      confidence: 'high',
      reason: `File path detected (${artifactType})`
    };
  }

  // Fallback - unknown pattern, treat as session with low confidence
  return {
    nodeType: 'session',
    shouldExtractRelationships: true,
    confidence: 'low',
    reason: 'Unknown ID pattern, defaulting to session'
  };
}

/**
 * Classify artifact subtype based on file path
 */
export function classifyArtifactType(path: string): 'code' | 'config' | 'doc' | 'skill' | 'other' {
  const lower = path.toLowerCase();

  // Skills
  if (lower.includes('.claude/skills/') || lower.includes('skill.md')) {
    return 'skill';
  }

  // Config files
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.toml') ||
    lower.endsWith('.env') ||
    lower.includes('config')
  ) {
    return 'config';
  }

  // Code files
  if (
    lower.endsWith('.ts') ||
    lower.endsWith('.js') ||
    lower.endsWith('.py') ||
    lower.endsWith('.sh') ||
    lower.endsWith('.rs') ||
    lower.endsWith('.go')
  ) {
    return 'code';
  }

  // Documentation
  if (
    lower.endsWith('.md') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.rst') ||
    lower.includes('readme') ||
    lower.includes('draft') ||
    lower.includes('spec')
  ) {
    return 'doc';
  }

  return 'other';
}

/**
 * Batch classify multiple node IDs
 */
export function classifyNodes(ids: string[]): Map<string, ClassificationResult> {
  const results = new Map<string, ClassificationResult>();
  for (const id of ids) {
    results.set(id, classifyNode(id));
  }
  return results;
}

/**
 * Get statistics about classifications
 */
export function getClassificationStats(results: Map<string, ClassificationResult>): {
  byType: Record<NodeType, number>;
  shouldExtract: number;
  byConfidence: Record<'high' | 'medium' | 'low', number>;
} {
  const byType: Record<string, number> = {};
  const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0 };
  let shouldExtract = 0;

  for (const result of results.values()) {
    byType[result.nodeType] = (byType[result.nodeType] || 0) + 1;
    byConfidence[result.confidence]++;
    if (result.shouldExtractRelationships) {
      shouldExtract++;
    }
  }

  return {
    byType: byType as Record<NodeType, number>,
    shouldExtract,
    byConfidence: byConfidence as Record<'high' | 'medium' | 'low', number>
  };
}
