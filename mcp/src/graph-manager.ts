/**
 * Graph Manager - Orchestrates knowledge graph construction and queries
 * Part of gordo-ledger MCP Server v0.7.0
 */

import { TinyGraph } from './graph/store.js';
import { GraphQuerier } from './graph/queries.js';
import { RelationshipExtractor, ExtractorConfig } from './graph/extractor.js';
import type { SessionEntry } from './types.js';
import { SessionNode, PatternNode, DecisionNode, Edge, RelationshipExtraction } from './graph/types.js';
import * as path from 'path';

/**
 * Normalize LLM-extracted session IDs to match parser node ID format.
 * LLM may return "session_1", "session_01", "Session 1", etc.
 * Parser creates nodes as "Session_01", "Session_02", etc.
 * Fix F-001: Without this, edges point to non-existent nodes.
 */
function normalizeSessionTarget(target: string, existingNodeIds: Set<string>): string {
  // If it already matches an existing node, use it directly
  if (existingNodeIds.has(target)) {
    return target;
  }

  // Extract session number from various formats
  const patterns = [
    /^session[_\s-]?(\d+)$/i,        // session_1, session 1, Session-1
    /^Session_(\d+)$/,                 // Session_01 (already canonical)
    /^s(\d+)$/i,                       // s1, S1
  ];

  for (const pattern of patterns) {
    const match = target.match(pattern);
    if (match) {
      const num = match[1].padStart(2, '0');
      const canonical = `Session_${num}`;
      if (existingNodeIds.has(canonical)) {
        return canonical;
      }
    }
  }

  // No match found — return as-is (edge will point to non-existent node,
  // but that's better than silently dropping it)
  return target;
}

export interface GraphConfig {
  indexPath: string;
  provider: 'openai' | 'openrouter' | 'ollama';
  model?: string;
  apiKey?: string;
  ollamaUrl?: string;
}

export class GraphManager {
  private graph: TinyGraph;
  private querier: GraphQuerier;
  private extractor: RelationshipExtractor;
  private config: GraphConfig;
  private initialized: boolean = false;

  constructor(config: GraphConfig) {
    this.config = config;

    // Initialize graph store
    const graphPath = path.join(config.indexPath, 'graph.json');
    this.graph = new TinyGraph(graphPath, true); // Auto-save enabled

    // Initialize querier
    this.querier = new GraphQuerier(this.graph);

    // Initialize extractor
    const extractorConfig: ExtractorConfig = {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      ollamaUrl: config.ollamaUrl
    };

    this.extractor = new RelationshipExtractor(extractorConfig);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load existing graph from disk
    this.graph.load();
    this.initialized = true;
  }

  /**
   * Build knowledge graph from journal sessions
   * @param sessions Parsed journal sessions
   * @param reindex Force rebuild of entire graph (default: false, incremental)
   * @param onProgress Progress callback (current, total, stage)
   * @returns Number of nodes and edges created
   */
  async buildGraph(
    sessions: SessionEntry[],
    reindex: boolean = false,
    onProgress?: (current: number, total: number, stage: string) => void
  ): Promise<{
    nodesCreated: number;
    edgesCreated: number;
    skipped: number;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    let nodesCreated = 0;
    let edgesCreated = 0;
    let skipped = 0;

    // Filter sessions if incremental
    let sessionsToProcess = sessions;
    if (!reindex) {
      onProgress?.(0, sessions.length, 'Checking existing sessions...');
      let lastProgressTime = Date.now();
      sessionsToProcess = sessions.filter((session, idx) => {
        const exists = this.graph.getNode(session.id);
        if (exists) {
          skipped++;
        }
        // Report every 10 items OR every 5 seconds
        const now = Date.now();
        if ((idx + 1) % 10 === 0 || idx === sessions.length - 1 || now - lastProgressTime >= 5000) {
          onProgress?.(idx + 1, sessions.length, 'Checking existing sessions...');
          lastProgressTime = now;
        }
        return !exists;
      });
    }

    if (sessionsToProcess.length === 0) {
      return { nodesCreated, edgesCreated, skipped };
    }

    // Fix F-006: Use batch mode to avoid hundreds of synchronous file writes
    // that block the event loop and crash the MCP transport
    this.graph.beginBatch();

    // Track patterns and decisions across sessions
    const patternMap = new Map<string, PatternNode>();
    const decisionMap = new Map<string, DecisionNode>();

    // Fix F-001: Build set of known node IDs for normalizing LLM-extracted targets
    const knownNodeIds = new Set<string>(sessions.map(s => s.id));

    onProgress?.(0, sessionsToProcess.length, 'Extracting relationships...');
    let lastProgressTime = Date.now();

    for (let i = 0; i < sessionsToProcess.length; i++) {
      const session = sessionsToProcess[i];
      const sessionId = session.id;

      // Extract metadata
      const metadata = this.extractor.extractSessionMetadata(session.content, sessionId);

      // Extract relationships using LLM
      const extraction = await this.extractor.extract(session.content, sessionId);

      // Create session node
      const sessionNode: SessionNode = {
        id: sessionId,
        type: 'session',
        created: metadata.created!,
        date: metadata.date!,
        title: metadata.title!,
        summary: metadata.summary!,
        outcomes: extraction.outcomes.map(o => o.outcome),
        patterns: extraction.patterns.map(p => p.pattern)
      };

      this.graph.addNode(sessionNode);
      nodesCreated++;

      // Add chronological "follows" edge to previous session
      if (i > 0) {
        const prevSessionId = sessions[i - 1].id;
        const followsEdge: Edge = {
          id: `edge_follows_${prevSessionId}_${sessionId}`,
          type: 'follows',
          source: prevSessionId,
          target: sessionId,
          created: sessionNode.date
        };

        this.graph.addEdge(followsEdge);
        edgesCreated++;
      }

      // Add dependency edges (Fix F-001: normalize LLM-extracted targets)
      for (const dep of extraction.dependencies) {
        const normalizedTarget = normalizeSessionTarget(dep.target, knownNodeIds);
        const depEdge: Edge = {
          id: `edge_depends_${sessionId}_${normalizedTarget}`,
          type: 'depends_on',
          source: sessionId,
          target: normalizedTarget,
          metadata: { reason: dep.reason },
          created: sessionNode.date
        };

        this.graph.addEdge(depEdge);
        edgesCreated++;
      }

      // Add resolution edges (Fix F-001: normalize LLM-extracted targets)
      for (const res of extraction.resolutions) {
        const normalizedTarget = normalizeSessionTarget(res.target, knownNodeIds);
        const resEdge: Edge = {
          id: `edge_resolves_${sessionId}_${normalizedTarget}`,
          type: 'resolves',
          source: sessionId,
          target: normalizedTarget,
          metadata: { reason: res.reason },
          created: sessionNode.date
        };

        this.graph.addEdge(resEdge);
        edgesCreated++;
      }

      // Track patterns
      for (const pattern of extraction.patterns) {
        // Skip patterns with missing or invalid data
        if (!pattern.pattern || typeof pattern.pattern !== 'string') {
          continue;
        }

        const patternId = `pattern_${pattern.pattern.toLowerCase().replace(/\s+/g, '_')}`;

        if (!patternMap.has(patternId)) {
          const patternNode: PatternNode = {
            id: patternId,
            type: 'pattern',
            created: sessionNode.date,
            name: pattern.pattern,
            description: pattern.description,
            firstSeen: sessionId,
            occurrences: 1,
            trend: 'recurring' // Will be updated based on frequency
          };

          patternMap.set(patternId, patternNode);
          this.graph.addNode(patternNode);
          nodesCreated++;
        } else {
          // Increment occurrences
          const existingPattern = patternMap.get(patternId)!;
          existingPattern.occurrences++;
        }

        // Add edge from session to pattern
        const patternEdge: Edge = {
          id: `edge_pattern_${sessionId}_${patternId}`,
          type: 'introduces_pattern',
          source: sessionId,
          target: patternId,
          created: sessionNode.date
        };

        this.graph.addEdge(patternEdge);
        edgesCreated++;
      }

      // Track decisions
      for (const decision of extraction.decisions) {
        // Skip decisions with missing or invalid data
        if (!decision.decision || typeof decision.decision !== 'string') {
          continue;
        }

        const decisionId = `decision_${sessionId}_${decisionMap.size + 1}`;

        const decisionNode: DecisionNode = {
          id: decisionId,
          type: 'decision',
          created: sessionNode.date,
          sessionId,
          title: decision.decision,
          rationale: decision.rationale,
          expectedImpact: decision.expectedImpact
        };

        decisionMap.set(decisionId, decisionNode);
        this.graph.addNode(decisionNode);
        nodesCreated++;

        // Add edge from session to decision
        const decisionEdge: Edge = {
          id: `edge_decision_${sessionId}_${decisionId}`,
          type: 'introduces_pattern', // Decisions introduce architectural patterns
          source: sessionId,
          target: decisionId,
          created: sessionNode.date
        };

        this.graph.addEdge(decisionEdge);
        edgesCreated++;
      }

      // Report progress every 10 items OR every 10 seconds
      const now = Date.now();
      if ((i + 1) % 10 === 0 || i === sessionsToProcess.length - 1 || now - lastProgressTime >= 10000) {
        onProgress?.(i + 1, sessionsToProcess.length, 'Extracting relationships...');
        lastProgressTime = now;
      }
    }

    // Save graph to disk (single write instead of per-operation writes)
    onProgress?.(sessionsToProcess.length, sessionsToProcess.length, 'Saving knowledge graph...');
    this.graph.endBatch(); // Ends batch mode and saves once

    return { nodesCreated, edgesCreated, skipped };
  }

  /**
   * Query the knowledge graph
   */
  async queryGraph(sessionId: string, depth: number = 2) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.querier.queryGraph(sessionId, { depth });
  }

  /**
   * Find sessions with a specific pattern
   */
  async queryPatterns(patternName: string) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.querier.queryPatterns(patternName);
  }

  /**
   * Find path between two sessions
   */
  async findPath(fromSessionId: string, toSessionId: string) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.querier.queryPath(fromSessionId, toSessionId);
  }

  /**
   * Get session dependencies
   */
  async queryDependencies(sessionId: string) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.querier.queryDependencies(sessionId);
  }

  /**
   * Analyze session impact
   */
  async queryImpact(sessionId: string) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.querier.queryImpact(sessionId);
  }

  /**
   * Get sessions by topic
   */
  async queryTopic(topic: string) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.querier.queryTopic(topic);
  }

  /**
   * Get graph statistics
   */
  async getStats() {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.querier.getStats();
  }

  /**
   * Clear the entire graph
   */
  async clear() {
    if (!this.initialized) {
      await this.initialize();
    }

    this.graph.clear();
  }
}
