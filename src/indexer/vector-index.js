#!/usr/bin/env node

/**
 * VectorIndex - Abstraction for vector search backends
 *
 * Implements panel recommendation: pluggable vector providers.
 *
 * Providers:
 * - LinearIndex: Pure JS, no dependencies, works everywhere (default for Node.js)
 * - HnswWasmIndex: WASM-based HNSW, browser environments only
 * - HnswNodeIndex: Native C++ bindings, requires compilation (optional)
 *
 * T1 compliance: LinearIndex satisfies "no native dependencies" requirement.
 * For datasets > 10K documents, consider native hnswlib-node (with compilation).
 *
 * @author Gordo (AI participant)
 * @session S236
 */

/**
 * HNSW implementation using hnswlib-wasm (pure WASM, no native deps)
 */
async function createHnswWasmIndex(config) {
  const { loadHnswlib } = await import('hnswlib-wasm/dist/hnswlib.js');
  const lib = await loadHnswlib();

  const maxElements = config.maxElements || 10000;
  const m = config.m || 16;
  const efConstruction = config.efConstruction || 200;
  const vectorSize = config.vectorSize || 1536;

  let index = null;
  let count = 0;
  let initialized = false;

  return {
    async initialize() {
      if (initialized) return;

      index = new lib.HierarchicalNSW('cosine', vectorSize);
      index.initIndex(maxElements, m, efConstruction, 100);
      index.setEfSearch(32);
      initialized = true;
    },

    async addVector(vector, id) {
      if (!index) throw new Error('Index not initialized');
      index.addPoint(vector, id);
      count++;
    },

    async search(vector, k) {
      if (!index) throw new Error('Index not initialized');
      if (count === 0) return [];

      const result = index.searchKnn(vector, Math.min(k, count));
      const results = [];

      for (let i = 0; i < result.neighbors.length; i++) {
        results.push({
          id: result.neighbors[i],
          distance: result.distances[i]
        });
      }

      return results;
    },

    async save() {
      if (!index) return;

      const filename = 'index.hnsw';
      index.writeIndex(filename);

      try {
        await lib.EmscriptenFileSystemManager.syncFS(false);
      } catch {
        // Sync not available
      }
    },

    async load() {
      if (!index) {
        index = new lib.HierarchicalNSW('cosine', vectorSize);
      }

      try {
        await lib.EmscriptenFileSystemManager.syncFS(true);

        const filename = 'index.hnsw';
        const exists = lib.EmscriptenFileSystemManager.checkFileExists(filename);

        if (exists) {
          index.readIndex(filename, maxElements, true);
          count = index.getCurrentCount();
          initialized = true;
          return true;
        }
      } catch {
        // Load failed
      }

      return false;
    },

    getCount() {
      return count;
    }
  };
}

/**
 * Fallback: Linear scan cosine similarity (for small datasets or when WASM unavailable)
 */
function createLinearIndex(config) {
  const vectors = new Map();

  function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  return {
    async initialize() {},

    async addVector(vector, id) {
      vectors.set(id, vector);
    },

    async search(vector, k) {
      const results = [];

      for (const [id, vec] of vectors) {
        const similarity = cosineSimilarity(vector, vec);
        results.push({ id, distance: 1 - similarity });
      }

      results.sort((a, b) => a.distance - b.distance);
      return results.slice(0, k);
    },

    async save() {},
    async load() { return false; },

    getCount() {
      return vectors.size;
    }
  };
}

module.exports = { createHnswWasmIndex, createLinearIndex };
