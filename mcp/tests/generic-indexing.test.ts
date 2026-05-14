// Generic File Indexing Tests
// Tests ability to index any text files, not just journals

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../src/memory-manager-v2.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

describe('Generic File Indexing', () => {
  const TEST_DIR = '/tmp/test-generic-indexing';
  const INDEX_PATH = path.join(TEST_DIR, '.gordo-memory');

  beforeEach(async () => {
    // Clean slate
    if (existsSync(TEST_DIR)) {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    }
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    if (existsSync(TEST_DIR)) {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('Single File Indexing', () => {
    it('should index a single markdown file', async () => {
      // Create test file
      const testFile = path.join(TEST_DIR, 'README.md');
      await fs.writeFile(testFile, `# Test Document

This is a test document about authentication and database design.
It contains information that should be searchable.`);

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.5,
        indexPath: INDEX_PATH,
        autoIndex: true,
        indexDocs: true // Enable generic docs indexing
      });

      await manager.initialize();
      const result = await manager.indexRepository(testFile, false);

      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(0);
    }, 15000); // Increased timeout for Ollama embedding operations

    it('should index a single TypeScript file', async () => {
      const testFile = path.join(TEST_DIR, 'auth.ts');
      await fs.writeFile(testFile, `// Authentication module
export function authenticate(user: string, password: string): boolean {
  // Implementation details
  return true;
}`);

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.5,
        indexPath: INDEX_PATH,
        autoIndex: true,
        indexCode: true // Fix: Enable code indexing (defaults to false)
      });

      await manager.initialize();
      const result = await manager.indexRepository(testFile, false);

      expect(result.indexed).toBe(1);
    }, 15000); // Increased timeout for Ollama embedding operations
  });

  describe('Directory Indexing', () => {
    it('should index all markdown files in a directory', async () => {
      // Create multiple markdown files
      await fs.writeFile(path.join(TEST_DIR, 'file1.md'), '# File 1\nContent about databases');
      await fs.writeFile(path.join(TEST_DIR, 'file2.md'), '# File 2\nContent about testing');
      await fs.writeFile(path.join(TEST_DIR, 'file3.md'), '# File 3\nContent about authentication');

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.5,
        indexPath: INDEX_PATH,
        autoIndex: true,
        indexDocs: true // Enable generic docs indexing
      });

      await manager.initialize();
      const result = await manager.indexRepository(TEST_DIR, false);

      expect(result.indexed).toBe(3);
    }, 20000); // Increased timeout for multiple file indexing

    it('should index mixed file types', async () => {
      await fs.writeFile(path.join(TEST_DIR, 'README.md'), '# Readme\nDocumentation');
      await fs.writeFile(path.join(TEST_DIR, 'auth.ts'), 'export function auth() {}');
      await fs.writeFile(path.join(TEST_DIR, 'config.json'), '{"key": "value"}');
      await fs.writeFile(path.join(TEST_DIR, 'server.js'), 'function server() {}');

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.5,
        indexPath: INDEX_PATH,
        autoIndex: true,
        indexCode: true // Fix: Enable code indexing (defaults to false)
      });

      await manager.initialize();
      const result = await manager.indexRepository(TEST_DIR, false);

      // Should index text files (md, ts, json, js)
      expect(result.indexed).toBeGreaterThanOrEqual(4);
    }, 25000); // Increased timeout for multiple file types

    it('should skip binary files', async () => {
      await fs.writeFile(path.join(TEST_DIR, 'test.md'), '# Test\nContent');
      await fs.writeFile(path.join(TEST_DIR, 'test.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG header

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.5,
        indexPath: INDEX_PATH,
        autoIndex: true,
        indexDocs: true // Enable generic docs indexing
      });

      await manager.initialize();
      const result = await manager.indexRepository(TEST_DIR, false);

      // Should only index the markdown file
      expect(result.indexed).toBe(1);
    }, 15000); // Increased timeout for Ollama operations

    it('should respect .gitignore patterns', async () => {
      await fs.writeFile(path.join(TEST_DIR, 'included.md'), '# Included\nContent');

      // Create node_modules directory (should be ignored)
      await fs.mkdir(path.join(TEST_DIR, 'node_modules'));
      await fs.writeFile(path.join(TEST_DIR, 'node_modules', 'package.md'), '# Package\nContent');

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.5,
        indexPath: INDEX_PATH,
        autoIndex: true,
        indexDocs: true // Enable generic docs indexing
      });

      await manager.initialize();
      const result = await manager.indexRepository(TEST_DIR, false);

      // Should only index included.md, not node_modules
      expect(result.indexed).toBe(1);
    }, 15000); // Increased timeout for Ollama operations
  });

  describe('Search Functionality', () => {
    it('should find content from indexed files', async () => {
      await fs.writeFile(path.join(TEST_DIR, 'auth.md'), `# Authentication System

We use JWT tokens for authentication. The middleware validates token expiry
and checks user permissions before allowing access.`);

      await fs.writeFile(path.join(TEST_DIR, 'database.md'), `# Database Design

PostgreSQL database with indexed foreign keys for performance. User table
has UUID primary keys for better privacy.`);

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.3,
        indexPath: INDEX_PATH,
        autoIndex: true,
        indexDocs: true // Enable generic docs indexing
      });

      await manager.initialize();
      await manager.indexRepository(TEST_DIR, false);

      // Search for authentication content
      const authResults = await manager.search({
        query: 'JWT token authentication',
        limit: 5,
        threshold: 0.3
      });

      expect(authResults.length).toBeGreaterThan(0);
      expect(authResults[0].sessionId).toContain('auth.md');

      // Search for database content
      const dbResults = await manager.search({
        query: 'PostgreSQL database indexes',
        limit: 5,
        threshold: 0.3
      });

      expect(dbResults.length).toBeGreaterThan(0);
      expect(dbResults[0].sessionId).toContain('database.md');
    }, 30000); // Increased timeout for indexing + searching multiple files
  });

  describe('Backward Compatibility', () => {
    it('should still work with JOURNAL.md format', async () => {
      await fs.writeFile(path.join(TEST_DIR, 'JOURNAL.md'), `## Session 1: Test (2025-01-08)

Test session content.

## Session 2: Another Test (2025-01-09)

More test content.`);

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.5,
        indexPath: INDEX_PATH,
        autoIndex: true
      });

      await manager.initialize();
      const result = await manager.indexRepository(TEST_DIR, false);

      // Should still parse as journal (2 sessions)
      expect(result.indexed).toBe(2);
    }, 20000); // Increased timeout for journal parsing + indexing

    it('should still work with hierarchical sessions/', async () => {
      const sessionsDir = path.join(TEST_DIR, 'sessions', 'Session_01_2025-01-08');
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(path.join(sessionsDir, 'SESSION_DETAIL.md'), `# Session 1
Content here`);

      const manager = new MemoryManager({
        enabled: true,
        provider: 'ollama',
        model: 'mxbai-embed-large',
        threshold: 0.5,
        indexPath: INDEX_PATH,
        autoIndex: true
      });

      await manager.initialize();
      const result = await manager.indexRepository(TEST_DIR, false);

      expect(result.indexed).toBe(1);
    }, 15000); // Increased timeout for hierarchical structure indexing
  });
});
