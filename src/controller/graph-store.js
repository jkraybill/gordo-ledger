#!/usr/bin/env node

/**
 * Graph Store — Memory Protocol Phase 4
 *
 * Extracts and stores entity relationships for semantic navigation.
 * Complements vector search with explicit edges between concepts.
 *
 * Edge types:
 * - related_to: General semantic relationship
 * - supersedes: Newer information replaces older
 * - references: Citation or pointer
 * - depends_on: Functional dependency
 * - part_of: Hierarchical containment
 * - decided_by: MCAP/DECISIONS governance link
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S234
 */

const fs = require('fs');
const path = require('path');

const GRAPH_FILE = path.join(__dirname, '../.graph-store.json');

// Entity extraction patterns
const ENTITY_PATTERNS = {
  // Session references
  session: /\bS(\d{1,3})\b/g,
  // Issue references
  issue: /#(\d+)\b/g,
  // Tier references
  tier: /\bT([012])\b/g,
  // Protocol references
  protocol: /\b(MCAP|PACT|Panel|UEP)\b/gi,
  // Memory IDs
  memory_id: /\b([CDWA]-[\w-]+)\b/g,
  // Concepts (capitalized multi-word phrases)
  concept: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g,
};

// Relationship extraction patterns
const RELATIONSHIP_PATTERNS = [
  { pattern: /supersedes?\s+(.+?)(?:\.|,|$)/gi, type: 'supersedes' },
  { pattern: /depends?\s+on\s+(.+?)(?:\.|,|$)/gi, type: 'depends_on' },
  { pattern: /part\s+of\s+(.+?)(?:\.|,|$)/gi, type: 'part_of' },
  { pattern: /references?\s+(.+?)(?:\.|,|$)/gi, type: 'references' },
  { pattern: /decided\s+(?:by|via|in)\s+(.+?)(?:\.|,|$)/gi, type: 'decided_by' },
  { pattern: /see\s+(?:also\s+)?(.+?)(?:\.|,|$)/gi, type: 'related_to' },
];

class GraphStore {
  constructor(options = {}) {
    this.graphFile = options.graphFile || GRAPH_FILE;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.graphFile)) {
        this.graph = JSON.parse(fs.readFileSync(this.graphFile, 'utf8'));
      } else {
        this.graph = {
          entities: {},
          edges: [],
          meta: { created_at: new Date().toISOString() },
        };
      }
    } catch {
      this.graph = {
        entities: {},
        edges: [],
        meta: { created_at: new Date().toISOString() },
      };
    }
  }

  _save() {
    this.graph.meta.updated_at = new Date().toISOString();
    fs.writeFileSync(this.graphFile, JSON.stringify(this.graph, null, 2));
  }

  /**
   * Extract entities from text
   */
  extractEntities(text) {
    const entities = [];

    for (const [type, pattern] of Object.entries(ENTITY_PATTERNS)) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(text)) !== null) {
        const value = type === 'session' ? `S${match[1]}` :
                      type === 'issue' ? `#${match[1]}` :
                      type === 'tier' ? `T${match[1]}` :
                      match[1] || match[0];

        if (!entities.find(e => e.type === type && e.value === value)) {
          entities.push({ type, value, position: match.index });
        }
      }
    }

    return entities;
  }

  /**
   * Extract relationships from text
   */
  extractRelationships(text, sourceEntity) {
    const relationships = [];

    for (const { pattern, type } of RELATIONSHIP_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      while ((match = regex.exec(text)) !== null) {
        const target = match[1].trim();
        if (target && target.length < 100) {
          relationships.push({
            from: sourceEntity,
            to: target,
            type,
            position: match.index,
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Add an entity to the graph
   */
  addEntity(value, options = {}) {
    const { type = 'concept', source, session } = options;
    const id = this._normalizeEntityId(value);

    if (!this.graph.entities[id]) {
      this.graph.entities[id] = {
        id,
        value,
        type,
        first_seen: new Date().toISOString(),
        sources: [],
        mention_count: 0,
      };
    }

    this.graph.entities[id].mention_count++;
    this.graph.entities[id].last_seen = new Date().toISOString();

    if (source && !this.graph.entities[id].sources.includes(source)) {
      this.graph.entities[id].sources.push(source);
    }

    this._save();
    return id;
  }

  _normalizeEntityId(value) {
    return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 50);
  }

  /**
   * Add an edge between entities
   */
  addEdge(from, to, type, options = {}) {
    const { confidence = 1.0, source, session } = options;

    const fromId = this._normalizeEntityId(from);
    const toId = this._normalizeEntityId(to);

    // Ensure entities exist
    if (!this.graph.entities[fromId]) {
      this.addEntity(from);
    }
    if (!this.graph.entities[toId]) {
      this.addEntity(to);
    }

    // Check for existing edge
    const existing = this.graph.edges.find(
      e => e.from === fromId && e.to === toId && e.type === type
    );

    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      existing.last_seen = new Date().toISOString();
      if (source && !existing.sources.includes(source)) {
        existing.sources.push(source);
      }
    } else {
      this.graph.edges.push({
        from: fromId,
        to: toId,
        type,
        confidence,
        sources: source ? [source] : [],
        created_at: new Date().toISOString(),
        last_seen: new Date().toISOString(),
      });
    }

    this._save();
    return { from: fromId, to: toId, type };
  }

  /**
   * Process text and extract entities + relationships
   */
  processText(text, options = {}) {
    const { source, session } = options;
    const entities = this.extractEntities(text);
    const added = [];

    // Add entities
    for (const entity of entities) {
      const id = this.addEntity(entity.value, {
        type: entity.type,
        source,
        session,
      });
      added.push({ id, ...entity });
    }

    // Extract and add relationships
    const relationships = this.extractRelationships(text, source || 'unknown');
    for (const rel of relationships) {
      this.addEdge(rel.from, rel.to, rel.type, { source, session });
    }

    // Add implicit relationships between co-occurring entities
    if (entities.length > 1) {
      for (let i = 0; i < entities.length - 1; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          // Only link if they're close in text (within 200 chars)
          if (Math.abs(entities[i].position - entities[j].position) < 200) {
            this.addEdge(
              entities[i].value,
              entities[j].value,
              'related_to',
              { confidence: 0.5, source, session }
            );
          }
        }
      }
    }

    return { entities: added, relationships };
  }

  /**
   * Find entities related to a given entity
   */
  findRelated(entityValue, options = {}) {
    const { depth = 1, types = null } = options;
    const id = this._normalizeEntityId(entityValue);

    const related = new Set();
    const visited = new Set([id]);
    const queue = [{ id, depth: 0 }];

    while (queue.length > 0) {
      const { id: currentId, depth: currentDepth } = queue.shift();

      if (currentDepth >= depth) continue;

      // Find edges from this entity
      const outgoing = this.graph.edges.filter(e => e.from === currentId);
      const incoming = this.graph.edges.filter(e => e.to === currentId);

      for (const edge of [...outgoing, ...incoming]) {
        const otherId = edge.from === currentId ? edge.to : edge.from;

        if (!types || types.includes(edge.type)) {
          const entity = this.graph.entities[otherId];
          if (entity) {
            related.add(JSON.stringify({
              id: otherId,
              value: entity.value,
              type: entity.type,
              edge_type: edge.type,
              confidence: edge.confidence,
            }));

            if (!visited.has(otherId)) {
              visited.add(otherId);
              queue.push({ id: otherId, depth: currentDepth + 1 });
            }
          }
        }
      }
    }

    return Array.from(related).map(s => JSON.parse(s));
  }

  /**
   * Get statistics about the graph
   */
  stats() {
    const edgesByType = {};
    for (const edge of this.graph.edges) {
      edgesByType[edge.type] = (edgesByType[edge.type] || 0) + 1;
    }

    const entityByType = {};
    for (const entity of Object.values(this.graph.entities)) {
      entityByType[entity.type] = (entityByType[entity.type] || 0) + 1;
    }

    return {
      entities: Object.keys(this.graph.entities).length,
      edges: this.graph.edges.length,
      entities_by_type: entityByType,
      edges_by_type: edgesByType,
      created_at: this.graph.meta.created_at,
      updated_at: this.graph.meta.updated_at,
    };
  }

  /**
   * Find shortest path between two entities
   */
  findPath(fromValue, toValue) {
    const fromId = this._normalizeEntityId(fromValue);
    const toId = this._normalizeEntityId(toValue);

    if (!this.graph.entities[fromId] || !this.graph.entities[toId]) {
      return null;
    }

    const visited = new Set();
    const queue = [[fromId]];

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      if (current === toId) {
        return path.map(id => this.graph.entities[id]?.value || id);
      }

      if (visited.has(current)) continue;
      visited.add(current);

      const neighbors = this.graph.edges
        .filter(e => e.from === current || e.to === current)
        .map(e => e.from === current ? e.to : e.from)
        .filter(n => !visited.has(n));

      for (const neighbor of neighbors) {
        queue.push([...path, neighbor]);
      }
    }

    return null;
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const store = new GraphStore();

  switch (args[0]) {
    case 'process':
      if (args[1]) {
        const text = args.slice(1).join(' ');
        const result = store.processText(text, { source: 'cli', session: 'manual' });
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Usage: graph-store.js process <text>');
      }
      break;

    case 'related':
      if (args[1]) {
        const related = store.findRelated(args[1], { depth: parseInt(args[2]) || 1 });
        console.log('\nRelated Entities\n');
        for (const r of related) {
          console.log(`[${r.type}] ${r.value} (${r.edge_type}, ${r.confidence.toFixed(2)})`);
        }
      }
      break;

    case 'path':
      if (args[1] && args[2]) {
        const path = store.findPath(args[1], args[2]);
        console.log('\nPath:', path ? path.join(' → ') : 'No path found');
      }
      break;

    case 'stats':
      const stats = store.stats();
      console.log('\nGraph Statistics\n');
      console.log(`Entities: ${stats.entities}`);
      console.log(`Edges: ${stats.edges}`);
      if (Object.keys(stats.entities_by_type).length > 0) {
        console.log('\nEntities by type:');
        for (const [type, count] of Object.entries(stats.entities_by_type)) {
          console.log(`  ${type}: ${count}`);
        }
      }
      if (Object.keys(stats.edges_by_type).length > 0) {
        console.log('\nEdges by type:');
        for (const [type, count] of Object.entries(stats.edges_by_type)) {
          console.log(`  ${type}: ${count}`);
        }
      }
      break;

    default:
      console.log(`
Graph Store — Memory Protocol Phase 4

Commands:
  process <text>          Extract entities and relationships from text
  related <entity> [depth] Find related entities
  path <from> <to>        Find shortest path between entities
  stats                   Graph statistics

Examples:
  graph-store.js process "S234 decided via MCAP that Tool Sovereignty is T0"
  graph-store.js related "Tool Sovereignty"
  graph-store.js path "MCAP" "Panel"
`);
  }
}

module.exports = GraphStore;
