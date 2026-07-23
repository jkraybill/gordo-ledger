/**
 * HNSW Indexer Implementation (Session 34 - TDD approach)
 * Dynamic hybrid search with hnswlib-node (Session 58 - #108)
 *
 * Architecture decision: Embedded mode (no server required)
 * - hnswlib-node for dense vector search (HNSW algorithm)
 * - Manual BM25 implementation for keyword scoring
 * - Dynamic hybrid merge (Session 58 - #108):
 *   * Short queries (≤2 words): 0.3 dense + 0.7 BM25 (favor keyword)
 *   * Longer queries (>2 words): 0.7 dense + 0.3 BM25 (favor semantic)
 *
 * Rationale: User experience > implementation complexity
 * - No Docker/server needed (vs Qdrant server mode)
 * - Self-contained (npm install → works)
 * - Local-first (matches framework philosophy)
 * - Dynamic weighting improves single-word query quality
 */

import hnswlib from 'hnswlib-node';
const { HierarchicalNSW } = hnswlib;
import { SessionEntry, SessionSignals } from '../types.js';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import readline from 'readline';
import path from 'path';
import { createHash } from 'crypto';

export interface HNSWConfig {
  indexPath: string;
  vectorSize: number;
  maxElements?: number;
  m?: number; // HNSW parameter: number of bi-directional links
  efConstruction?: number; // HNSW parameter: size of dynamic candidate list
}

export interface SearchFilters {
  dateRange?: { start: string; end: string };
  signals?: Partial<SessionSignals>;
  hasPatterns?: boolean;
  hasCode?: boolean;
  hasLinks?: boolean;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  similarity: number;
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  date: string;
  summary?: string;
  patterns?: string[];
  issues?: string[];
  signals: SessionSignals;
  wordCount: number;
  hasCode: boolean;
  hasLinks: boolean;
  contentType?: 'session' | 'issue' | 'commit' | 'code' | 'docs' | 'conversation' | 'memory';  // Fix #138, #4, S337
  // SHA-256 of session content. Used by incremental indexing to detect
  // content updates (e.g., EOS narrative appended to an existing session
  // entry) and trigger reindex. Optional for backward compat with indexes
  // built before this field existed.
  contentHash?: string;
}

interface DocumentStore {
  [id: string]: {
    content: string;
    metadata: SessionMetadata;
  };
}

interface BM25Index {
  documents: Map<string, string[]>; // id -> tokenized content
  documentFrequency: Map<string, number>; // term -> number of docs containing term
  documentLengths: Map<string, number>; // id -> doc length
  avgDocLength: number;
  numDocuments: number;
}

export function createHNSWIndexer(config: HNSWConfig) {
  const maxElements = config.maxElements || 10000;
  const m = config.m || 16; // HNSW parameter
  const efConstruction = config.efConstruction || 200; // HNSW parameter

  let index: InstanceType<typeof HierarchicalNSW> | null = null;
  let documentStore: DocumentStore = {};
  let bm25Index: BM25Index = {
    documents: new Map(),
    documentFrequency: new Map(),
    documentLengths: new Map(),
    avgDocLength: 0,
    numDocuments: 0
  };
  let idToIndex: Map<string, number> = new Map();
  let indexToId: Map<number, string> = new Map();
  let nextIndex = 0;
  let initialized = false;
  let lastLoadTime = 0; // Track when we last loaded from disk

  // Helper: Check if disk has newer data and reload if needed
  async function checkAndReloadIfStale(): Promise<void> {
    if (!initialized) return;

    const metadataFile = path.join(config.indexPath, 'metadata.json');
    try {
      const stat = await fs.stat(metadataFile);
      const diskMtime = stat.mtimeMs;

      if (diskMtime > lastLoadTime) {
        // Disk is newer - reload
        initialized = false; // Force re-init
        await actualInitialize();
      }
    } catch {
      // File doesn't exist or can't stat - ignore
    }
  }

  // The actual initialization logic (extracted for reuse)
  async function actualInitialize(): Promise<void> {
    if (initialized) return;

    try {
      const indexFile = path.join(config.indexPath, 'index.hnsw');
      const metadataFile = path.join(config.indexPath, 'metadata.json');

      try {
        await fs.access(indexFile);
        await fs.access(metadataFile);

        // Load existing index
        index = new HierarchicalNSW('cosine', config.vectorSize);
        index.readIndexSync(indexFile);

        // Load metadata
        const metadataContent = await fs.readFile(metadataFile, 'utf-8');
        const metadata = JSON.parse(metadataContent);

        // S463: fail loudly on formats newer than this build understands.
        // Without this, unknown formats fall into the catch below, which
        // silently builds an EMPTY index — and a subsequent index run would
        // re-embed everything and persist an older format over good data.
        const SUPPORTED_FORMAT = 3;
        if ((metadata.formatVersion || 1) > SUPPORTED_FORMAT) {
          throw new Error(`metadata.json formatVersion ${metadata.formatVersion} exceeds supported ${SUPPORTED_FORMAT} — rebuild/upgrade gordo-ledger (mcp/dist is stale)`);
        }

        documentStore = metadata.documentStore;
        idToIndex = new Map(Object.entries(metadata.idToIndex).map(([k, v]) => [k, v as number]));
        indexToId = new Map(Object.entries(metadata.indexToId).map(([k, v]) => [Number(k), v as string]));
        nextIndex = metadata.nextIndex;

        // S463 (#14 phase 2, formatVersion 3): document content lives in
        // content.jsonl — one {id, content} record per line — streamed here
        // line-by-line instead of arriving as part of one giant JSON parse.
        // metadata.json carries only doc metadata + id maps. v1/v2 files have
        // content inline in documentStore and skip this hydration.
        if (metadata.formatVersion >= 3) {
          const contentFile = path.join(config.indexPath, 'content.jsonl');
          const contentById = new Map<string, string>();
          const rl = readline.createInterface({
            input: createReadStream(contentFile, { encoding: 'utf-8' }),
            crlfDelay: Infinity
          });
          for await (const line of rl) {
            if (!line) continue;
            const rec = JSON.parse(line);
            contentById.set(rec.id, rec.content);
          }
          const missing: string[] = [];
          for (const [docId, doc] of Object.entries(documentStore)) {
            const content = contentById.get(docId);
            if (content === undefined) {
              // Metadata without content is a broken pair. Hydrate empty and
              // clear the stored contentHash so the incremental content-compare
              // sees a mismatch and re-indexes this doc (self-heal). Loud, not
              // silent: an instrument that can't show red can't be trusted.
              (doc as { content: string }).content = '';
              delete (doc as { metadata: { contentHash?: string } }).metadata.contentHash;
              missing.push(docId);
            } else {
              (doc as { content: string }).content = content;
            }
          }
          if (missing.length > 0) {
            console.error(`hnsw-indexer: ${missing.length} doc(s) missing from content.jsonl, hydrated empty + queued for reindex: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);
          }
        }

        // S463 (#14 phase 1, formatVersion 2): BM25 state is derived, not persisted —
        // token arrays were the single largest component of metadata.json (97MB of
        // 184MB compact on the backchannel hub). Rebuild from documentStore with the
        // same updateBM25Index used at add-time, which yields identical state.
        // Legacy (v1) files still carry a bm25Index; it is ignored for the same reason.
        // Reset first: actualInitialize re-runs on stale-reload, and updateBM25Index
        // increments documentFrequency — rebuilding into live maps would double-count.
        bm25Index = {
          documents: new Map(),
          documentFrequency: new Map(),
          documentLengths: new Map(),
          avgDocLength: 0,
          numDocuments: 0
        };
        for (const [docId, doc] of Object.entries(documentStore)) {
          updateBM25Index(docId, (doc as { content: string }).content);
        }

        // Track load time
        const stat = await fs.stat(metadataFile);
        lastLoadTime = stat.mtimeMs;
      } catch (e) {
        // Format-version errors must escape — falling through to a fresh empty
        // index is exactly the failure the guard exists to prevent (S463).
        if (e instanceof Error && e.message.includes('formatVersion')) {
          throw e;
        }
        // Create new index
        await fs.mkdir(config.indexPath, { recursive: true });
        index = new HierarchicalNSW('cosine', config.vectorSize);
        index.initIndex(maxElements, m, efConstruction);
        lastLoadTime = Date.now();
      }

      initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize HNSW index: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    async initialize(): Promise<void> {
      await actualInitialize();
    },

    async getStatus() {
      return {
        initialized,
        documentCount: nextIndex,
        indexPath: config.indexPath
      };
    },

    async addDocument(session: SessionEntry, embedding: number[]): Promise<void> {
      if (!index) throw new Error('Index not initialized');

      // Skip if document already indexed (prevents duplicate vectors)
      if (idToIndex.has(session.id)) {
        return;
      }

      const metadata = extractMetadata(session);
      const docIndex = nextIndex++;

      // Add to HNSW index
      index.addPoint(embedding, docIndex);

      // Add to document store
      documentStore[session.id] = {
        content: session.content,
        metadata
      };

      // Update mappings
      idToIndex.set(session.id, docIndex);
      indexToId.set(docIndex, session.id);

      // Update BM25 index
      updateBM25Index(session.id, session.content);

      // Persist
      await persist();
    },

    async addDocuments(
      sessions: SessionEntry[],
      embeddings: number[][],
      onProgress?: (current: number, total: number, phase: string) => void
    ): Promise<void> {
      if (!index) throw new Error('Index not initialized');
      if (sessions.length !== embeddings.length) {
        throw new Error('Sessions and embeddings arrays must have same length');
      }

      const total = sessions.length;
      let added = 0;

      for (let i = 0; i < total; i++) {
        const session = sessions[i];
        const embedding = embeddings[i];

        // Skip if document already indexed (prevents duplicate vectors)
        if (idToIndex.has(session.id)) {
          continue;
        }

        const metadata = extractMetadata(session);
        const docIndex = nextIndex++;

        // Add to HNSW index
        index.addPoint(embedding, docIndex);

        // Add to document store
        documentStore[session.id] = {
          content: session.content,
          metadata
        };

        // Update mappings
        idToIndex.set(session.id, docIndex);
        indexToId.set(docIndex, session.id);

        // Update BM25 index
        updateBM25Index(session.id, session.content);

        added++;

        // Report progress every 10 documents or at completion
        if (onProgress && (added % 10 === 0 || i === total - 1)) {
          onProgress(i + 1, total, 'Adding to vector index...');
        }
      }

      // Persist once at the end (not per-document!)
      if (added > 0) {
        onProgress?.(total, total, 'Persisting index to disk...');
        await persist();
      }
    },

    async getDocument(id: string): Promise<(SessionEntry & { metadata: SessionMetadata }) | null> {
      await checkAndReloadIfStale(); // Auto-reload if disk has newer data
      const doc = documentStore[id];
      if (!doc) return null;

      return {
        id,
        content: doc.content,
        date: doc.metadata.date,
        summary: doc.metadata.summary,
        patterns: doc.metadata.patterns,
        issues: doc.metadata.issues,
        signals: doc.metadata.signals,
        metadata: doc.metadata
      };
    },

    async hybridSearch(
      queryEmbedding: number[],
      queryText: string,
      limit: number,
      threshold?: number,
      filters?: SearchFilters
    ): Promise<SearchResult[]> {
      await checkAndReloadIfStale(); // Auto-reload if disk has newer data
      if (!index) throw new Error('Index not initialized');

      // Dense search with HNSW
      const k = Math.min(limit * 3, nextIndex); // Retrieve more candidates for reranking
      if (k === 0) return [];

      const { neighbors, distances } = index.searchKnn(queryEmbedding, k);

      // Convert distances to similarity scores (cosine: 1 - distance)
      const denseCandidates = neighbors.map((docIndex, i) => {
        const id = indexToId.get(docIndex);
        if (!id) return null;

        const doc = documentStore[id];
        if (!doc) return null;

        const denseScore = 1 - distances[i]; // cosine similarity
        return { id, doc, denseScore, docIndex };
      }).filter(c => c !== null);

      // BM25 sparse search
      const queryTokens = tokenize(queryText);
      const bm25Scores = computeBM25Scores(queryTokens);

      // Dynamic hybrid weighting based on query length (#108, S349 sweep)
      // Short queries (≤3 words): Favor BM25 keyword matching (0.3 dense + 0.7 BM25)
      // Longer queries (>3 words): Favor semantic dense search (0.7 dense + 0.3 BM25)
      const queryWords = queryTokens.length;
      const denseWeight = queryWords <= 3 ? 0.3 : 0.7;
      const bm25Weight = queryWords <= 3 ? 0.7 : 0.3;

      // Hybrid merge with dynamic weighting
      const denseIdSet = new Set(denseCandidates.map(c => c!.id));

      const hybridResults = denseCandidates.map(candidate => {
        const bm25Score = bm25Scores.get(candidate!.id) || 0;
        const normalizedBM25 = normalizeBM25(bm25Score); // Normalize to [0, 1]
        const hybridScore = denseWeight * candidate!.denseScore + bm25Weight * normalizedBM25;

        // Fix #138: Apply hierarchical content weighting boost
        const contentType = candidate!.doc.metadata.contentType;
        const boost = getContentTypeBoost(contentType);
        const boostedScore = hybridScore * boost;

        return {
          id: candidate!.id,
          content: candidate!.doc.content,
          score: boostedScore,
          similarity: hybridScore,
          metadata: candidate!.doc.metadata
        };
      });

      // S435: Add high-scoring BM25 docs that weren't in dense candidates
      // This ensures keyword-heavy matches don't get lost when embeddings diverge
      const bm25Only: SearchResult[] = [];
      const bm25Entries = Array.from(bm25Scores.entries())
        .filter(([id]) => !denseIdSet.has(id))
        .sort((a, b) => b[1] - a[1])
        .slice(0, k); // Take top K BM25-only candidates

      for (const [id, bm25Score] of bm25Entries) {
        const doc = documentStore[id];
        if (!doc) continue;

        const normalizedBM25 = normalizeBM25(bm25Score);
        // BM25-only docs get 0 dense score, so hybrid = bm25Weight * normalizedBM25
        const hybridScore = bm25Weight * normalizedBM25;

        // Skip if score is negligible (avoids flooding with weak matches)
        if (hybridScore < 0.1) continue;

        const contentType = doc.metadata.contentType;
        const boost = getContentTypeBoost(contentType);
        const boostedScore = hybridScore * boost;

        bm25Only.push({
          id,
          content: doc.content,
          score: boostedScore,
          similarity: hybridScore,
          metadata: doc.metadata
        });
      }

      // Merge dense+BM25 hybrid results with BM25-only results
      hybridResults.push(...bm25Only);

      // Sort by hybrid score
      hybridResults.sort((a, b) => b.score - a.score);

      // Deduplicate by ID (keep highest-scoring entry for each ID)
      const seen = new Set<string>();
      const deduplicated = hybridResults.filter(result => {
        if (seen.has(result.id)) return false;
        seen.add(result.id);
        return true;
      });

      // Apply filters
      let filtered = deduplicated;

      if (filters) {
        filtered = filtered.filter(result => {
          // Date range filter
          if (filters.dateRange) {
            const date = result.metadata.date;
            if (date < filters.dateRange.start || date > filters.dateRange.end) {
              return false;
            }
          }

          // Signal filters
          if (filters.signals) {
            for (const [key, value] of Object.entries(filters.signals)) {
              if (result.metadata.signals[key as keyof SessionSignals] !== value) {
                return false;
              }
            }
          }

          // Pattern filter
          if (filters.hasPatterns && (!result.metadata.patterns || result.metadata.patterns.length === 0)) {
            return false;
          }

          // Code filter
          if (filters.hasCode !== undefined && result.metadata.hasCode !== filters.hasCode) {
            return false;
          }

          // Links filter
          if (filters.hasLinks !== undefined && result.metadata.hasLinks !== filters.hasLinks) {
            return false;
          }

          return true;
        });
      }

      // Apply threshold
      if (threshold !== undefined) {
        filtered = filtered.filter(r => r.score >= threshold);
      }

      // Fix #140: Diversity-first ranking (guarantee representation per contentType)
      // Group results by contentType
      const byContentType = new Map<string, typeof filtered>();
      for (const result of filtered) {
        const type = result.metadata.contentType || 'unknown';
        if (!byContentType.has(type)) {
          byContentType.set(type, []);
        }
        byContentType.get(type)!.push(result);
      }

      // Sort each group by boosted score (already sorted, but ensure it)
      for (const group of byContentType.values()) {
        group.sort((a, b) => b.score - a.score);
      }

      // Diversity-first selection: Take top 2 from EVERY contentType
      const diversityResults: typeof filtered = [];
      const DIVERSITY_COUNT = 2; // Top N from each type

      for (const group of byContentType.values()) {
        diversityResults.push(...group.slice(0, DIVERSITY_COUNT));
      }

      // Fill remaining slots with highest boosted scores across all types
      const remainingSlots = limit - diversityResults.length;
      if (remainingSlots > 0) {
        // Get all results not already selected
        const diversityIds = new Set(diversityResults.map(r => r.id));
        const remaining = filtered.filter(r => !diversityIds.has(r.id));

        // Add top remaining results by score
        diversityResults.push(...remaining.slice(0, remainingSlots));
      }

      // Return limited results (diversity-first ensures representation)
      return diversityResults.slice(0, limit);
    },

    async deleteDocument(id: string): Promise<void> {
      const docIndex = idToIndex.get(id);
      if (docIndex === undefined) return;

      // Remove from document store
      delete documentStore[id];

      // Remove from BM25 index
      removeBM25Document(id);

      // Remove from mappings
      idToIndex.delete(id);
      indexToId.delete(docIndex);

      // Note: hnswlib-node doesn't support deletion, so we keep the vector but remove metadata
      // The document won't be returned in search results since it's not in documentStore

      await persist();
    },

    async clear(): Promise<void> {
      // Reset all state
      index = new HierarchicalNSW('cosine', config.vectorSize);
      index.initIndex(maxElements, m, efConstruction);
      documentStore = {};
      bm25Index = {
        documents: new Map(),
        documentFrequency: new Map(),
        documentLengths: new Map(),
        avgDocLength: 0,
        numDocuments: 0
      };
      idToIndex = new Map();
      indexToId = new Map();
      nextIndex = 0;

      await persist();
    },

    async close(): Promise<void> {
      if (initialized) {
        await persist();
        initialized = false;
      }
    },

    getCount(): number {
      return Object.keys(documentStore).length;
    },

    getAllDocuments(): Array<{ id: string; text: string; metadata: SessionMetadata }> {
      return Object.entries(documentStore).map(([id, doc]) => ({
        id,
        text: doc.content,
        metadata: doc.metadata
      }));
    }
  };

  // Helper functions

  function extractMetadata(session: SessionEntry): SessionMetadata {
    const content = session.content;

    return {
      date: session.date,
      summary: session.summary,
      patterns: session.patterns,
      issues: session.issues,
      signals: session.signals!,
      wordCount: content.split(/\s+/).length,
      hasCode: /```/.test(content), // Detect code blocks
      hasLinks: /https?:\/\//.test(content), // Detect URLs
      contentType: session.contentType, // Fix #138: hierarchical weighting
      contentHash: computeContentHash(content)
    };
  }

  function computeContentHash(content: string): string {
    return createHash('sha256').update(content || '').digest('hex');
  }

  function tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(token => token.length > 0);
  }

  /**
   * Get hierarchical content type boost multiplier (Fix #138, #4, S337, S343)
   * Higher values rank content type higher in search results
   */
  function getContentTypeBoost(contentType?: 'session' | 'issue' | 'commit' | 'code' | 'docs' | 'conversation' | 'memory'): number {
    // Default boost multipliers (can be made configurable later)
    // S343: Raised code from 0.5 to 1.0 - LLM-extracted summaries aren't noisy raw source
    const DEFAULT_BOOST: Record<string, number> = {
      conversation: 2.5,  // Extracted episodes/facts rank highest (#4)
      memory: 2.0,        // Auto-memory files contain behavioral guidance (S337)
      session: 2.0,       // Sessions are high priority
      issue: 1.5,         // Issues are high priority
      commit: 1.2,        // Commits are medium-high priority
      docs: 1.0,          // Docs are baseline
      code: 1.0           // Code summaries on par with docs (S343 - was 0.5)
    };

    return contentType ? (DEFAULT_BOOST[contentType] ?? 1.0) : 1.0;
  }

  function updateBM25Index(id: string, content: string): void {
    const tokens = tokenize(content);

    // Update document token list
    bm25Index.documents.set(id, tokens);

    // Update document length
    bm25Index.documentLengths.set(id, tokens.length);

    // Update document frequency for each unique term
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      const currentDF = bm25Index.documentFrequency.get(token) || 0;
      bm25Index.documentFrequency.set(token, currentDF + 1);
    }

    // Update document count and average length
    bm25Index.numDocuments++;
    const totalLength = Array.from(bm25Index.documentLengths.values()).reduce((sum, len) => sum + len, 0);
    bm25Index.avgDocLength = totalLength / bm25Index.numDocuments;
  }

  function removeBM25Document(id: string): void {
    const tokens = bm25Index.documents.get(id);
    if (!tokens) return;

    // Update document frequency
    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      const currentDF = bm25Index.documentFrequency.get(token) || 0;
      if (currentDF <= 1) {
        bm25Index.documentFrequency.delete(token);
      } else {
        bm25Index.documentFrequency.set(token, currentDF - 1);
      }
    }

    // Remove document
    bm25Index.documents.delete(id);
    bm25Index.documentLengths.delete(id);

    // Update document count and average length
    bm25Index.numDocuments--;
    if (bm25Index.numDocuments > 0) {
      const totalLength = Array.from(bm25Index.documentLengths.values()).reduce((sum, len) => sum + len, 0);
      bm25Index.avgDocLength = totalLength / bm25Index.numDocuments;
    } else {
      bm25Index.avgDocLength = 0;
    }
  }

  function computeBM25Scores(queryTokens: string[]): Map<string, number> {
    const scores = new Map<string, number>();

    // BM25 parameters
    const k1 = 1.2;  // S349 sweep: +11pp R@1 on backchannel
    const b = 0.75;

    for (const [docId, docTokens] of bm25Index.documents.entries()) {
      let score = 0;

      for (const queryToken of queryTokens) {
        // Term frequency in document
        const tf = docTokens.filter(t => t === queryToken).length;
        if (tf === 0) continue;

        // Inverse document frequency
        const df = bm25Index.documentFrequency.get(queryToken) || 0;
        const idf = Math.log((bm25Index.numDocuments - df + 0.5) / (df + 0.5) + 1);

        // Document length normalization
        const docLength = bm25Index.documentLengths.get(docId) || 0;
        const norm = (1 - b) + b * (docLength / bm25Index.avgDocLength);

        // BM25 formula
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * norm));
      }

      scores.set(docId, score);
    }

    return scores;
  }

  function normalizeBM25(score: number): number {
    // Normalize BM25 score to [0, 1] using sigmoid
    // BM25 scores typically range from 0 to ~20 for relevant documents
    return 1 / (1 + Math.exp(-score / 5));
  }

  async function persist(): Promise<void> {
    if (!index) return;

    // Ensure directory exists
    await fs.mkdir(config.indexPath, { recursive: true });

    // Save HNSW index
    const indexFile = path.join(config.indexPath, 'index.hnsw');
    index.writeIndexSync(indexFile);

    // formatVersion 3 (S463, #14 phase 2): content streams to content.jsonl,
    // one {id, content} record per line, via a write stream to a temp file with
    // atomic rename — no whole-store JSON string is ever built. metadata.json
    // carries only doc metadata + id maps (BM25 is rebuilt at load since v2).
    // Write order is crash-safe: content first, then metadata — orphan records
    // in content.jsonl are harmless; metadata referencing missing content is
    // repaired at load (empty-hydrate + forced reindex).
    const contentFile = path.join(config.indexPath, 'content.jsonl');
    const contentTmp = contentFile + '.tmp';
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(contentTmp, { encoding: 'utf-8' });
      out.on('error', reject);
      out.on('finish', resolve);
      (async () => {
        for (const [id, doc] of Object.entries(documentStore)) {
          const line = JSON.stringify({ id, content: doc.content }) + '\n';
          if (!out.write(line)) {
            await new Promise<void>(r => out.once('drain', r));
          }
        }
        out.end();
      })().catch(reject);
    });
    await fs.rename(contentTmp, contentFile);

    const metadataDocs: Record<string, { metadata: SessionMetadata }> = {};
    for (const [id, doc] of Object.entries(documentStore)) {
      metadataDocs[id] = { metadata: doc.metadata };
    }
    const metadata = {
      formatVersion: 3,
      documentStore: metadataDocs,
      idToIndex: Object.fromEntries(idToIndex),
      indexToId: Object.fromEntries(indexToId),
      nextIndex
    };

    const metadataFile = path.join(config.indexPath, 'metadata.json');
    const metadataTmp = metadataFile + '.tmp';
    await fs.writeFile(metadataTmp, JSON.stringify(metadata));
    await fs.rename(metadataTmp, metadataFile);
  }
}
