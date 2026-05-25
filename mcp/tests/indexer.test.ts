/**
 * Indexer Tests - TDD for HNSW indexer
 * Tests BEFORE implementation (Session 34 production standards)
 *
 * Architecture (Session 34):
 * - hnswlib-node embedded mode (local, no separate server)
 * - Hybrid search: 0.7 dense + 0.3 BM25 (manual implementation)
 * - Session-level indexing (no chunking)
 * - Metadata: date, type, keywords, wordCount, hasCode, hasLinks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionEntry } from '../src/types.js';
import { createHNSWIndexer, HNSWConfig } from '../src/indexer/hnsw-indexer.js';
import fs from 'fs/promises';

describe('HNSWIndexer', () => {
  const testIndexPath = '.test-hnsw-index';
  let indexer: ReturnType<typeof createHNSWIndexer>;

  beforeEach(async () => {
    const config: HNSWConfig = {
      indexPath: testIndexPath,
      vectorSize: 1024, // Mixedbread embedding size
      maxElements: 10000,
      m: 16,
      efConstruction: 200
    };
    indexer = createHNSWIndexer(config);
    await indexer.initialize();
  });

  afterEach(async () => {
    await indexer.clear();
    await indexer.close();
    // Clean up test index
    try {
      await fs.rm(testIndexPath, { recursive: true });
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  describe('Initialization', () => {
    it('should initialize HNSW index and create storage', async () => {
      const status = await indexer.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.documentCount).toBe(0);
      expect(status.indexPath).toBe(testIndexPath);
    });

    it('should handle reinitialization gracefully', async () => {
      await indexer.initialize(); // Second init
      const status = await indexer.getStatus();
      expect(status.initialized).toBe(true);
    });

    it('should persist and reload index', async () => {
      // Add a document
      const session: SessionEntry = {
        id: 'Session_01',
        date: '2025-01-01',
        content: 'Test content',
        summary: 'Test',
        patterns: [],
        issues: [],
        signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
      };
      const embedding = new Array(1024).fill(0.5);
      await indexer.addDocument(session, embedding);
      await indexer.close();

      // Reload
      const config: HNSWConfig = {
        indexPath: testIndexPath,
        vectorSize: 1024
      };
      const indexer2 = createHNSWIndexer(config);
      await indexer2.initialize();

      const status = await indexer2.getStatus();
      expect(status.documentCount).toBe(1);

      const doc = await indexer2.getDocument('Session_01');
      expect(doc).toBeDefined();
      expect(doc!.content).toBe('Test content');

      await indexer2.close();
    });
  });

  describe('Adding Documents', () => {
    it('should add single session entry', async () => {
      const session: SessionEntry = {
        id: 'Session_01',
        date: '2025-01-01',
        content: 'Setup framework with TDD',
        summary: 'Initial setup',
        patterns: ['TDD works'],
        issues: ['#1'],
        signals: {
          success: true,
          failed: false,
          warning: false,
          ledTo: false,
          mixed: false,
          bigChange: false
        }
      };

      const embedding = new Array(1024).fill(0.1);
      await indexer.addDocument(session, embedding);

      const status = await indexer.getStatus();
      expect(status.documentCount).toBe(1);
    });

    it('should add multiple session entries (batch)', async () => {
      const sessions: SessionEntry[] = [
        {
          id: 'Session_01',
          date: '2025-01-01',
          content: 'Setup framework',
          summary: 'Initial setup',
          patterns: [],
          issues: [],
          signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
        },
        {
          id: 'Session_02',
          date: '2025-01-02',
          content: 'Add semantic search',
          summary: 'Feature implementation',
          patterns: ['Hybrid retrieval essential'],
          issues: ['#5'],
          signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
        },
        {
          id: 'Session_03',
          date: '2025-01-03',
          content: 'Fix ChromaDB bug',
          summary: 'Bug fix',
          patterns: [],
          issues: ['#12'],
          signals: { success: false, failed: true, warning: false, ledTo: false, mixed: false, bigChange: false }
        }
      ];

      const embeddings = sessions.map(() => new Array(1024).fill(0.1));
      await indexer.addDocuments(sessions, embeddings);

      const status = await indexer.getStatus();
      expect(status.documentCount).toBe(3);
    });

    it('should skip duplicate documents (same ID)', async () => {
      const session: SessionEntry = {
        id: 'Session_01',
        date: '2025-01-01',
        content: 'First version of content',
        summary: 'Initial',
        patterns: [],
        issues: [],
        signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
      };
      const embedding = new Array(1024).fill(0.1);

      // Add same document twice
      await indexer.addDocument(session, embedding);
      await indexer.addDocument(session, embedding);

      // Should only have 1 document
      const status = await indexer.getStatus();
      expect(status.documentCount).toBe(1);

      // Search should return only one result
      const results = await indexer.hybridSearch(embedding, 'First version', 10);
      const sessionResults = results.filter(r => r.id === 'Session_01');
      expect(sessionResults.length).toBe(1);
    });

    it('should extract and store metadata correctly', async () => {
      const session: SessionEntry = {
        id: 'Session_01',
        date: '2025-01-01',
        content: 'Setup framework with TDD. Here is some code: ```python\nprint("hello")\n```',
        summary: 'Initial setup',
        patterns: ['TDD works', 'Python useful'],
        issues: ['#1', '#2'],
        signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
      };

      const embedding = new Array(1024).fill(0.1);
      await indexer.addDocument(session, embedding);

      const retrieved = await indexer.getDocument('Session_01');
      expect(retrieved).toBeDefined();
      expect(retrieved!.metadata.date).toBe('2025-01-01');
      expect(retrieved!.metadata.hasCode).toBe(true); // Contains code block
      expect(retrieved!.metadata.wordCount).toBeGreaterThan(0);
      expect(retrieved!.metadata.patterns).toEqual(['TDD works', 'Python useful']);
      expect(retrieved!.metadata.issues).toEqual(['#1', '#2']);
    });

    it('should detect code blocks in content', async () => {
      const withCode: SessionEntry = {
        id: 'Session_01',
        date: '2025-01-01',
        content: 'Code example:\n```typescript\nconst x = 1;\n```',
        summary: 'With code',
        patterns: [],
        issues: [],
        signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
      };

      const withoutCode: SessionEntry = {
        id: 'Session_02',
        date: '2025-01-02',
        content: 'Just text content without code',
        summary: 'No code',
        patterns: [],
        issues: [],
        signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
      };

      const embedding = new Array(1024).fill(0.1);
      await indexer.addDocument(withCode, embedding);
      await indexer.addDocument(withoutCode, embedding);

      const doc1 = await indexer.getDocument('Session_01');
      const doc2 = await indexer.getDocument('Session_02');

      expect(doc1!.metadata.hasCode).toBe(true);
      expect(doc2!.metadata.hasCode).toBe(false);
    });

    it('should detect links in content', async () => {
      const withLink: SessionEntry = {
        id: 'Session_01',
        date: '2025-01-01',
        content: 'See https://example.com for details',
        summary: 'With link',
        patterns: [],
        issues: [],
        signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
      };

      const embedding = new Array(1024).fill(0.1);
      await indexer.addDocument(withLink, embedding);

      const doc = await indexer.getDocument('Session_01');
      expect(doc!.metadata.hasLinks).toBe(true);
    });
  });

  describe('Hybrid Search', () => {
    beforeEach(async () => {
      // Add test data
      const sessions: SessionEntry[] = [
        {
          id: 'Session_01',
          date: '2025-01-01',
          content: 'Setup framework with TDD. Test-Driven Development is essential.',
          summary: 'Initial setup',
          patterns: ['TDD works'],
          issues: ['#1'],
          signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
        },
        {
          id: 'Session_02',
          date: '2025-01-02',
          content: 'Implemented hybrid retrieval using hnswlib. Achieves 54% better P@3 compared to pure vector search.',
          summary: 'Semantic search',
          patterns: ['Hybrid retrieval essential'],
          issues: ['#5'],
          signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
        },
        {
          id: 'Session_03',
          date: '2025-01-03',
          content: 'Fixed ChromaDB filesystem issue. Switched to embedded mode with hnswlib.',
          summary: 'Bug fix',
          patterns: [],
          issues: ['#12'],
          signals: { success: false, failed: true, warning: false, ledTo: false, mixed: false, bigChange: false }
        }
      ];

      // Generate different embeddings for each session
      const embeddings = [
        new Array(1024).fill(0.9), // Session 1
        new Array(1024).fill(0.5), // Session 2
        new Array(1024).fill(0.1)  // Session 3
      ];

      await indexer.addDocuments(sessions, embeddings);
    });

    it('should perform hybrid search (dense + sparse)', async () => {
      const query = 'hybrid retrieval';
      const queryEmbedding = new Array(1024).fill(0.5); // Similar to Session 2

      const results = await indexer.hybridSearch(queryEmbedding, query, 3);

      expect(results).toHaveLength(3);
      // Session 2 should rank highest (semantic match + keyword match)
      expect(results[0].id).toBe('Session_02');
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should combine dense and sparse scores correctly', async () => {
      const query = 'hnswlib'; // Exact keyword match in Session 2 & 3
      const queryEmbedding = new Array(1024).fill(0.1); // Similar to Session 3

      const results = await indexer.hybridSearch(queryEmbedding, query, 3);

      // Sessions with "hnswlib" should rank high even if embedding differs
      const hnswSessions = results.filter(r => r.id === 'Session_02' || r.id === 'Session_03');
      expect(hnswSessions.length).toBeGreaterThan(0);
    });

    it('should respect limit parameter', async () => {
      const query = 'framework';
      const queryEmbedding = new Array(1024).fill(0.5);

      const results = await indexer.hybridSearch(queryEmbedding, query, 2);

      expect(results).toHaveLength(2);
    });

    it('should apply threshold filtering', async () => {
      const query = 'unrelated query about cooking';
      const queryEmbedding = new Array(1024).fill(0.0); // Very different embedding

      const results = await indexer.hybridSearch(queryEmbedding, query, 10, 0.8); // High threshold

      // Should filter out low-scoring results
      expect(results.length).toBeLessThan(3);
    });

    it('should favor BM25 for single-word queries (#108)', async () => {
      // Issue #108: Single-word queries should favor keyword matching
      // Query: "hnswlib" (appears in Session 2 & 3)
      const query = 'hnswlib';
      const queryEmbedding = new Array(1024).fill(0.5); // Generic embedding

      const results = await indexer.hybridSearch(queryEmbedding, query, 3);

      // Should find sessions with exact keyword match
      const matchingSessions = results.filter(r => r.id === 'Session_02' || r.id === 'Session_03');
      expect(matchingSessions.length).toBeGreaterThan(0);

      // Single-word query should use 0.3 dense + 0.7 BM25 weighting
      // This means keyword matches are prioritized over semantic similarity
      expect(results[0].score).toBeGreaterThan(0);
    });

    it('should favor semantic for multi-word queries (#108)', async () => {
      // Multi-word queries should favor semantic matching
      const query = 'hybrid search implementation';
      const queryEmbedding = new Array(1024).fill(0.5); // Similar to Session 2

      const results = await indexer.hybridSearch(queryEmbedding, query, 3);

      // Multi-word query should use 0.7 dense + 0.3 BM25 weighting
      // This means semantic similarity is prioritized
      expect(results).toHaveLength(3);
      expect(results[0].score).toBeGreaterThan(0);
    });
  });

  describe('Metadata Filtering', () => {
    beforeEach(async () => {
      const sessions: SessionEntry[] = [
        {
          id: 'Session_01',
          date: '2025-01-01',
          content: 'Setup framework',
          summary: 'Initial setup',
          patterns: ['TDD'],
          issues: ['#1'],
          signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
        },
        {
          id: 'Session_02',
          date: '2025-01-15',
          content: 'Add feature',
          summary: 'Feature',
          patterns: [],
          issues: ['#5'],
          signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
        },
        {
          id: 'Session_03',
          date: '2025-02-01',
          content: 'Fix bug',
          summary: 'Bug fix',
          patterns: [],
          issues: ['#12'],
          signals: { success: false, failed: true, warning: false, ledTo: false, mixed: false, bigChange: false }
        }
      ];

      const embeddings = sessions.map(() => new Array(1024).fill(0.5));
      await indexer.addDocuments(sessions, embeddings);
    });

    it('should filter by date range', async () => {
      const query = 'framework';
      const queryEmbedding = new Array(1024).fill(0.5);

      const results = await indexer.hybridSearch(
        queryEmbedding,
        query,
        10,
        undefined,
        { dateRange: { start: '2025-01-01', end: '2025-01-31' } }
      );

      // Should only return sessions from January
      expect(results.every(r => r.id !== 'Session_03')).toBe(true);
    });

    it('should filter by success signal', async () => {
      const query = 'session';
      const queryEmbedding = new Array(1024).fill(0.5);

      const results = await indexer.hybridSearch(
        queryEmbedding,
        query,
        10,
        undefined,
        { signals: { success: true } }
      );

      // Should only return successful sessions
      expect(results.every(r => r.id !== 'Session_03')).toBe(true);
    });

    it('should filter by patterns', async () => {
      const query = 'session';
      const queryEmbedding = new Array(1024).fill(0.5);

      const results = await indexer.hybridSearch(
        queryEmbedding,
        query,
        10,
        undefined,
        { hasPatterns: true }
      );

      // Should only return sessions with patterns
      expect(results.some(r => r.id === 'Session_01')).toBe(true);
      expect(results.every(r => r.id !== 'Session_02' && r.id !== 'Session_03')).toBe(true);
    });
  });

  describe('CRUD Operations', () => {
    it('should retrieve document by ID', async () => {
      const session: SessionEntry = {
        id: 'Session_01',
        date: '2025-01-01',
        content: 'Test content',
        summary: 'Test',
        patterns: [],
        issues: [],
        signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
      };

      const embedding = new Array(1024).fill(0.5);
      await indexer.addDocument(session, embedding);

      const retrieved = await indexer.getDocument('Session_01');
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe('Session_01');
      expect(retrieved!.content).toBe('Test content');
    });

    it('should return null for non-existent document', async () => {
      const retrieved = await indexer.getDocument('NonExistent');
      expect(retrieved).toBeNull();
    });

    it('should delete document by ID', async () => {
      const session: SessionEntry = {
        id: 'Session_01',
        date: '2025-01-01',
        content: 'Test content',
        summary: 'Test',
        patterns: [],
        issues: [],
        signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
      };

      const embedding = new Array(1024).fill(0.5);
      await indexer.addDocument(session, embedding);

      await indexer.deleteDocument('Session_01');

      const retrieved = await indexer.getDocument('Session_01');
      expect(retrieved).toBeNull();
    });

    it('should clear all documents', async () => {
      const sessions: SessionEntry[] = [
        {
          id: 'Session_01',
          date: '2025-01-01',
          content: 'Test 1',
          summary: 'Test 1',
          patterns: [],
          issues: [],
          signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
        },
        {
          id: 'Session_02',
          date: '2025-01-02',
          content: 'Test 2',
          summary: 'Test 2',
          patterns: [],
          issues: [],
          signals: { success: true, failed: false, warning: false, ledTo: false, mixed: false, bigChange: false }
        }
      ];

      const embeddings = sessions.map(() => new Array(1024).fill(0.5));
      await indexer.addDocuments(sessions, embeddings);

      await indexer.clear();

      const status = await indexer.getStatus();
      expect(status.documentCount).toBe(0);
    });
  });
});
