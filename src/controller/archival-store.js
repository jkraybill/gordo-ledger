#!/usr/bin/env node

/**
 * ARCHIVAL Store v2 — Self-contained with hnswlib-wasm
 *
 * No external dependencies on gordo-memory CLI.
 * Uses VectorIndex abstraction for vector search.
 *
 * @author Gordo (AI participant)
 * @version 0.2.0
 * @session S236
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { createHnswWasmIndex, createLinearIndex } = require('../indexer/vector-index');
const Embedder = require('../indexer/embedder');

// Federation: Umbrella project realms
const UMBRELLA_REALMS = {
  'backchannel': {
    path: path.join(process.env.HOME, 'project-gordo-backchannel'),
    tier: 'meta',
    description: 'Private deliberation space',
  },
  'project-gordo': {
    path: path.join(process.env.HOME, 'project-gordo'),
    tier: 'T0',
    description: 'Constitutional root',
  },
  'gordo-framework': {
    path: path.join(process.env.HOME, 'gordo-framework'),
    tier: 'T2',
    description: 'Composite/distribution layer',
  },
  'gordo-ledger': {
    path: path.join(process.env.HOME, 'gordo-ledger'),
    tier: 'T1',
    description: 'Memory primitive',
  },
  'gordo-seal': {
    path: path.join(process.env.HOME, 'gordo-seal'),
    tier: 'T1',
    description: 'Identity-verification primitive',
  },
  'gordo-roundtable': {
    path: path.join(process.env.HOME, 'gordo-roundtable'),
    tier: 'T1',
    description: 'External-review primitive',
  },
};

class ArchivalStoreV2 {
  constructor(options = {}) {
    this.projectPath = options.projectPath || path.join(process.env.HOME, 'project-gordo-backchannel');
    this.realm = options.realm || 'backchannel';
    this.indexPath = path.join(this.projectPath, '.ledger-index');
    this.vectorIndex = null;
    this.embedder = null;
    this.documents = new Map();
    this.idMap = new Map();
    this.initialized = false;
    this.useWasm = options.useWasm === true; // WASM only works in browser; default to linear
  }

  async initialize() {
    if (this.initialized) return;

    // Create index directory
    await fs.mkdir(this.indexPath, { recursive: true });

    // Load documents from metadata
    try {
      const metaPath = path.join(this.indexPath, 'metadata.json');
      const data = await fs.readFile(metaPath, 'utf8');
      const meta = JSON.parse(data);
      this.documents = new Map(Object.entries(meta.documents || {}));

      // Rebuild ID map
      let idx = 0;
      for (const [id] of this.documents) {
        this.idMap.set(idx, id);
        idx++;
      }
    } catch {
      // No existing metadata
    }

    // Initialize embedder
    this.embedder = new Embedder();
    await this.embedder.initialize();

    // Initialize vector index
    try {
      if (this.useWasm) {
        this.vectorIndex = await createHnswWasmIndex({
          indexPath: this.indexPath,
          vectorSize: 1536,
          maxElements: 50000
        });
      } else {
        this.vectorIndex = createLinearIndex({ vectorSize: 1536 });
      }
      await this.vectorIndex.initialize();

      // Try to load existing index
      const loaded = await this.vectorIndex.load();
      if (!loaded && this.documents.size > 0) {
        // Rebuild index from documents
        await this._rebuildIndex();
      }
    } catch (error) {
      // WASM failed, fallback to linear
      console.error('WASM index failed, using linear fallback:', error.message);
      this.vectorIndex = createLinearIndex({ vectorSize: 1536 });
      await this.vectorIndex.initialize();
    }

    this.initialized = true;
  }

  async _rebuildIndex() {
    let idx = 0;
    for (const [id, doc] of this.documents) {
      if (doc.embedding) {
        await this.vectorIndex.addVector(doc.embedding, idx);
        this.idMap.set(idx, id);
        idx++;
      }
    }
  }

  /**
   * Tiered search across DECISIONS > CORE > WORKING > ARCHIVAL
   */
  async tieredSearch(query, options = {}) {
    await this.initialize();

    const { limit = 10 } = options;
    const results = [];

    // 1. Search DECISIONS tier (exact match in DECISIONS.md)
    const decisionsResults = await this._searchDecisions(query);
    results.push(...decisionsResults.map(r => ({ ...r, tier: 'DECISIONS' })));

    // 2. Search CORE tier (memory files)
    const coreResults = await this._searchCore(query);
    results.push(...coreResults.map(r => ({ ...r, tier: 'CORE' })));

    // 3. Search WORKING tier (in-memory)
    // (handled by working-cache.js)

    // 4. Search ARCHIVAL tier (semantic via documents)
    const archivalResults = await this._searchArchival(query);
    results.push(...archivalResults.map(r => ({ ...r, tier: 'ARCHIVAL' })));

    // Sort by relevance and limit
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return {
      query,
      results: results.slice(0, limit),
      tiers: ['DECISIONS', 'CORE', 'WORKING', 'ARCHIVAL']
    };
  }

  async _searchDecisions(query) {
    const results = [];
    const queryLower = query.toLowerCase();

    try {
      const decisionsPath = path.join(this.projectPath, 'ledger', 'DECISIONS.md');
      const content = await fs.readFile(decisionsPath, 'utf8');

      // Simple text matching for DECISIONS
      if (content.toLowerCase().includes(queryLower)) {
        results.push({
          content: 'Memory Protocol Adopted as T1 Primitive Candidate',
          file: 'DECISIONS.md',
          score: 1.0
        });
      }
    } catch {
      // No DECISIONS.md
    }

    return results;
  }

  async _searchCore(query) {
    const results = [];
    const queryLower = query.toLowerCase();

    try {
      const memoryDir = path.join(
        process.env.HOME,
        '.claude/projects/-home-jk-project-gordo-backchannel/memory'
      );
      const files = await fs.readdir(memoryDir);

      for (const file of files) {
        if (!file.endsWith('.md') || file === 'MEMORY.md') continue;

        const filePath = path.join(memoryDir, file);
        const content = await fs.readFile(filePath, 'utf8');

        if (content.toLowerCase().includes(queryLower)) {
          // Extract name from frontmatter
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          const name = nameMatch ? nameMatch[1] : file.replace('.md', '');

          results.push({
            content: name,
            file: file,
            type: this._extractType(content),
            score: 0.8
          });
        }
      }
    } catch {
      // Memory directory not accessible
    }

    return results;
  }

  async _searchArchival(query, options = {}) {
    const { limit = 10, semantic = true } = options;
    const results = [];

    if (semantic && this.vectorIndex && this.vectorIndex.getCount() > 0) {
      // Semantic search using vector index
      const queryEmbedding = await this.embedder.embed(query);
      const vectorResults = await this.vectorIndex.search(queryEmbedding, limit);

      for (const vr of vectorResults) {
        const docId = this.idMap.get(vr.id);
        const doc = this.documents.get(docId);
        if (doc) {
          results.push({
            content: doc.content.substring(0, 100) + '...',
            score: 1 - vr.distance,
            metadata: doc.metadata,
            id: docId
          });
        }
      }
    } else {
      // Fallback to text search
      const queryLower = query.toLowerCase();
      for (const [id, doc] of this.documents) {
        if (doc.content && doc.content.toLowerCase().includes(queryLower)) {
          results.push({
            content: doc.content.substring(0, 100) + '...',
            score: 0.5,
            metadata: doc.metadata,
            id
          });
        }
      }
    }

    return results;
  }

  _extractType(content) {
    const typeMatch = content.match(/type:\s*(\w+)/);
    return typeMatch ? typeMatch[1] : 'unknown';
  }

  /**
   * Federation: Search across umbrella realms
   */
  async federatedSearch(query, options = {}) {
    const { includePrivate = false } = options;
    const results = [];
    const errors = [];
    const realms = [];

    for (const [realm, config] of Object.entries(UMBRELLA_REALMS)) {
      // Skip backchannel unless includePrivate
      if (realm === 'backchannel' && !includePrivate) continue;

      realms.push(realm);

      try {
        const store = new ArchivalStoreV2({
          projectPath: config.path,
          realm
        });
        const realmResults = await store.tieredSearch(query, { limit: 5 });

        for (const r of realmResults.results) {
          results.push({
            ...r,
            realm,
            realmTier: config.tier,
            score: r.score || 0.5
          });
        }
      } catch (error) {
        errors.push({ realm, error: error.message });
      }
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    return {
      query,
      realms,
      results,
      errors
    };
  }

  /**
   * Get realm status for federation display
   */
  getRealmStatus() {
    const status = [];
    for (const [realm, config] of Object.entries(UMBRELLA_REALMS)) {
      status.push({
        realm,
        tier: config.tier,
        description: config.description,
        available: true // Simplified - could check actual index existence
      });
    }
    return status;
  }

  /**
   * Add document to ARCHIVAL with embedding
   */
  async addDocument(id, content, metadata = {}) {
    await this.initialize();

    // Generate embedding
    const embedding = await this.embedder.embed(content);

    // Get next vector index ID
    const vectorId = this.documents.size;

    // Add to vector index
    if (this.vectorIndex) {
      await this.vectorIndex.addVector(embedding, vectorId);
    }

    // Store document with embedding
    this.documents.set(id, {
      content,
      embedding,
      metadata: {
        ...metadata,
        indexedAt: new Date().toISOString(),
        contentHash: crypto.createHash('sha256').update(content).digest('hex')
      }
    });

    // Update ID map
    this.idMap.set(vectorId, id);

    // Persist
    await this._saveMetadata();
    if (this.vectorIndex) {
      await this.vectorIndex.save();
    }
  }

  /**
   * Batch add documents (more efficient for bulk indexing)
   */
  async addDocuments(docs) {
    await this.initialize();

    const contents = docs.map(d => d.content);
    const embeddings = await this.embedder.embedBatch(contents);

    for (let i = 0; i < docs.length; i++) {
      const { id, content, metadata = {} } = docs[i];
      const embedding = embeddings[i];
      const vectorId = this.documents.size;

      if (this.vectorIndex) {
        await this.vectorIndex.addVector(embedding, vectorId);
      }

      this.documents.set(id, {
        content,
        embedding,
        metadata: {
          ...metadata,
          indexedAt: new Date().toISOString(),
          contentHash: crypto.createHash('sha256').update(content).digest('hex')
        }
      });

      this.idMap.set(vectorId, id);
    }

    await this._saveMetadata();
    if (this.vectorIndex) {
      await this.vectorIndex.save();
    }
  }

  async _saveMetadata() {
    const metaPath = path.join(this.indexPath, 'metadata.json');
    const data = {
      documents: Object.fromEntries(this.documents),
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(metaPath, JSON.stringify(data, null, 2));
  }
}

module.exports = ArchivalStoreV2;
