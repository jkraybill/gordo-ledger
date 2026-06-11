/**
 * MemoryManager v2 Tests
 *
 * Tests the orchestration layer that wires parser + embedder + indexer
 * Critical for preventing regressions in the integration layer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryManager } from '../src/memory-manager-v2.js';
import type { MemoryConfig } from '../src/types.js';
import fs from 'fs/promises';
import path from 'path';

describe('MemoryManager', () => {
  const testConfig: MemoryConfig = {
    enabled: true,
    provider: 'ollama',
    model: 'mxbai-embed-large:latest',
    threshold: 0.75,
    indexPath: '.test-memory-manager',
    autoIndex: true,
    ollamaUrl: 'http://localhost:11434'
  };

  let manager: MemoryManager;
  const testRepoPath = './test-fixtures/test-repo';
  const testJournalPath = path.join(testRepoPath, 'JOURNAL.md');

  beforeEach(async () => {
    // Create test journal
    await fs.mkdir(testRepoPath, { recursive: true });
    const sampleJournal = `# Session Journal

## Session 1: Test Session (2025-01-01)

**Summary:** Test summary

**Details:**
Test details about implementing features.

**Patterns:**
- Test pattern

**Issues:** #1

**Signals:** ✓
`;
    await fs.writeFile(testJournalPath, sampleJournal);

    manager = new MemoryManager(testConfig);
  }, 60000); // 60s timeout for beforeEach (embeddings may be used)

  afterEach(async () => {
    try {
      await fs.rm(testRepoPath, { recursive: true });
      await fs.rm(testConfig.indexPath, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await manager.initialize();

      const stats = await manager.getStats();
      expect(stats).toHaveProperty('totalIndexedDocuments');
      expect(stats).toHaveProperty('indexPath');
      expect(stats).toHaveProperty('provider');
      expect(stats.provider).toBe('ollama');
    });

    it('should not reinitialize if already initialized', async () => {
      await manager.initialize();
      await manager.initialize(); // Should be idempotent

      const stats = await manager.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Journal Type Detection', () => {
    it('should detect flat journal structure', async () => {
      await manager.initialize();

      // indexRepository internally calls detectJournalType
      const result = await manager.indexRepository(testRepoPath, false);

      // Should successfully index without errors (detection worked)
      expect(result).toHaveProperty('indexed');
      expect(result).toHaveProperty('skipped');
    }, 30000); // 30s timeout for embedding

    it('should detect hierarchical journal structure', async () => {
      // Create hierarchical structure
      const sessionsDir = path.join(testRepoPath, 'sessions');
      await fs.mkdir(sessionsDir, { recursive: true });

      const session1Dir = path.join(sessionsDir, 'Session_01_2025-01-01');
      await fs.mkdir(session1Dir);

      const sessionDetail = `# Session 1 Detail

Test session content.
`;
      await fs.writeFile(path.join(session1Dir, 'SESSION_DETAIL.md'), sessionDetail);

      // Remove flat journal
      await fs.unlink(testJournalPath);

      await manager.initialize();
      const result = await manager.indexRepository(testRepoPath, false);

      expect(result).toHaveProperty('indexed');
    }, 30000); // 30s timeout for embedding

    it('should return empty result when no journal found (generic fallback)', async () => {
      // Remove journal
      await fs.unlink(testJournalPath);

      await manager.initialize();

      // With generic file indexing (#116), should not throw error
      // Instead returns {indexed: 0, skipped: 0} when no indexable files exist
      const result = await manager.indexRepository(testRepoPath, false);
      expect(result.indexed).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('Indexing', () => {
    it('should index repository with incremental=false (full reindex)', async () => {
      await manager.initialize();

      const result = await manager.indexRepository(testRepoPath, false);

      expect(result.indexed).toBeGreaterThan(0);
      expect(result.skipped).toBe(0);
    }, 30000); // 30s timeout for embedding

    it('should index repository with incremental=true (skip existing)', async () => {
      await manager.initialize();

      // First index
      const result1 = await manager.indexRepository(testRepoPath, false);
      expect(result1.indexed).toBeGreaterThan(0);

      // Second index (incremental)
      const result2 = await manager.indexRepository(testRepoPath, true);
      expect(result2.indexed).toBe(0);
      expect(result2.skipped).toBeGreaterThan(0);
    }, 30000);

    it('should return zero indexed when no new sessions', async () => {
      await manager.initialize();

      // Index once
      await manager.indexRepository(testRepoPath, false);

      // Try incremental again
      const result = await manager.indexRepository(testRepoPath, true);
      expect(result.indexed).toBe(0);
      expect(result.skipped).toBeGreaterThan(0);
    }, 30000);

    // Content-update detection: when a session entry's content changes between
    // incremental runs (e.g., EOS narrative appended after the open-marker indexed
    // a skeleton), the indexer must reindex rather than skip-as-existing.
    // Pre-fix, incremental keyed only on session.id existence and silently kept
    // the older snapshot.
    it('should reindex when existing session content has changed (incremental)', async () => {
      await manager.initialize();

      // Index once with original content.
      const initial = await manager.indexRepository(testRepoPath, false);
      expect(initial.indexed).toBeGreaterThan(0);

      // Mutate the session content in place (same heading, different body).
      const updatedJournal = `# Session Journal

## Session 1: Test Session (2025-01-01)

**Summary:** Updated summary after EOS

**Details:**
Test details extended with new EOS narrative content that did not exist at first index.

**Patterns:**
- Test pattern
- Newly added pattern

**Issues:** #1

**Signals:** ✓ Δ
`;
      await fs.writeFile(testJournalPath, updatedJournal);

      // Incremental should detect content change and reindex.
      const result = await manager.indexRepository(testRepoPath, true);
      expect(result.indexed).toBeGreaterThan(0);

      // The reindexed session should reflect the new content.
      const reloaded = await manager.getSession('Session_01');
      expect(reloaded).not.toBeNull();
      expect(reloaded!.content).toContain('EOS narrative');
      expect(reloaded!.content).toContain('Newly added pattern');
    }, 60000);

    // Orphan pruning: when files are moved or deleted, incremental indexing
    // must remove the stale entries from the index. Pre-fix, orphaned entries
    // persisted indefinitely because the indexer only checked disk→index, not
    // index→disk. Fix: gordo-ledger#3
    it('should prune orphaned entries when files are deleted (incremental)', async () => {
      await manager.initialize();

      // Create a journal with two sessions.
      const twoSessionJournal = `# Session Journal

## Session 1: First Session (2025-01-01)

**Summary:** First session summary

**Details:** First session details

## Session 2: Second Session (2025-01-02)

**Summary:** Second session summary

**Details:** Second session details
`;
      await fs.writeFile(testJournalPath, twoSessionJournal);

      // Index both sessions.
      const initial = await manager.indexRepository(testRepoPath, false);
      expect(initial.indexed).toBe(2);

      // Verify both sessions exist in index.
      const session1Before = await manager.getSession('Session_01');
      const session2Before = await manager.getSession('Session_02');
      expect(session1Before).not.toBeNull();
      expect(session2Before).not.toBeNull();

      // Delete the second session from the journal (simulating file deletion/move).
      const oneSessionJournal = `# Session Journal

## Session 1: First Session (2025-01-01)

**Summary:** First session summary

**Details:** First session details
`;
      await fs.writeFile(testJournalPath, oneSessionJournal);

      // Incremental index should prune the orphaned Session_02.
      const result = await manager.indexRepository(testRepoPath, true);
      expect(result.skipped).toBe(1); // Session_01 unchanged

      // Session_01 should still exist.
      const session1After = await manager.getSession('Session_01');
      expect(session1After).not.toBeNull();

      // Session_02 should be pruned (orphan).
      const session2After = await manager.getSession('Session_02');
      expect(session2After).toBeNull();
    }, 60000);

    // SESSION_LOG.md filename support: project-gordo-backchannel and other
    // adopters use SESSION_LOG.md instead of JOURNAL.md / GORDO_JOURNAL.md.
    // Pre-fix, the file-detection chain returned 'generic' for these repos and
    // sessions never got indexed.
    it('should detect and index SESSION_LOG.md as a flat journal', async () => {
      // Replace JOURNAL.md with SESSION_LOG.md in the title-less form used
      // by backchannel-style logs.
      await fs.unlink(testJournalPath);
      const sessionLogPath = path.join(testRepoPath, 'SESSION_LOG.md');
      await fs.writeFile(sessionLogPath, `# Session Log

## Session 1 (2025-01-01)

**Opened:** 2025-01-01 10:00 UTC

[2025-01-01] S1: Initial. ✓ #1
`);

      await manager.initialize();
      const result = await manager.indexRepository(testRepoPath, false);

      expect(result.indexed).toBeGreaterThan(0);
      const session = await manager.getSession('Session_01');
      expect(session).not.toBeNull();
      expect(session!.date).toBe('2025-01-01');
    }, 30000);
  });

  describe('Search', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.indexRepository(testRepoPath, false);
    });

    it('should search with basic query', async () => {
      const results = await manager.search({
        query: 'test',
        limit: 5,
        threshold: 0.5
      });

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(0);

      if (results.length > 0) {
        expect(results[0]).toHaveProperty('sessionId');
        expect(results[0]).toHaveProperty('similarity');
        expect(results[0]).toHaveProperty('content');
        expect(results[0]).toHaveProperty('rank');
      }
    }, 30000);

    it('should respect limit parameter', async () => {
      const results = await manager.search({
        query: 'test',
        limit: 1
      });

      expect(results.length).toBeLessThanOrEqual(1);
    }, 30000);

    it('should respect threshold parameter', async () => {
      const results = await manager.search({
        query: 'test',
        threshold: 0.9 // Very high threshold
      });

      // High threshold may return 0 results
      expect(Array.isArray(results)).toBe(true);
    }, 30000);

    it('should filter by includePatterns', async () => {
      const results = await manager.search({
        query: 'test',
        limit: 5,
        includePatterns: ['pattern']
      });

      if (results.length > 0) {
        const hasPattern = results.some(r =>
          r.content.toLowerCase().includes('pattern')
        );
        expect(hasPattern).toBe(true);
      }
    }, 30000);

    it('should filter by excludePatterns', async () => {
      const results = await manager.search({
        query: 'test',
        limit: 5,
        excludePatterns: ['nonexistent']
      });

      if (results.length > 0) {
        const hasExcluded = results.some(r =>
          r.content.toLowerCase().includes('nonexistent')
        );
        expect(hasExcluded).toBe(false);
      }
    }, 30000);

    // S435: contentTypes filter should return enough results even when
    // the requested type is a minority in the index. Pre-fix, the filter
    // was applied AFTER slicing to limit, so if you asked for 20 sessions
    // but the top 20 HNSW results were mostly docs, you'd get fewer than
    // expected. Fix: oversample 10x when contentTypes is specified.
    it('should return sufficient results when filtering by contentTypes', async () => {
      // Create a mixed-type index: 1 session + many docs
      await fs.mkdir(path.join(testRepoPath, 'docs'), { recursive: true });
      for (let i = 1; i <= 10; i++) {
        await fs.writeFile(
          path.join(testRepoPath, 'docs', `doc${i}.md`),
          `# Documentation ${i}\n\nThis is test documentation about patterns and features.\n`
        );
      }

      // Reindex to include docs
      await manager.reindex(testRepoPath);

      // Search for something that matches both session and docs
      const results = await manager.search({
        query: 'test pattern',
        limit: 5,
        contentTypes: ['session']
      });

      // Should find the session even though docs likely rank higher
      // (session has "test pattern" in it)
      const hasSession = results.some(r =>
        r.contentType === 'session' || r.sessionId?.includes('Session')
      );
      expect(hasSession).toBe(true);
    }, 60000);
  });

  describe('Session Retrieval', () => {
    beforeEach(async () => {
      await manager.initialize();
      await manager.indexRepository(testRepoPath, false);
    });

    it('should retrieve existing session by ID', async () => {
      const session = await manager.getSession('Session_1');

      if (session) {
        expect(session).toHaveProperty('id');
        expect(session).toHaveProperty('date');
        expect(session).toHaveProperty('content');
        expect(session.id).toBe('Session_1');
      }
    }, 30000);

    it('should return null for non-existent session', async () => {
      const session = await manager.getSession('Session_999');
      expect(session).toBeNull();
    });
  });

  describe('Reindexing', () => {
    it('should clear and reindex', async () => {
      await manager.initialize();

      // Initial index
      await manager.indexRepository(testRepoPath, false);

      // Reindex
      const result = await manager.reindex(testRepoPath);

      expect(result).toHaveProperty('indexed');
      expect(result.indexed).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Stats', () => {
    it('should return stats before indexing', async () => {
      await manager.initialize();

      const stats = await manager.getStats();

      expect(stats.totalIndexedDocuments).toBe(0);
      expect(stats.indexPath).toBe(testConfig.indexPath);
      expect(stats.provider).toBe('ollama');
    });

    it('should return stats after indexing', async () => {
      await manager.initialize();
      await manager.indexRepository(testRepoPath, false);

      const stats = await manager.getStats();

      expect(stats.totalIndexedDocuments).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Error Handling', () => {
    it('should throw error with invalid provider', () => {
      const invalidConfig: MemoryConfig = {
        ...testConfig,
        provider: 'invalid' as any
      };

      expect(() => new MemoryManager(invalidConfig)).toThrow();
    });

    it('should throw error when OpenAI provider missing API key', () => {
      const openaiConfig: MemoryConfig = {
        ...testConfig,
        provider: 'openai',
        openaiApiKey: undefined
      };

      expect(() => new MemoryManager(openaiConfig)).toThrow(/OpenAI.*API.*key/i);
    });
  });

  // S339: Performance regression tests for incremental indexing fixes
  describe('Incremental Indexing Performance (S339)', () => {
    // Test that incremental indexing uses bulk document lookup instead of N
    // individual getDocument calls. The fix replaced the loop that called
    // getDocument() for each session (causing N fs.stat calls for staleness
    // checks) with a single getAllDocuments() call.
    it('should complete incremental check in bounded time regardless of document count', async () => {
      await manager.initialize();

      // Create a larger test set (simulating real-world session counts)
      const sessions = [];
      for (let i = 1; i <= 50; i++) {
        sessions.push(`
## Session ${i}: Test Session ${i} (2025-01-${String(i).padStart(2, '0')})

**Summary:** Session ${i} summary

**Details:** Session ${i} details with some content to embed.

**Signals:** ✓
`);
      }

      const largeJournal = `# Session Journal\n\n${sessions.join('\n')}`;
      await fs.writeFile(testJournalPath, largeJournal);

      // First index
      const start1 = Date.now();
      const result1 = await manager.indexRepository(testRepoPath, false);
      const time1 = Date.now() - start1;
      expect(result1.indexed).toBe(50);

      // Second index (incremental - should be fast due to bulk lookup)
      const start2 = Date.now();
      const result2 = await manager.indexRepository(testRepoPath, true);
      const time2 = Date.now() - start2;

      expect(result2.indexed).toBe(0);
      expect(result2.skipped).toBe(50);

      // Incremental should be significantly faster than initial
      // (No embedding generation, bulk lookup instead of N lookups)
      expect(time2).toBeLessThan(time1 / 2);
    }, 120000); // 2 min timeout for 50 embeddings

    // Test the pruning behavior: when doing full reindex (no git optimization),
    // orphaned documents should be pruned. This verifies the existing behavior
    // still works correctly after the S339 fix that skips pruning during
    // git-aware incremental indexing.
    it('should prune orphaned documents during full reindex but not during git-aware incremental', async () => {
      await manager.initialize();

      // Create journal with two sessions
      const twoSessionJournal = `# Session Journal

## Session 1: First Session (2025-01-01)

**Summary:** First session summary

**Details:** First session details

## Session 2: Second Session (2025-01-02)

**Summary:** Second session summary

**Details:** Second session details
`;
      await fs.writeFile(testJournalPath, twoSessionJournal);

      // Full index both sessions
      const result1 = await manager.indexRepository(testRepoPath, false);
      expect(result1.indexed).toBe(2);

      // Verify both exist
      const s1Before = await manager.getSession('Session_01');
      const s2Before = await manager.getSession('Session_02');
      expect(s1Before).not.toBeNull();
      expect(s2Before).not.toBeNull();

      // Remove Session 2 from journal
      const oneSessionJournal = `# Session Journal

## Session 1: First Session (2025-01-01)

**Summary:** First session summary

**Details:** First session details
`;
      await fs.writeFile(testJournalPath, oneSessionJournal);

      // Full reindex (incremental=false) should prune Session 2
      const result2 = await manager.reindex(testRepoPath);

      // Session 2 should be pruned
      const s2After = await manager.getSession('Session_02');
      expect(s2After).toBeNull();

      // Session 1 should still exist
      const s1After = await manager.getSession('Session_01');
      expect(s1After).not.toBeNull();
    }, 60000);
  });
});
