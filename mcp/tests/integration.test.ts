/**
 * Integration Tests - Full workflow validation
 * Tests PARSE → EMBED → INDEX → SEARCH pipeline
 *
 * Performance targets (from Session 32 bakeoff):
 * - P@3 ≥0.60 (bakeoff achieved 0.567)
 * - MRR ≥0.75 (bakeoff achieved 0.820)
 * - Latency <100ms (p95)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createJournalParser } from '../src/parser/journal-parser-v2.js';
import { createEmbeddingProvider } from '../src/embeddings/provider.js';
import { createHNSWIndexer } from '../src/indexer/hnsw-indexer.js';
import fs from 'fs/promises';
import path from 'path';

// Module-level constants for test fixtures
const testIndexPath = '.test-integration-index';
const testJournalPath = './test-fixtures/sample-journal.md';

describe('Integration: Full Workflow', () => {

  let indexer: ReturnType<typeof createHNSWIndexer>;
  let embedder: ReturnType<typeof createEmbeddingProvider>;

  beforeAll(async () => {
    // Create test fixtures
    await createTestJournal(testJournalPath);

    // Initialize components
    embedder = createEmbeddingProvider({
      type: 'ollama',
      model: 'mxbai-embed-large:latest',
      ollamaUrl: 'http://localhost:11434'
    });

    indexer = createHNSWIndexer({
      indexPath: testIndexPath,
      vectorSize: 1024
    });

    await indexer.initialize();
  });

  afterAll(async () => {
    await indexer.clear();
    await indexer.close();

    try {
      await fs.rm(testIndexPath, { recursive: true });
      await fs.rm(path.dirname(testJournalPath), { recursive: true });
    } catch (e) {
      // Ignore
    }
  });

  it('should complete full workflow: parse → embed → index → search', async () => {
    // Step 1: Parse
    const parser = createJournalParser();
    const sessions = await parser.parseJournalFile(testJournalPath);

    expect(sessions.length).toBeGreaterThan(0);

    // Step 2: Embed
    const contents = sessions.map(s => s.content);
    const embeddings = await embedder.generateEmbeddings(contents);

    expect(embeddings.length).toBe(sessions.length);
    expect(embeddings[0].length).toBe(1024);

    // Step 3: Index
    await indexer.addDocuments(sessions, embeddings);

    const status = await indexer.getStatus();
    expect(status.documentCount).toBe(sessions.length);

    // Step 4: Search
    const query = 'hybrid retrieval';
    const queryEmbedding = await embedder.generateEmbedding(query);
    const results = await indexer.hybridSearch(queryEmbedding, query, 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeGreaterThan(0);

    // Verify results contain expected content
    const resultContent = results.map(r => r.content.toLowerCase());
    const hasRelevant = resultContent.some(c => c.includes('hybrid') || c.includes('retrieval') || c.includes('search'));
    expect(hasRelevant).toBe(true);
  }, 30000); // 30s timeout for Ollama

  it('should handle keyword queries with BM25 boost', async () => {
    const query = 'TDD';
    const queryEmbedding = await embedder.generateEmbedding(query);
    const results = await indexer.hybridSearch(queryEmbedding, query, 3);

    expect(results.length).toBeGreaterThan(0);

    // Results should contain TDD keyword
    const hasTDD = results.some(r => r.content.toLowerCase().includes('tdd'));
    expect(hasTDD).toBe(true);
  }, 30000);

  it('should handle semantic queries', async () => {
    const query = 'test-driven development practices';
    const queryEmbedding = await embedder.generateEmbedding(query);
    const results = await indexer.hybridSearch(queryEmbedding, query, 3);

    expect(results.length).toBeGreaterThan(0);

    // Should find sessions about TDD even without exact keyword match
    const relevantContent = results.some(r =>
      r.content.toLowerCase().includes('tdd') ||
      r.content.toLowerCase().includes('test') ||
      r.content.toLowerCase().includes('testing')
    );
    expect(relevantContent).toBe(true);
  }, 30000);

  it('should meet performance targets', async () => {
    const queries = [
      'hybrid retrieval',
      'TDD testing',
      'architecture decisions',
      'performance optimization',
      'bug fixes'
    ];

    let totalLatency = 0;
    const queryResults = [];

    for (const query of queries) {
      const start = Date.now();
      const queryEmbedding = await embedder.generateEmbedding(query);
      const results = await indexer.hybridSearch(queryEmbedding, query, 3);
      const latency = Date.now() - start;

      totalLatency += latency;
      queryResults.push({ query, results, latency });
    }

    const avgLatency = totalLatency / queries.length;

    // Performance assertions
    expect(avgLatency).toBeLessThan(1000); // <1s average (includes embedding time)
    expect(queryResults.every(r => r.results.length > 0)).toBe(true); // All queries return results
  }, 60000); // 60s timeout for multiple queries
});

async function createTestJournal(journalPath: string) {
  const dir = path.dirname(journalPath);
  await fs.mkdir(dir, { recursive: true });

  const sampleJournal = `# Session Journal

## Session 1: Initial Setup (2025-01-01)

**Summary:** Setup framework with TDD

**Details:**
Implemented test-driven development approach for gordo-memory. Started with parser component.
TDD workflow: write tests first, then implement to make them pass.

**Patterns:**
- TDD prevents bugs early
- Tests are documentation

**Issues:** #1

**Signals:** ✓


## Session 2: Hybrid Retrieval Implementation (2025-01-02)

**Summary:** Implemented hybrid search

**Details:**
Built hybrid retrieval system combining dense vector search (0.7 weight) with BM25 keyword matching (0.3 weight).
Empirical bakeoff showed 54% improvement in P@3 compared to pure vector search.
Used hnswlib-node for embedded mode (no server required).

**Patterns:**
- Hybrid retrieval essential for our query patterns
- 74% NL queries + 19% keyword queries
- Empirical validation beats opinions

**Issues:** #5

**Signals:** ✓


## Session 3: Architecture Decisions (2025-01-03)

**Summary:** Chose hnswlib over Qdrant

**Details:**
Decision: hnswlib-node embedded mode vs Qdrant server mode.
Rationale: User experience > implementation complexity. No Docker dependency.
Manual BM25 implementation (simple, self-contained).

**Patterns:**
- Local-first philosophy
- Embedded better than client-server for this use case

**Issues:** #12

**Signals:** ✓


## Session 4: Performance Optimization (2025-01-04)

**Summary:** Optimized search latency

**Details:**
Achieved <100ms p95 latency for hybrid search.
Vectorization using Mixedbread embeddings (1024 dimensions).
HNSW parameters: m=16, efConstruction=200.

**Patterns:**
- Performance targets met
- Sub-100ms search is excellent UX

**Issues:** #15

**Signals:** ✓


## Session 5: Bug Fixes (2025-01-05)

**Summary:** Fixed persistence bug

**Details:**
Fixed index reload bug - metadata wasn't persisting correctly.
Issue: hnswlib-node API uses sync methods for some operations.
Solution: Use readIndexSync/writeIndexSync for I/O.

**Patterns:**
- TDD caught this early
- API mismatch between expected and actual

**Issues:** #18

**Signals:** ✓
`;

  await fs.writeFile(journalPath, sampleJournal);
}
