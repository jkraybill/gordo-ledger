// TinyGraph Store - Lightweight in-memory graph with JSON persistence
// Part of gordo-ledger MCP Server v0.7.0

import * as fs from 'fs';
import * as path from 'path';
import { GraphNode, Edge, Graph, Path, RelationType, NodeType, GraphQueryOptions } from './types.js';

/**
 * Serialized graph format (for JSON persistence)
 */
interface SerializedGraph {
  version: string;
  nodes: Record<string, GraphNode>;
  edges: Edge[];
  metadata: {
    created: string;
    updated: string;
    nodeCount: number;
    edgeCount: number;
  };
}

/**
 * TinyGraph - Lightweight in-memory graph store
 *
 * Features:
 * - Fast in-memory queries using Map/Set
 * - JSON persistence to .gordo-memory/graph.json
 * - Bidirectional edge traversal
 * - Path finding (BFS)
 * - Automatic persistence on modifications
 */
export class TinyGraph {
  private nodes: Map<string, GraphNode>;
  private edges: Map<string, Edge[]>;  // nodeId -> outgoing edges
  private incomingEdges: Map<string, Edge[]>; // nodeId -> incoming edges
  private storagePath: string;
  private autoSave: boolean;
  private dirty: boolean = false;

  private batchMode: boolean = false;

  constructor(storagePath: string = '.gordo-memory/graph.json', autoSave: boolean = true) {
    this.nodes = new Map();
    this.edges = new Map();
    this.incomingEdges = new Map();
    this.storagePath = storagePath;
    this.autoSave = autoSave;
  }

  /**
   * Begin batch mode — suppresses autoSave until endBatch() is called.
   * Use for bulk operations (e.g., buildGraph) to avoid hundreds of
   * synchronous writeFileSync calls that block the event loop.
   */
  beginBatch(): void {
    this.batchMode = true;
  }

  /**
   * End batch mode and save if dirty.
   */
  endBatch(): void {
    this.batchMode = false;
    if (this.dirty) {
      this.save();
    }
  }

  /**
   * Add a node to the graph
   */
  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.edges.has(node.id)) {
      this.edges.set(node.id, []);
    }
    if (!this.incomingEdges.has(node.id)) {
      this.incomingEdges.set(node.id, []);
    }
    this.dirty = true;
    if (this.autoSave && !this.batchMode) {
      this.save();
    }
  }

  /**
   * Add an edge to the graph
   */
  addEdge(edge: Edge): void {
    // Add to outgoing edges
    const outgoing = this.edges.get(edge.source) || [];
    outgoing.push(edge);
    this.edges.set(edge.source, outgoing);

    // Add to incoming edges
    const incoming = this.incomingEdges.get(edge.target) || [];
    incoming.push(edge);
    this.incomingEdges.set(edge.target, incoming);

    this.dirty = true;
    if (this.autoSave && !this.batchMode) {
      this.save();
    }
  }

  /**
   * Remove a node and all its connected edges
   * @param nodeId Node ID to remove
   * @returns true if node was removed, false if it didn't exist
   */
  removeNode(nodeId: string): boolean {
    if (!this.nodes.has(nodeId)) {
      return false;
    }

    // Remove all outgoing edges from this node
    const outgoing = this.edges.get(nodeId) || [];
    for (const edge of outgoing) {
      // Remove from target's incoming edges
      const targetIncoming = this.incomingEdges.get(edge.target) || [];
      this.incomingEdges.set(
        edge.target,
        targetIncoming.filter(e => e.id !== edge.id)
      );
    }
    this.edges.delete(nodeId);

    // Remove all incoming edges to this node
    const incoming = this.incomingEdges.get(nodeId) || [];
    for (const edge of incoming) {
      // Remove from source's outgoing edges
      const sourceOutgoing = this.edges.get(edge.source) || [];
      this.edges.set(
        edge.source,
        sourceOutgoing.filter(e => e.id !== edge.id)
      );
    }
    this.incomingEdges.delete(nodeId);

    // Remove the node itself
    this.nodes.delete(nodeId);

    this.dirty = true;
    if (this.autoSave && !this.batchMode) {
      this.save();
    }

    return true;
  }

  /**
   * Get a node by ID
   */
  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Get all nodes of a specific type
   */
  getNodesByType(type: NodeType): GraphNode[] {
    return Array.from(this.nodes.values()).filter(node => node.type === type);
  }

  /**
   * Get outgoing edges from a node
   * @param nodeId Source node ID
   * @param type Optional: filter by relationship type
   */
  getOutgoingEdges(nodeId: string, type?: RelationType): Edge[] {
    const edges = this.edges.get(nodeId) || [];
    if (type) {
      return edges.filter(edge => edge.type === type);
    }
    return edges;
  }

  /**
   * Get incoming edges to a node
   * @param nodeId Target node ID
   * @param type Optional: filter by relationship type
   */
  getIncomingEdges(nodeId: string, type?: RelationType): Edge[] {
    const edges = this.incomingEdges.get(nodeId) || [];
    if (type) {
      return edges.filter(edge => edge.type === type);
    }
    return edges;
  }

  /**
   * Get all edges (outgoing + incoming) for a node
   */
  getAllEdges(nodeId: string, type?: RelationType): Edge[] {
    const outgoing = this.getOutgoingEdges(nodeId, type);
    const incoming = this.getIncomingEdges(nodeId, type);
    return [...outgoing, ...incoming];
  }

  /**
   * Traverse graph from a starting node
   * @param startId Starting node ID
   * @param options Query options (depth, filters, etc.)
   * @returns Subgraph containing reachable nodes and edges
   */
  traverse(startId: string, options: GraphQueryOptions = {}): Graph {
    const {
      depth = 2,
      relationshipTypes,
      nodeTypes,
      minWeight = 0,
      limit
    } = options;

    const visited = new Set<string>();
    const resultNodes = new Map<string, GraphNode>();
    const resultEdges: Edge[] = [];
    const seenEdges = new Set<string>(); // Track edges to avoid duplicates

    // BFS traversal
    const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

    while (queue.length > 0 && (!limit || resultNodes.size < limit)) {
      const { id, depth: currentDepth } = queue.shift()!;

      if (visited.has(id) || currentDepth > depth) {
        continue;
      }

      visited.add(id);
      const node = this.nodes.get(id);

      if (!node) continue;

      // Apply node type filter
      if (nodeTypes && !nodeTypes.includes(node.type)) {
        continue;
      }

      resultNodes.set(id, node);

      if (currentDepth < depth) {
        // Get all edges (outgoing + incoming)
        const edges = this.getAllEdges(id);

        for (const edge of edges) {
          // Apply relationship type filter
          if (relationshipTypes && !relationshipTypes.includes(edge.type)) {
            continue;
          }

          // Apply weight filter
          if (edge.weight !== undefined && edge.weight < minWeight) {
            continue;
          }

          // Avoid duplicate edges (since getAllEdges returns both incoming and outgoing)
          if (!seenEdges.has(edge.id)) {
            seenEdges.add(edge.id);
            resultEdges.push(edge);
          }

          // Add neighbor to queue
          const neighborId = edge.source === id ? edge.target : edge.source;
          if (!visited.has(neighborId)) {
            queue.push({ id: neighborId, depth: currentDepth + 1 });
          }
        }
      }
    }

    return { nodes: resultNodes, edges: resultEdges };
  }

  /**
   * Find shortest path between two nodes (BFS)
   * @param fromId Start node ID
   * @param toId End node ID
   * @returns Path if found, null otherwise
   */
  findPath(fromId: string, toId: string): Path | null {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) {
      return null;
    }

    if (fromId === toId) {
      return {
        start: fromId,
        end: toId,
        nodes: [fromId],
        edges: [],
        length: 0
      };
    }

    const visited = new Set<string>();
    const parent = new Map<string, { nodeId: string; edge: Edge }>();
    const queue: string[] = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;

      // Get neighbors (both outgoing and incoming)
      const edges = this.getAllEdges(currentId);

      for (const edge of edges) {
        const neighborId = edge.source === currentId ? edge.target : edge.source;

        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          parent.set(neighborId, { nodeId: currentId, edge });
          queue.push(neighborId);

          if (neighborId === toId) {
            // Reconstruct path
            const nodes: string[] = [];
            const pathEdges: Edge[] = [];
            let current = toId;

            while (current !== fromId) {
              nodes.unshift(current);
              const prev = parent.get(current)!;
              pathEdges.unshift(prev.edge);
              current = prev.nodeId;
            }
            nodes.unshift(fromId);

            return {
              start: fromId,
              end: toId,
              nodes,
              edges: pathEdges,
              length: pathEdges.length
            };
          }
        }
      }
    }

    return null; // No path found
  }

  /**
   * Get graph statistics
   */
  getStats() {
    return {
      nodeCount: this.nodes.size,
      edgeCount: Array.from(this.edges.values()).reduce((sum, edges) => sum + edges.length, 0) / 2, // Divide by 2 (bidirectional)
      nodesByType: {
        session: this.getNodesByType('session').length,
        pattern: this.getNodesByType('pattern').length,
        decision: this.getNodesByType('decision').length,
        outcome: this.getNodesByType('outcome').length
      }
    };
  }

  /**
   * Serialize graph to JSON string
   */
  serialize(): string {
    const serialized: SerializedGraph = {
      version: '1.0.0',
      nodes: Object.fromEntries(this.nodes),
      edges: Array.from(this.edges.values()).flat(),
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        nodeCount: this.nodes.size,
        edgeCount: Array.from(this.edges.values()).reduce((sum, edges) => sum + edges.length, 0)
      }
    };
    return JSON.stringify(serialized, null, 2);
  }

  /**
   * Deserialize graph from JSON string
   */
  deserialize(json: string): void {
    const data: SerializedGraph = JSON.parse(json);

    this.nodes.clear();
    this.edges.clear();
    this.incomingEdges.clear();

    // Load nodes
    for (const [id, node] of Object.entries(data.nodes)) {
      this.nodes.set(id, node);
      this.edges.set(id, []);
      this.incomingEdges.set(id, []);
    }

    // Load edges
    for (const edge of data.edges) {
      // Add to outgoing
      const outgoing = this.edges.get(edge.source) || [];
      outgoing.push(edge);
      this.edges.set(edge.source, outgoing);

      // Add to incoming
      const incoming = this.incomingEdges.get(edge.target) || [];
      incoming.push(edge);
      this.incomingEdges.set(edge.target, incoming);
    }

    this.dirty = false;
  }

  /**
   * Save graph to disk (JSON file)
   */
  save(): void {
    if (!this.dirty) return;

    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const json = this.serialize();
      fs.writeFileSync(this.storagePath, json, 'utf8');
      this.dirty = false;
    } catch (error) {
      console.error('Failed to save graph:', error);
    }
  }

  /**
   * Load graph from disk (JSON file)
   */
  load(): void {
    try {
      if (!fs.existsSync(this.storagePath)) {
        console.log('No existing graph found, starting fresh');
        return;
      }

      const json = fs.readFileSync(this.storagePath, 'utf8');
      this.deserialize(json);
      console.log('Graph loaded successfully');
    } catch (error) {
      console.error('Failed to load graph:', error);
    }
  }

  /**
   * Clear the entire graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.incomingEdges.clear();
    this.dirty = true;
    if (this.autoSave) {
      this.save();
    }
  }

  /**
   * Reload graph from disk, replacing in-memory state
   * Use after external modifications (e.g., reclassify-graph)
   */
  reload(): void {
    // Clear in-memory state
    this.nodes.clear();
    this.edges.clear();
    this.incomingEdges.clear();
    this.dirty = false;

    // Load fresh from disk
    this.load();
  }
}
