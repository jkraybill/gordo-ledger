// Graph Query Functions - High-level query interface
// Part of gordo-ledger MCP Server v0.7.0

import { TinyGraph } from './store.js';
import { Graph, GraphNode, SessionNode, PatternNode, DecisionNode, Path, GraphQueryOptions } from './types.js';

/**
 * GraphQuerier - High-level query interface for knowledge graph
 */
export class GraphQuerier {
  constructor(private graph: TinyGraph) {}

  /**
   * Query 1: Get subgraph around a session
   * @param sessionId Session ID to query
   * @param options Query options (depth, filters)
   * @returns Subgraph containing related nodes and edges
   *
   * Example: graph("session_42", { depth: 2 })
   * Returns: All nodes within 2 hops of session 42
   */
  queryGraph(sessionId: string, options: GraphQueryOptions = {}): Graph {
    return this.graph.traverse(sessionId, {
      depth: options.depth || 2,
      relationshipTypes: options.relationshipTypes,
      nodeTypes: options.nodeTypes,
      minWeight: options.minWeight,
      limit: options.limit
    });
  }

  /**
   * Query 2: Find sessions with a specific pattern
   * @param patternName Pattern name to search for
   * @returns Sessions that exhibit this pattern
   *
   * Example: patterns("oauth_debugging")
   * Returns: All sessions dealing with OAuth debugging
   */
  queryPatterns(patternName: string): {
    pattern: PatternNode | null;
    sessions: SessionNode[];
    trend: 'recurring' | 'resolved' | 'increasing' | 'unknown';
  } {
    // Find pattern node
    const patternNode = Array.from(this.graph.getNodesByType('pattern')).find(
      node => (node as PatternNode).name.toLowerCase().includes(patternName.toLowerCase())
    ) as PatternNode | undefined;

    // Fix F-007: Always search session patterns, even when no pattern node exists.
    // Pattern nodes only exist after buildGraph, but sessions may have pattern
    // strings in their arrays from extraction.
    const sessions: SessionNode[] = [];
    const allSessions = this.graph.getNodesByType('session') as SessionNode[];

    for (const session of allSessions) {
      if (session.patterns.some(p => p.toLowerCase().includes(patternName.toLowerCase()))) {
        sessions.push(session);
      }
    }

    // Sort by date (most recent first)
    sessions.sort((a, b) => b.date.localeCompare(a.date));

    return {
      pattern: patternNode || null,
      sessions,
      trend: patternNode?.trend || (sessions.length > 0 ? 'recurring' : 'unknown')
    };
  }

  /**
   * Query 3: Find path between two sessions
   * @param fromSessionId Start session
   * @param toSessionId End session
   * @returns Path if exists, null otherwise
   *
   * Example: path("session_10", "session_47")
   * Returns: Path showing how Session 10 relates to Session 47
   */
  queryPath(fromSessionId: string, toSessionId: string): Path | null {
    return this.graph.findPath(fromSessionId, toSessionId);
  }

  /**
   * Query 4: Get dependencies for a session
   * @param sessionId Session to query
   * @returns Sessions this session depends on (context requirements)
   *
   * Example: dependencies("session_42")
   * Returns: All sessions Session 42 depends on for context
   */
  queryDependencies(sessionId: string): {
    directDependencies: SessionNode[];
    transitiveDependencies: SessionNode[];
    depth: number;
  } {
    // Direct dependencies (depth 1)
    const directEdges = this.graph.getOutgoingEdges(sessionId, 'depends_on');
    const directDeps: SessionNode[] = [];

    for (const edge of directEdges) {
      const node = this.graph.getNode(edge.target);
      if (node && node.type === 'session') {
        directDeps.push(node as SessionNode);
      }
    }

    // Transitive dependencies (full dependency tree)
    // NOTE: We only traverse OUTGOING depends_on edges, not incoming
    // (incoming edges represent what depends on THIS session, not what it depends on)
    const visited = new Set<string>([sessionId]);
    const transitiveDeps: SessionNode[] = [];
    const queue: string[] = [...directDeps.map(d => d.id)];

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const node = this.graph.getNode(currentId);
      if (node && node.type === 'session') {
        transitiveDeps.push(node as SessionNode);

        // Find dependencies of this dependency (recursive)
        const edges = this.graph.getOutgoingEdges(currentId, 'depends_on');
        for (const edge of edges) {
          if (!visited.has(edge.target)) {
            queue.push(edge.target);
          }
        }
      }
    }

    return {
      directDependencies: directDeps,
      transitiveDependencies: transitiveDeps,
      depth: transitiveDeps.length > 0 ? Math.max(...transitiveDeps.map(d => {
        const path = this.graph.findPath(sessionId, d.id);
        return path ? path.length : 0;
      })) : 0
    };
  }

  /**
   * Query 5: Analyze impact of a session/decision
   * @param sessionId Session to analyze
   * @returns Sessions impacted by this session
   *
   * Example: impact("session_31")
   * Returns: All sessions affected by decisions made in Session 31
   */
  queryImpact(sessionId: string): {
    directImpact: SessionNode[];
    transitiveImpact: SessionNode[];
    decisions: DecisionNode[];
  } {
    // Find decisions made in this session
    const decisions: DecisionNode[] = [];
    const allDecisions = this.graph.getNodesByType('decision') as DecisionNode[];
    for (const decision of allDecisions) {
      if (decision.sessionId === sessionId) {
        decisions.push(decision);
      }
    }

    // Direct impact (sessions directly affected)
    const directEdges = this.graph.getOutgoingEdges(sessionId, 'impacts');
    const directImpact: SessionNode[] = [];

    for (const edge of directEdges) {
      const node = this.graph.getNode(edge.target);
      if (node && node.type === 'session') {
        directImpact.push(node as SessionNode);
      }
    }

    // Transitive impact (cascade effects)
    const subgraph = this.graph.traverse(sessionId, {
      depth: 10,
      relationshipTypes: ['impacts', 'causes']
    });

    const transitiveImpact: SessionNode[] = [];
    for (const [nodeId, node] of subgraph.nodes.entries()) {
      if (node.type === 'session' && nodeId !== sessionId && !directImpact.find(d => d.id === nodeId)) {
        transitiveImpact.push(node as SessionNode);
      }
    }

    return {
      directImpact,
      transitiveImpact,
      decisions
    };
  }

  /**
   * Advanced Query: Find all sessions related to a topic
   * @param topic Topic keyword (e.g., "authentication", "database", "deployment")
   * @returns Sessions containing this topic in patterns or content
   */
  queryTopic(topic: string): SessionNode[] {
    const sessions = this.graph.getNodesByType('session') as SessionNode[];
    const topicLower = topic.toLowerCase();

    return sessions.filter(session => {
      // Check title
      if (session.title.toLowerCase().includes(topicLower)) {
        return true;
      }
      // Check summary
      if (session.summary.toLowerCase().includes(topicLower)) {
        return true;
      }
      // Check patterns
      if (session.patterns.some(p => p.toLowerCase().includes(topicLower))) {
        return true;
      }
      return false;
    }).sort((a, b) => b.date.localeCompare(a.date)); // Most recent first
  }

  /**
   * Advanced Query: Get session timeline (chronological sequence)
   * @param startDate Optional: start date (ISO format)
   * @param endDate Optional: end date (ISO format)
   * @returns Sessions in chronological order
   */
  queryTimeline(startDate?: string, endDate?: string): SessionNode[] {
    let sessions = this.graph.getNodesByType('session') as SessionNode[];

    if (startDate) {
      sessions = sessions.filter(s => s.date >= startDate);
    }
    if (endDate) {
      sessions = sessions.filter(s => s.date <= endDate);
    }

    return sessions.sort((a, b) => a.date.localeCompare(b.date)); // Chronological order
  }

  /**
   * Advanced Query: Get pattern evolution
   * @param patternName Pattern to track
   * @returns Pattern occurrences over time
   */
  queryPatternEvolution(patternName: string): {
    pattern: PatternNode | null;
    timeline: Array<{
      date: string;
      sessionId: string;
      title: string;
    }>;
    firstOccurrence: SessionNode | null;
    lastOccurrence: SessionNode | null;
    frequency: number;
  } {
    const patternResult = this.queryPatterns(patternName);

    if (!patternResult.pattern || patternResult.sessions.length === 0) {
      return {
        pattern: null,
        timeline: [],
        firstOccurrence: null,
        lastOccurrence: null,
        frequency: 0
      };
    }

    const timeline = patternResult.sessions.map(s => ({
      date: s.date,
      sessionId: s.id,
      title: s.title
    })).sort((a, b) => a.date.localeCompare(b.date));

    return {
      pattern: patternResult.pattern,
      timeline,
      firstOccurrence: patternResult.sessions[patternResult.sessions.length - 1], // Oldest
      lastOccurrence: patternResult.sessions[0], // Newest
      frequency: patternResult.sessions.length
    };
  }

  /**
   * Get graph statistics
   */
  getStats() {
    return this.graph.getStats();
  }
}
