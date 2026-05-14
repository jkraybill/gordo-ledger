/**
 * Production Build Tests - Regression tests for build artifacts
 *
 * **WHY THIS EXISTS:**
 * Tests import from ../src/ (TypeScript) and run through Vitest transpilation.
 * They never test the actual production build (dist/ compiled JavaScript).
 *
 * **WHAT WE MISSED:**
 * Session 40: CommonJS/ESM import bug in hnsw-indexer.ts
 * - Tests passed (TypeScript import worked)
 * - Production failed (compiled JavaScript import failed)
 * - Bug caught by smoke test, not automated tests (TDD FAILURE)
 *
 * **WHAT THIS FILE TESTS:**
 * 1. Production build exists and is executable
 * 2. CLI commands work with compiled code
 * 3. Module imports work in production (CommonJS/ESM compatibility)
 * 4. MCP server initializes with production build
 *
 * **RUN THESE TESTS:**
 * - Before every release
 * - After any import changes
 * - After any build configuration changes
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

describe('Production Build Validation', () => {
  const testRepo = '.test-prod-build-repo';

  beforeAll(async () => {
    // Create test repository structure
    await fs.mkdir(testRepo, { recursive: true });
    await fs.writeFile(
      path.join(testRepo, 'config.json'),
      JSON.stringify({
        memory: {
          semantic: {
            enabled: true,
            provider: 'ollama',
            model: 'mxbai-embed-large',
            threshold: 0.75,
            indexPath: '.gordo-memory',
            autoIndex: true
          }
        }
      }, null, 2)
    );

    // Create minimal journal
    await fs.writeFile(
      path.join(testRepo, 'JOURNAL.md'),
      `# Session Journal\n\n## Session 1: Test (2025-01-01)\n\nTest content.\n`
    );
  });

  afterAll(async () => {
    try {
      await fs.rm(testRepo, { recursive: true });
    } catch (e) {
      // Ignore
    }
  });

  describe('CLI Executable Tests', () => {
    // Use node dist/cli.js directly — doesn't require global npm install
    const cli = `node ${path.resolve('dist/cli.js')}`;

    it('should execute gordo-memory --version', async () => {
      const { stdout } = await execAsync(`${cli} --version`);
      expect(stdout).toContain('0.1.0');
    });

    it('should execute gordo-memory init in test repo', async () => {
      const { stdout } = await execAsync(`cd ${testRepo} && ${cli} init`);
      expect(stdout).toContain('initialized');
    });

    it('should execute gordo-memory stats in test repo', async () => {
      const { stdout } = await execAsync(`cd ${testRepo} && ${cli} stats`);
      expect(stdout).toContain('Memory Index Statistics');
      expect(stdout).toContain('Total indexed documents:');
      expect(stdout).toContain('Provider:');
    });

    it('should handle errors gracefully (missing config)', async () => {
      try {
        await execAsync(`cd /tmp && ${cli} stats`);
        // Should not reach here
        expect(true).toBe(false);
      } catch (error: any) {
        // Should error, but gracefully
        expect(error.code).toBeGreaterThan(0);
      }
    });
  });

  describe('Module Import Tests (Regression for CommonJS/ESM bug)', () => {
    it('should import hnswlib-node in production build', async () => {
      // This test validates the exact bug we had in Session 40
      // If the import is wrong, this will crash with:
      // "SyntaxError: Named export 'HierarchicalNSW' not found"

      const testScript = `
        import { createHNSWIndexer } from './dist/indexer/hnsw-indexer.js';

        const indexer = createHNSWIndexer({
          indexPath: '.test-import-validation',
          vectorSize: 1024
        });

        await indexer.initialize();
        await indexer.close();

        console.log('Import successful');
      `;

      const testFile = '.test-import-script.mjs';
      await fs.writeFile(testFile, testScript);

      try {
        const { stdout } = await execAsync(`node ${testFile}`);
        expect(stdout).toContain('Import successful');
      } finally {
        await fs.unlink(testFile);
        try {
          await fs.rm('.test-import-validation', { recursive: true });
        } catch (e) {
          // Ignore
        }
      }
    });

    it('should import all production modules without errors', async () => {
      const testScript = `
        // Test all major exports
        import { createJournalParser } from './dist/parser/journal-parser-v2.js';
        import { createEmbeddingProvider } from './dist/embeddings/provider.js';
        import { createHNSWIndexer } from './dist/indexer/hnsw-indexer.js';
        import { MemoryManager } from './dist/memory-manager-v2.js';

        console.log('All imports successful');
      `;

      const testFile = '.test-all-imports.mjs';
      await fs.writeFile(testFile, testScript);

      try {
        const { stdout } = await execAsync(`node ${testFile}`);
        expect(stdout).toContain('All imports successful');
      } finally {
        await fs.unlink(testFile);
      }
    });
  });

  describe('MCP Server Initialization Tests', () => {
    it('should load MCP server module without crashing', async () => {
      // Test that MCP server module can be imported
      // This would have caught the Session 40 bug immediately

      const testScript = `
        // Just importing should work without crashes
        import './dist/index.js';

        // If we get here, import succeeded
        console.log('MCP server module loaded');
      `;

      const testFile = '.test-mcp-init.mjs';
      await fs.writeFile(testFile, testScript);

      try {
        // This will fail if there are import errors (like CommonJS/ESM bugs)
        const { stdout } = await execAsync(`node ${testFile}`, { timeout: 10000 });
        expect(stdout).toContain('MCP server module loaded');
      } catch (error: any) {
        // If the MCP server started successfully, it will keep running
        // and be killed by timeout or SIGTERM. That's actually success!
        // We just want to ensure it doesn't crash on import.
        if (error.killed || error.signal === 'SIGTERM' || error.message.includes('timeout')) {
          // Check that it logged success before being killed
          expect(error.stdout || '').toContain('MCP server module loaded');
        } else {
          throw error;
        }
      } finally {
        try {
          await fs.unlink(testFile);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    }, 15000); // 15s timeout for MCP server loading
  });

  describe('Build Artifact Tests', () => {
    it('should have dist/ directory with compiled JavaScript', async () => {
      const distExists = await fs.access('dist').then(() => true).catch(() => false);
      expect(distExists).toBe(true);
    });

    it('should have all expected compiled modules in dist/', async () => {
      const expectedModules = [
        'dist/indexer/hnsw-indexer.js',
        'dist/parser/journal-parser-v2.js',
        'dist/embeddings/provider.js',
        'dist/memory-manager-v2.js',
        'dist/index.js',
        'dist/cli.js'
      ];

      for (const module of expectedModules) {
        const exists = await fs.access(module).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      }
    });

    it('should have package.json bin pointing to compiled CLI', async () => {
      const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8'));
      expect(packageJson.bin['gordo-memory']).toBe('dist/cli.js');
    });
  });
});
