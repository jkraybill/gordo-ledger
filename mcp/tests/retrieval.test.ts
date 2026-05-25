/**
 * Fast-Bench Retrieval Tests
 *
 * TDD for retrieval quality using curated fixtures.
 * Runs in ~30 seconds (vs 25 minutes for full benchmark).
 *
 * Design principles (from roundtable S348):
 * - Query-focused sampling: include target docs + hard negatives
 * - Minimum ~10-30 docs per suite for meaningful discrimination
 * - Unit tests for logic, fast-bench for retrieval quality
 * - Full GRT benchmark remains the release gate
 *
 * Usage:
 *   npm test -- retrieval.test.ts           # Run all retrieval tests
 *   npm test -- retrieval.test.ts -t smoke  # Run smoke tests only
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHNSWIndexer, HNSWConfig } from '../src/indexer/hnsw-indexer.js';
import { createEmbeddingProvider, EmbeddingConfig } from '../src/embeddings/provider.js';
import { SessionEntry, EmbeddingProvider } from '../src/types.js';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';

const FIXTURES_DIR = path.join(__dirname, 'fixtures/fast-bench');
const TEST_INDEX_PATH = '.test-retrieval-index';

// Timeouts for embedding operations
const EMBED_TIMEOUT = 10000; // 10s per embedding
const SUITE_TIMEOUT = 60000; // 60s for full suite

interface FastBenchFixture {
  id: string;
  type?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface FastBenchQuery {
  id: string;
  query: string;
  expected_doc_id: string;
  category: string;
  difficulty?: string;
  notes?: string;
}

interface FastBenchSuite {
  name: string;
  description: string;
  version?: string;
  fixtures: FastBenchFixture[];
  queries: FastBenchQuery[];
}

/**
 * Load a fast-bench test suite from YAML.
 */
async function loadSuite(suiteName: string): Promise<FastBenchSuite | null> {
  const suitePath = path.join(FIXTURES_DIR, `${suiteName}.yaml`);
  try {
    const content = await fs.readFile(suitePath, 'utf-8');
    return yaml.parse(content) as FastBenchSuite;
  } catch (e) {
    console.error(`Failed to load suite ${suiteName}:`, e);
    return null;
  }
}

/**
 * Convert fixture to SessionEntry format for indexer.
 */
function fixtureToSession(fixture: FastBenchFixture): SessionEntry {
  const meta = fixture.metadata || {};
  return {
    id: fixture.id,
    date: (meta.date as string) || '2026-01-01',
    content: fixture.content,
    summary: fixture.content.slice(0, 100),
    patterns: [],
    issues: [],
    signals: {
      success: false,
      failed: false,
      warning: false,
      ledTo: false,
      mixed: false,
      bigChange: false
    }
  };
}

describe('Fast-Bench Retrieval', () => {
  let indexer: ReturnType<typeof createHNSWIndexer>;
  let embedder: EmbeddingProvider;

  beforeAll(async () => {
    // Initialize embedding provider (uses Ollama by default)
    const embedConfig: EmbeddingConfig = {
      type: 'ollama',
      model: 'mxbai-embed-large:latest',
      ollamaUrl: 'http://localhost:11434'
    };
    embedder = createEmbeddingProvider(embedConfig);

    // Initialize indexer
    const indexConfig: HNSWConfig = {
      indexPath: TEST_INDEX_PATH,
      vectorSize: 1024,
      maxElements: 1000,
      m: 16,
      efConstruction: 200
    };
    indexer = createHNSWIndexer(indexConfig);
    await indexer.initialize();
  });

  afterAll(async () => {
    await indexer.clear();
    await indexer.close();
    try {
      await fs.rm(TEST_INDEX_PATH, { recursive: true });
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  beforeEach(async () => {
    // Clear index between test suites
    await indexer.clear();
  });

  describe('Smoke Test', () => {
    it('should retrieve exact match documents', async () => {
      // Minimal smoke test with inline fixtures
      const docs: FastBenchFixture[] = [
        {
          id: 'doc-target',
          content: 'This document discusses the WWGD protocol for autonomous decision making in bilateral collaboration. WWGD stands for What Would Gordo Do and represents escalating levels of autonomy grants.',
        },
        {
          id: 'doc-distractor-1',
          content: 'Unrelated content about weather patterns and climate science. This discusses atmospheric conditions and precipitation.',
        },
        {
          id: 'doc-distractor-2',
          content: 'Another document about cooking recipes and food preparation. Contains instructions for making pasta dishes.',
        },
      ];

      // Index documents with real embeddings
      for (const doc of docs) {
        const session = fixtureToSession(doc);
        const embedding = await embedder.generateEmbedding(doc.content);
        await indexer.addDocument(session, embedding);
      }

      const status = await indexer.getStatus();
      expect(status.documentCount).toBe(3);

      // Search for WWGD-related content
      const queryText = 'What is the WWGD protocol?';
      const queryEmbedding = await embedder.generateEmbedding(queryText);
      const results = await indexer.hybridSearch(queryEmbedding, queryText, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('doc-target');
    }, SUITE_TIMEOUT);

    it('should discriminate between similar documents', async () => {
      // Test that the system can distinguish semantically similar but distinct docs
      const docs: FastBenchFixture[] = [
        {
          id: 'feedback-grant-scope',
          content: 'When JK grants permissions verbally, do not codify that verbatim into a charter before stress-testing the scope. His generous framing may carry shapes he would not endorse once implications are written down.',
        },
        {
          id: 'feedback-research-first',
          content: 'For architectural z-points, perform research BEFORE proposing a sort. Check three layers: upward Tier 0 flow-through, sideways Tier 1 primitive composition, and prior-close precedent.',
        },
        {
          id: 'feedback-z-grammar',
          content: 'Reserve the term z-point exclusively for Tier 0 constitutional invocations. Use enumerated labels z1, z2, z3 when listing multiple z-points.',
        },
      ];

      for (const doc of docs) {
        const session = fixtureToSession(doc);
        const embedding = await embedder.generateEmbedding(doc.content);
        await indexer.addDocument(session, embedding);
      }

      // Query specifically about grant handling
      const queryText = 'How should I handle verbal grants from JK?';
      const queryEmbedding = await embedder.generateEmbedding(queryText);
      const results = await indexer.hybridSearch(queryEmbedding, queryText, 3);

      expect(results[0].id).toBe('feedback-grant-scope');
    }, SUITE_TIMEOUT);
  });

  describe('Feedback Suite', () => {
    it('should load and run feedback-suite.yaml', async () => {
      const suite = await loadSuite('feedback-suite');

      if (!suite) {
        console.log('Skipping: feedback-suite.yaml not found');
        return;
      }

      // Index all fixtures
      for (const fixture of suite.fixtures) {
        const session = fixtureToSession(fixture);
        const embedding = await embedder.generateEmbedding(fixture.content);
        await indexer.addDocument(session, embedding);
      }

      const status = await indexer.getStatus();
      expect(status.documentCount).toBe(suite.fixtures.length);

      // Run queries and track results
      let passed = 0;
      let failed = 0;
      const failures: { query: FastBenchQuery; gotId: string | null; gotScore: number }[] = [];

      for (const query of suite.queries) {
        const queryEmbedding = await embedder.generateEmbedding(query.query);
        const results = await indexer.hybridSearch(queryEmbedding, query.query, 5);

        if (results.length > 0 && results[0].id === query.expected_doc_id) {
          passed++;
        } else {
          failed++;
          failures.push({
            query,
            gotId: results[0]?.id || null,
            gotScore: results[0]?.score || 0
          });
        }
      }

      // Report results
      const total = suite.queries.length;
      const pct = (100 * passed / total).toFixed(1);
      console.log(`\nFeedback Suite: ${passed}/${total} (${pct}%) R@1`);

      if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
          console.log(`  ${f.query.id}: expected ${f.query.expected_doc_id}, got ${f.gotId}`);
        }
      }

      // Require at least 50% pass rate for the test to pass
      // (allows iterating on algorithm without blocking on perfection)
      expect(passed / total).toBeGreaterThanOrEqual(0.5);
    }, SUITE_TIMEOUT);
  });

  describe('GRT Failures Suite', () => {
    it('should load and run grt-failures-suite.yaml', async () => {
      const suite = await loadSuite('grt-failures-suite');

      if (!suite) {
        console.log('Skipping: grt-failures-suite.yaml not found');
        return;
      }

      // Index all fixtures
      for (const fixture of suite.fixtures) {
        const session = fixtureToSession(fixture);
        const embedding = await embedder.generateEmbedding(fixture.content);
        await indexer.addDocument(session, embedding);
      }

      const status = await indexer.getStatus();
      expect(status.documentCount).toBe(suite.fixtures.length);

      // Run queries and track results
      let passed = 0;
      let failed = 0;
      const failures: { query: FastBenchQuery; gotId: string | null; gotScore: number }[] = [];

      for (const query of suite.queries) {
        const queryEmbedding = await embedder.generateEmbedding(query.query);
        const results = await indexer.hybridSearch(queryEmbedding, query.query, 5);

        if (results.length > 0 && results[0].id === query.expected_doc_id) {
          passed++;
        } else {
          failed++;
          failures.push({
            query,
            gotId: results[0]?.id || null,
            gotScore: results[0]?.score || 0
          });
        }
      }

      // Report results
      const total = suite.queries.length;
      const pct = (100 * passed / total).toFixed(1);
      console.log(`\nGRT Failures Suite: ${passed}/${total} (${pct}%) R@1`);

      if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
          console.log(`  ${f.query.id}: expected ${f.query.expected_doc_id}, got ${f.gotId}`);
        }
      }

      // This suite targets known failures - we want to track improvement
      // Start with 0% baseline (these are all failures in full benchmark)
      // Any improvement here means the algorithm change helps these cases
      console.log(`\nBaseline: 0% (these are all GRT failures)`);
      console.log(`Improvement: +${pct}pp from baseline`);

      // Don't require pass rate - this is for tracking improvement
      expect(true).toBe(true);
    }, SUITE_TIMEOUT * 2); // Longer timeout for more fixtures
  });
});

/**
 * Run a full fast-bench suite and return metrics.
 * Exported for use in benchmarking scripts.
 */
export async function runFastBenchSuite(
  suitePath: string,
  embedder: EmbeddingProvider,
  indexer: ReturnType<typeof createHNSWIndexer>
): Promise<{
  name: string;
  total: number;
  passed: number;
  failed: number;
  recall_at_1: number;
  failures: Array<{ queryId: string; expected: string; got: string | null }>;
}> {
  const content = await fs.readFile(suitePath, 'utf-8');
  const suite = yaml.parse(content) as FastBenchSuite;

  // Clear and reindex
  await indexer.clear();
  for (const fixture of suite.fixtures) {
    const session = fixtureToSession(fixture);
    const embedding = await embedder.generateEmbedding(fixture.content);
    await indexer.addDocument(session, embedding);
  }

  // Run queries
  let passed = 0;
  const failures: Array<{ queryId: string; expected: string; got: string | null }> = [];

  for (const query of suite.queries) {
    const queryEmbedding = await embedder.generateEmbedding(query.query);
    const results = await indexer.hybridSearch(queryEmbedding, query.query, 5);

    if (results.length > 0 && results[0].id === query.expected_doc_id) {
      passed++;
    } else {
      failures.push({
        queryId: query.id,
        expected: query.expected_doc_id,
        got: results[0]?.id || null
      });
    }
  }

  const total = suite.queries.length;
  return {
    name: suite.name,
    total,
    passed,
    failed: total - passed,
    recall_at_1: passed / total,
    failures
  };
}
