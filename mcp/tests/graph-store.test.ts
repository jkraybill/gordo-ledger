// Tests for TinyGraph Store
// Part of gordo-memory MCP Server v0.7.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TinyGraph } from '../src/graph/store.js';
import { SessionNode, PatternNode, DecisionNode, Edge } from '../src/graph/types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('TinyGraph Store', () => {
  let graph: TinyGraph;
  const testStoragePath = '.gordo-memory-test/graph-test.json';

  beforeEach(() => {
    // Create fresh graph with autoSave disabled for tests
    graph = new TinyGraph(testStoragePath, false);
  });

  afterEach(() => {
    // Clean up test files
    const dir = path.dirname(testStoragePath);
    if (fs.existsSync(testStoragePath)) {
      fs.unlinkSync(testStoragePath);
    }
    if (fs.existsSync(dir)) {
      fs.rmdirSync(dir);
    }
  });

  describe('Node Operations', () => {
    it('should add and retrieve a session node', () => {
      const session: SessionNode = {
        id: 'session_1',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Test Session',
        summary: 'Testing graph store',
        outcomes: ['test_added'],
        patterns: ['testing']
      };

      graph.addNode(session);
      const retrieved = graph.getNode('session_1');

      expect(retrieved).toEqual(session);
    });

    it('should add and retrieve a pattern node', () => {
      const pattern: PatternNode = {
        id: 'pattern_oauth',
        type: 'pattern',
        created: '2025-01-01',
        name: 'OAuth Bugs',
        description: 'Recurring OAuth authentication issues',
        firstSeen: 'session_5',
        occurrences: 3,
        trend: 'recurring'
      };

      graph.addNode(pattern);
      const retrieved = graph.getNode('pattern_oauth');

      expect(retrieved).toEqual(pattern);
    });

    it('should add and retrieve a decision node', () => {
      const decision: DecisionNode = {
        id: 'decision_1',
        type: 'decision',
        created: '2025-01-01',
        sessionId: 'session_10',
        title: 'Switch to TypeScript',
        rationale: 'Type safety for production code',
        expectedImpact: 'Fewer runtime errors'
      };

      graph.addNode(decision);
      const retrieved = graph.getNode('decision_1');

      expect(retrieved).toEqual(decision);
    });

    it('should return undefined for non-existent node', () => {
      const retrieved = graph.getNode('nonexistent');
      expect(retrieved).toBeUndefined();
    });

    it('should get nodes by type', () => {
      const session1: SessionNode = {
        id: 'session_1',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Session 1',
        summary: 'First session',
        outcomes: [],
        patterns: []
      };

      const session2: SessionNode = {
        id: 'session_2',
        type: 'session',
        created: '2025-01-02',
        date: '2025-01-02',
        title: 'Session 2',
        summary: 'Second session',
        outcomes: [],
        patterns: []
      };

      const pattern: PatternNode = {
        id: 'pattern_1',
        type: 'pattern',
        created: '2025-01-01',
        name: 'Test Pattern',
        description: 'Testing pattern retrieval',
        firstSeen: 'session_1',
        occurrences: 1,
        trend: 'recurring'
      };

      graph.addNode(session1);
      graph.addNode(session2);
      graph.addNode(pattern);

      const sessions = graph.getNodesByType('session');
      const patterns = graph.getNodesByType('pattern');

      expect(sessions).toHaveLength(2);
      expect(patterns).toHaveLength(1);
      expect(sessions.map(s => s.id)).toContain('session_1');
      expect(sessions.map(s => s.id)).toContain('session_2');
    });
  });

  describe('Edge Operations', () => {
    beforeEach(() => {
      // Add test nodes
      graph.addNode({
        id: 'session_1',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Session 1',
        summary: 'First',
        outcomes: [],
        patterns: []
      });

      graph.addNode({
        id: 'session_2',
        type: 'session',
        created: '2025-01-02',
        date: '2025-01-02',
        title: 'Session 2',
        summary: 'Second',
        outcomes: [],
        patterns: []
      });

      graph.addNode({
        id: 'session_3',
        type: 'session',
        created: '2025-01-03',
        date: '2025-01-03',
        title: 'Session 3',
        summary: 'Third',
        outcomes: [],
        patterns: []
      });
    });

    it('should add edge between nodes', () => {
      const edge: Edge = {
        id: 'edge_1',
        type: 'follows',
        source: 'session_1',
        target: 'session_2',
        created: '2025-01-02'
      };

      graph.addEdge(edge);

      const outgoing = graph.getOutgoingEdges('session_1');
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0]).toEqual(edge);
    });

    it('should track bidirectional edges', () => {
      const edge: Edge = {
        id: 'edge_1',
        type: 'depends_on',
        source: 'session_2',
        target: 'session_1',
        created: '2025-01-02'
      };

      graph.addEdge(edge);

      const outgoing = graph.getOutgoingEdges('session_2');
      const incoming = graph.getIncomingEdges('session_1');

      expect(outgoing).toHaveLength(1);
      expect(incoming).toHaveLength(1);
      expect(outgoing[0]).toEqual(edge);
      expect(incoming[0]).toEqual(edge);
    });

    it('should filter edges by relationship type', () => {
      graph.addEdge({
        id: 'edge_1',
        type: 'follows',
        source: 'session_1',
        target: 'session_2',
        created: '2025-01-02'
      });

      graph.addEdge({
        id: 'edge_2',
        type: 'depends_on',
        source: 'session_1',
        target: 'session_3',
        created: '2025-01-03'
      });

      const followsEdges = graph.getOutgoingEdges('session_1', 'follows');
      const dependsEdges = graph.getOutgoingEdges('session_1', 'depends_on');

      expect(followsEdges).toHaveLength(1);
      expect(dependsEdges).toHaveLength(1);
      expect(followsEdges[0].type).toBe('follows');
      expect(dependsEdges[0].type).toBe('depends_on');
    });

    it('should get all edges (outgoing + incoming)', () => {
      graph.addEdge({
        id: 'edge_1',
        type: 'follows',
        source: 'session_1',
        target: 'session_2',
        created: '2025-01-02'
      });

      graph.addEdge({
        id: 'edge_2',
        type: 'depends_on',
        source: 'session_3',
        target: 'session_2',
        created: '2025-01-03'
      });

      const allEdges = graph.getAllEdges('session_2');
      expect(allEdges).toHaveLength(2);
    });
  });

  describe('Graph Traversal', () => {
    beforeEach(() => {
      // Create graph: session_1 -> session_2 -> session_3 -> session_4
      for (let i = 1; i <= 4; i++) {
        graph.addNode({
          id: `session_${i}`,
          type: 'session',
          created: `2025-01-0${i}`,
          date: `2025-01-0${i}`,
          title: `Session ${i}`,
          summary: `Session ${i}`,
          outcomes: [],
          patterns: []
        });
      }

      graph.addEdge({
        id: 'edge_1_2',
        type: 'follows',
        source: 'session_1',
        target: 'session_2',
        created: '2025-01-02'
      });

      graph.addEdge({
        id: 'edge_2_3',
        type: 'follows',
        source: 'session_2',
        target: 'session_3',
        created: '2025-01-03'
      });

      graph.addEdge({
        id: 'edge_3_4',
        type: 'follows',
        source: 'session_3',
        target: 'session_4',
        created: '2025-01-04'
      });
    });

    it('should traverse graph with depth 1', () => {
      const subgraph = graph.traverse('session_1', { depth: 1 });

      expect(subgraph.nodes.size).toBe(2); // session_1 + session_2
      expect(subgraph.edges).toHaveLength(1);
      expect(subgraph.nodes.has('session_1')).toBe(true);
      expect(subgraph.nodes.has('session_2')).toBe(true);
    });

    it('should traverse graph with depth 2', () => {
      const subgraph = graph.traverse('session_1', { depth: 2 });

      expect(subgraph.nodes.size).toBe(3); // session_1 + session_2 + session_3
      expect(subgraph.edges).toHaveLength(2);
      expect(subgraph.nodes.has('session_3')).toBe(true);
    });

    it('should respect depth limit', () => {
      const subgraph = graph.traverse('session_1', { depth: 1 });

      expect(subgraph.nodes.has('session_3')).toBe(false);
      expect(subgraph.nodes.has('session_4')).toBe(false);
    });

    it('should filter by relationship type', () => {
      // Add a different relationship type
      graph.addEdge({
        id: 'edge_depends',
        type: 'depends_on',
        source: 'session_1',
        target: 'session_3',
        created: '2025-01-03'
      });

      const subgraph = graph.traverse('session_1', {
        depth: 2,
        relationshipTypes: ['follows']
      });

      // Should traverse via 'follows' edges only
      expect(subgraph.edges.every(e => e.type === 'follows')).toBe(true);
    });

    it('should apply node limit', () => {
      const subgraph = graph.traverse('session_1', {
        depth: 3,
        limit: 2
      });

      expect(subgraph.nodes.size).toBeLessThanOrEqual(2);
    });
  });

  describe('Path Finding', () => {
    beforeEach(() => {
      // Create graph with multiple paths
      for (let i = 1; i <= 5; i++) {
        graph.addNode({
          id: `session_${i}`,
          type: 'session',
          created: `2025-01-0${i}`,
          date: `2025-01-0${i}`,
          title: `Session ${i}`,
          summary: `Session ${i}`,
          outcomes: [],
          patterns: []
        });
      }

      // Path 1: session_1 -> session_2 -> session_5
      graph.addEdge({
        id: 'edge_1_2',
        type: 'follows',
        source: 'session_1',
        target: 'session_2',
        created: '2025-01-02'
      });

      graph.addEdge({
        id: 'edge_2_5',
        type: 'follows',
        source: 'session_2',
        target: 'session_5',
        created: '2025-01-05'
      });

      // Path 2: session_1 -> session_3 -> session_4 -> session_5
      graph.addEdge({
        id: 'edge_1_3',
        type: 'depends_on',
        source: 'session_1',
        target: 'session_3',
        created: '2025-01-03'
      });

      graph.addEdge({
        id: 'edge_3_4',
        type: 'follows',
        source: 'session_3',
        target: 'session_4',
        created: '2025-01-04'
      });

      graph.addEdge({
        id: 'edge_4_5',
        type: 'follows',
        source: 'session_4',
        target: 'session_5',
        created: '2025-01-05'
      });
    });

    it('should find shortest path', () => {
      const path = graph.findPath('session_1', 'session_5');

      expect(path).not.toBeNull();
      expect(path!.length).toBe(2); // Shortest is via session_2
      expect(path!.nodes).toEqual(['session_1', 'session_2', 'session_5']);
    });

    it('should return null for non-existent path', () => {
      graph.addNode({
        id: 'session_isolated',
        type: 'session',
        created: '2025-01-06',
        date: '2025-01-06',
        title: 'Isolated',
        summary: 'No connections',
        outcomes: [],
        patterns: []
      });

      const path = graph.findPath('session_1', 'session_isolated');
      expect(path).toBeNull();
    });

    it('should handle same source and target', () => {
      const path = graph.findPath('session_1', 'session_1');

      expect(path).not.toBeNull();
      expect(path!.length).toBe(0);
      expect(path!.nodes).toEqual(['session_1']);
      expect(path!.edges).toHaveLength(0);
    });

    it('should return null for non-existent nodes', () => {
      const path = graph.findPath('nonexistent_1', 'nonexistent_2');
      expect(path).toBeNull();
    });
  });

  describe('Persistence', () => {
    it('should serialize graph to JSON', () => {
      graph.addNode({
        id: 'session_1',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Test',
        summary: 'Test session',
        outcomes: [],
        patterns: []
      });

      graph.addEdge({
        id: 'edge_1',
        type: 'follows',
        source: 'session_1',
        target: 'session_1',
        created: '2025-01-01'
      });

      const json = graph.serialize();
      const parsed = JSON.parse(json);

      expect(parsed.version).toBe('1.0.0');
      expect(parsed.nodes).toHaveProperty('session_1');
      expect(parsed.edges).toHaveLength(1);
      expect(parsed.metadata.nodeCount).toBe(1);
    });

    it('should deserialize graph from JSON', () => {
      const json = JSON.stringify({
        version: '1.0.0',
        nodes: {
          session_1: {
            id: 'session_1',
            type: 'session',
            created: '2025-01-01',
            date: '2025-01-01',
            title: 'Test',
            summary: 'Test session',
            outcomes: [],
            patterns: []
          }
        },
        edges: [{
          id: 'edge_1',
          type: 'follows',
          source: 'session_1',
          target: 'session_1',
          created: '2025-01-01'
        }],
        metadata: {
          created: '2025-01-01',
          updated: '2025-01-01',
          nodeCount: 1,
          edgeCount: 1
        }
      });

      graph.deserialize(json);

      expect(graph.getNode('session_1')).toBeDefined();
      expect(graph.getOutgoingEdges('session_1')).toHaveLength(1);
    });

    it('should save and load graph from disk', () => {
      // Create graph and save
      const graph1 = new TinyGraph(testStoragePath, true);
      graph1.addNode({
        id: 'session_1',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Persisted Session',
        summary: 'Testing persistence',
        outcomes: [],
        patterns: []
      });
      graph1.save();

      // Load into new graph
      const graph2 = new TinyGraph(testStoragePath, false);
      graph2.load();

      const loaded = graph2.getNode('session_1');
      expect(loaded).toBeDefined();
      expect(loaded?.title).toBe('Persisted Session');
    });

    it('should handle loading non-existent file gracefully', () => {
      const graph = new TinyGraph('/nonexistent/path/graph.json', false);
      expect(() => graph.load()).not.toThrow();
    });
  });

  describe('Statistics', () => {
    it('should return accurate statistics', () => {
      // Add 3 sessions
      for (let i = 1; i <= 3; i++) {
        graph.addNode({
          id: `session_${i}`,
          type: 'session',
          created: `2025-01-0${i}`,
          date: `2025-01-0${i}`,
          title: `Session ${i}`,
          summary: `Session ${i}`,
          outcomes: [],
          patterns: []
        });
      }

      // Add 2 patterns
      for (let i = 1; i <= 2; i++) {
        graph.addNode({
          id: `pattern_${i}`,
          type: 'pattern',
          created: '2025-01-01',
          name: `Pattern ${i}`,
          description: `Pattern ${i}`,
          firstSeen: 'session_1',
          occurrences: 1,
          trend: 'recurring'
        });
      }

      // Add 1 decision
      graph.addNode({
        id: 'decision_1',
        type: 'decision',
        created: '2025-01-01',
        sessionId: 'session_1',
        title: 'Test Decision',
        rationale: 'Testing stats',
        expectedImpact: 'None'
      });

      // Add 2 edges
      graph.addEdge({
        id: 'edge_1',
        type: 'follows',
        source: 'session_1',
        target: 'session_2',
        created: '2025-01-02'
      });

      graph.addEdge({
        id: 'edge_2',
        type: 'follows',
        source: 'session_2',
        target: 'session_3',
        created: '2025-01-03'
      });

      const stats = graph.getStats();

      expect(stats.nodeCount).toBe(6);
      expect(stats.edgeCount).toBe(1); // Divided by 2 for bidirectional
      expect(stats.nodesByType.session).toBe(3);
      expect(stats.nodesByType.pattern).toBe(2);
      expect(stats.nodesByType.decision).toBe(1);
      expect(stats.nodesByType.outcome).toBe(0);
    });
  });

  describe('Clear Graph', () => {
    it('should clear all nodes and edges', () => {
      graph.addNode({
        id: 'session_1',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Test',
        summary: 'Test',
        outcomes: [],
        patterns: []
      });

      graph.addEdge({
        id: 'edge_1',
        type: 'follows',
        source: 'session_1',
        target: 'session_1',
        created: '2025-01-01'
      });

      graph.clear();

      const stats = graph.getStats();
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });
  });

  describe('Remove Node', () => {
    it('should remove a node and its edges', () => {
      // Create 3 sessions with edges
      for (let i = 1; i <= 3; i++) {
        graph.addNode({
          id: `session_${i}`,
          type: 'session',
          created: `2025-01-0${i}`,
          date: `2025-01-0${i}`,
          title: `Session ${i}`,
          summary: `Session ${i}`,
          outcomes: [],
          patterns: []
        });
      }

      // session_1 -> session_2 -> session_3
      graph.addEdge({
        id: 'edge_1_2',
        type: 'follows',
        source: 'session_1',
        target: 'session_2',
        created: '2025-01-02'
      });

      graph.addEdge({
        id: 'edge_2_3',
        type: 'follows',
        source: 'session_2',
        target: 'session_3',
        created: '2025-01-03'
      });

      // Remove session_2
      const removed = graph.removeNode('session_2');

      expect(removed).toBe(true);
      expect(graph.getNode('session_2')).toBeUndefined();
      // Edges to/from session_2 should be gone
      expect(graph.getOutgoingEdges('session_1')).toHaveLength(0);
      expect(graph.getIncomingEdges('session_3')).toHaveLength(0);
      // Other nodes still exist
      expect(graph.getNode('session_1')).toBeDefined();
      expect(graph.getNode('session_3')).toBeDefined();
    });

    it('should return false for non-existent node', () => {
      const removed = graph.removeNode('nonexistent');
      expect(removed).toBe(false);
    });

    it('should remove all edges connected to the node', () => {
      // Create a hub-and-spoke pattern: session_1 connected to 2, 3, 4
      for (let i = 1; i <= 4; i++) {
        graph.addNode({
          id: `session_${i}`,
          type: 'session',
          created: `2025-01-0${i}`,
          date: `2025-01-0${i}`,
          title: `Session ${i}`,
          summary: `Session ${i}`,
          outcomes: [],
          patterns: []
        });
      }

      // session_1 -> session_2, session_1 -> session_3, session_4 -> session_1
      graph.addEdge({ id: 'e1', type: 'follows', source: 'session_1', target: 'session_2', created: '2025-01-02' });
      graph.addEdge({ id: 'e2', type: 'follows', source: 'session_1', target: 'session_3', created: '2025-01-03' });
      graph.addEdge({ id: 'e3', type: 'follows', source: 'session_4', target: 'session_1', created: '2025-01-04' });

      // Remove the hub
      graph.removeNode('session_1');

      // All edges should be gone
      expect(graph.getIncomingEdges('session_2')).toHaveLength(0);
      expect(graph.getIncomingEdges('session_3')).toHaveLength(0);
      expect(graph.getOutgoingEdges('session_4')).toHaveLength(0);
    });

    it('should remove pattern/decision nodes created by a session', () => {
      // Session with a pattern
      graph.addNode({
        id: 'session_1',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Session 1',
        summary: 'Session 1',
        outcomes: [],
        patterns: ['oauth']
      });

      graph.addNode({
        id: 'pattern_oauth',
        type: 'pattern',
        created: '2025-01-01',
        name: 'OAuth',
        description: 'OAuth pattern',
        firstSeen: 'session_1',
        occurrences: 1,
        trend: 'recurring'
      });

      graph.addEdge({
        id: 'edge_s1_p1',
        type: 'introduces_pattern',
        source: 'session_1',
        target: 'pattern_oauth',
        created: '2025-01-01'
      });

      // Remove session should NOT auto-remove pattern (pattern may be used by other sessions)
      // But edge should be removed
      graph.removeNode('session_1');

      expect(graph.getNode('session_1')).toBeUndefined();
      expect(graph.getNode('pattern_oauth')).toBeDefined(); // Pattern still exists
      expect(graph.getOutgoingEdges('session_1')).toHaveLength(0);
    });
  });

  describe('Reload Graph', () => {
    it('should reload graph from disk, picking up external changes', () => {
      // Create graph and save
      const graph1 = new TinyGraph(testStoragePath, true);
      graph1.addNode({
        id: 'session_1',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Original Title',
        summary: 'Test session',
        outcomes: [],
        patterns: []
      });
      graph1.save();

      // Modify the file directly (simulating reclassify-graph)
      const graphJson = JSON.parse(fs.readFileSync(testStoragePath, 'utf-8'));
      graphJson.nodes['session_1'].title = 'Modified Title';
      graphJson.nodes['session_1'].type = 'artifact'; // Reclassify
      fs.writeFileSync(testStoragePath, JSON.stringify(graphJson));

      // Reload should pick up changes
      graph1.reload();

      const reloaded = graph1.getNode('session_1');
      expect(reloaded).toBeDefined();
      expect(reloaded?.title).toBe('Modified Title');
      expect(reloaded?.type).toBe('artifact');
    });

    it('should clear in-memory state before reloading', () => {
      const graph1 = new TinyGraph(testStoragePath, true);

      // Add a node only in memory (don't save)
      graph1.addNode({
        id: 'memory_only',
        type: 'session',
        created: '2025-01-01',
        date: '2025-01-01',
        title: 'Memory Only',
        summary: 'Not persisted',
        outcomes: [],
        patterns: []
      });

      // Save a different node to disk
      const graphJson = {
        version: '1.0.0',
        nodes: {
          'disk_node': {
            id: 'disk_node',
            type: 'session',
            created: '2025-01-01',
            date: '2025-01-01',
            title: 'From Disk',
            summary: 'Was on disk',
            outcomes: [],
            patterns: []
          }
        },
        edges: [],
        metadata: { created: '2025-01-01', updated: '2025-01-01', nodeCount: 1, edgeCount: 0 }
      };
      fs.writeFileSync(testStoragePath, JSON.stringify(graphJson));

      // Reload should replace memory state with disk state
      graph1.reload();

      expect(graph1.getNode('memory_only')).toBeUndefined();
      expect(graph1.getNode('disk_node')).toBeDefined();
    });
  });
});
