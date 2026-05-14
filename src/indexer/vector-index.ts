/**
 * VectorIndex - Abstraction for vector search backends
 *
 * Implements panel recommendation: pluggable vector providers.
 * Default: hnswlib-wasm (pure WASM, no native deps)
 *
 * @author Gordo (AI participant)
 * @session S236
 */

export interface VectorIndexConfig {
  indexPath: string;
  vectorSize: number;
  maxElements?: number;
  m?: number;
  efConstruction?: number;
}

export interface SearchResult {
  id: number;
  distance: number;
}

export interface VectorIndex {
  initialize(): Promise<void>;
  addVector(vector: number[], id: number): Promise<void>;
  search(vector: number[], k: number): Promise<SearchResult[]>;
  save(): Promise<void>;
  load(): Promise<boolean>;
  getCount(): number;
}

/**
 * HNSW implementation using hnswlib-wasm (pure WASM, no native deps)
 */
export async function createHnswWasmIndex(config: VectorIndexConfig): Promise<VectorIndex> {
  const { loadHnswlib } = await import('hnswlib-wasm');
  const lib = await loadHnswlib();

  const maxElements = config.maxElements || 10000;
  const m = config.m || 16;
  const efConstruction = config.efConstruction || 200;

  let index: any = null;
  let count = 0;
  let initialized = false;

  return {
    async initialize(): Promise<void> {
      if (initialized) return;

      index = new lib.HierarchicalNSW('cosine', config.vectorSize);
      index.initIndex(maxElements, m, efConstruction, 100);
      index.setEfSearch(32);
      initialized = true;
    },

    async addVector(vector: number[], id: number): Promise<void> {
      if (!index) throw new Error('Index not initialized');
      index.addPoint(vector, id);
      count++;
    },

    async search(vector: number[], k: number): Promise<SearchResult[]> {
      if (!index) throw new Error('Index not initialized');
      if (count === 0) return [];

      const result = index.searchKnn(vector, Math.min(k, count));
      const results: SearchResult[] = [];

      for (let i = 0; i < result.neighbors.length; i++) {
        results.push({
          id: result.neighbors[i],
          distance: result.distances[i]
        });
      }

      return results;
    },

    async save(): Promise<void> {
      if (!index) return;

      // hnswlib-wasm uses Emscripten FS
      const filename = 'index.hnsw';
      index.writeIndex(filename);

      // Sync to persistent storage if available
      try {
        await lib.EmscriptenFileSystemManager.syncFS(false);
      } catch {
        // Sync not available (Node.js without IDBFS)
      }
    },

    async load(): Promise<boolean> {
      if (!index) {
        index = new lib.HierarchicalNSW('cosine', config.vectorSize);
      }

      try {
        // Sync from persistent storage
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

    getCount(): number {
      return count;
    }
  };
}

/**
 * Fallback: Linear scan cosine similarity (for small datasets or when WASM unavailable)
 */
export function createLinearIndex(config: VectorIndexConfig): VectorIndex {
  const vectors: Map<number, number[]> = new Map();

  function cosineSimilarity(a: number[], b: number[]): number {
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
    async initialize(): Promise<void> {},

    async addVector(vector: number[], id: number): Promise<void> {
      vectors.set(id, vector);
    },

    async search(vector: number[], k: number): Promise<SearchResult[]> {
      const results: SearchResult[] = [];

      for (const [id, vec] of vectors) {
        const similarity = cosineSimilarity(vector, vec);
        results.push({ id, distance: 1 - similarity });
      }

      results.sort((a, b) => a.distance - b.distance);
      return results.slice(0, k);
    },

    async save(): Promise<void> {},
    async load(): Promise<boolean> { return false; },

    getCount(): number {
      return vectors.size;
    }
  };
}
