// Knowledge Graph Types
// Part of gordo-ledger MCP Server v0.7.0
// Implements relationship-aware memory system

/**
 * Node types in the knowledge graph
 */
export type NodeType = 'session' | 'pattern' | 'decision' | 'outcome';

/**
 * Relationship types between nodes
 */
export type RelationType =
  | 'follows'           // Session B chronologically follows Session A
  | 'depends_on'        // Session B requires context from Session A
  | 'resolves'          // Session B resolves problem from Session A
  | 'introduces_pattern' // Session A first occurrence of pattern
  | 'similar_to'        // Semantic similarity (from embeddings)
  | 'impacts'           // Decision in A affects sessions B, C, D
  | 'causes'            // Session A caused issue in Session B
  | 'invalidates'       // Session B makes Session A obsolete
  | 'implements'        // Session B implements decision from A
  | 'contradicts';      // Session B conflicts with Session A

/**
 * Base node interface
 */
export interface BaseNode {
  id: string;
  type: NodeType;
  created: string; // ISO date
}

/**
 * Session node - represents a journal session
 */
export interface SessionNode extends BaseNode {
  type: 'session';
  date: string;        // ISO date of session
  title: string;       // Session title
  summary: string;     // Brief summary
  outcomes: string[];  // What was achieved
  patterns: string[];  // Patterns that appeared
  file?: string;       // Path to session file (hierarchical)
  lineOffset?: number; // Line number (flat journal)
}

/**
 * Pattern node - recurring theme/issue
 */
export interface PatternNode extends BaseNode {
  type: 'pattern';
  name: string;
  description: string;
  firstSeen: string;     // session_id where pattern first appeared
  occurrences: number;   // How many sessions have this pattern
  trend: 'recurring' | 'resolved' | 'increasing';
}

/**
 * Decision node - architectural/strategic decision
 */
export interface DecisionNode extends BaseNode {
  type: 'decision';
  sessionId: string;   // Where decision was made
  title: string;
  rationale: string;
  expectedImpact: string;
  actualOutcomes?: string[];
}

/**
 * Outcome node - result achieved
 */
export interface OutcomeNode extends BaseNode {
  type: 'outcome';
  outcomeType: string; // e.g., "bug_fixed", "feature_added"
  frequency: number;   // How many sessions achieved this
  successRate?: number; // 0-1, correlation with positive results
}

/**
 * Union type for all nodes
 */
export type GraphNode = SessionNode | PatternNode | DecisionNode | OutcomeNode;

/**
 * Edge (relationship) between two nodes
 */
export interface Edge {
  id: string;           // Unique edge ID
  type: RelationType;
  source: string;       // Source node ID
  target: string;       // Target node ID
  weight?: number;      // Relationship strength (0-1)
  metadata?: Record<string, any>; // Additional context
  created: string;      // ISO date when relationship detected
}

/**
 * Graph structure (subgraph result)
 */
export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: Edge[];
}

/**
 * Path between two nodes
 */
export interface Path {
  start: string;
  end: string;
  nodes: string[];     // Node IDs in path
  edges: Edge[];       // Edges connecting them
  length: number;      // Path length
}

/**
 * Relationship extraction result
 */
export interface RelationshipExtraction {
  dependencies: Array<{
    target: string;    // session_id
    reason: string;
  }>;
  resolutions: Array<{
    target: string;    // session_id
    reason: string;
  }>;
  patterns: Array<{
    pattern: string;
    description: string;
  }>;
  decisions: Array<{
    decision: string;
    rationale: string;
    expectedImpact: string;
  }>;
  outcomes: Array<{
    outcome: string;
    description: string;
  }>;
}

/**
 * Query options for graph traversal
 */
export interface GraphQueryOptions {
  depth?: number;              // Max depth to traverse (default: 2)
  relationshipTypes?: RelationType[]; // Filter by relationship type
  nodeTypes?: NodeType[];      // Filter by node type
  minWeight?: number;          // Minimum edge weight
  limit?: number;              // Max nodes to return
}
