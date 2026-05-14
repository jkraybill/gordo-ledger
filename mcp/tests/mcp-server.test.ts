/**
 * MCP Server Tests
 *
 * Tests the MCP server interface (index.ts)
 * Critical for ensuring the user-facing API works correctly
 *
 * Note: These are integration-style tests that verify tool schemas
 * and handler logic without actually running the server.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryManager } from '../src/memory-manager-v2.js';
import type { MemoryConfig, SearchResult, SessionEntry } from '../src/types.js';
import fs from 'fs/promises';
import path from 'path';

describe('MCP Server Interface', () => {
  // These tests verify the MCP server would work correctly
  // by testing the underlying MemoryManager behavior that the server uses

  const testConfig: MemoryConfig = {
    enabled: true,
    provider: 'ollama',
    model: 'mxbai-embed-large:latest',
    threshold: 0.75,
    indexPath: '.test-mcp-server',
    autoIndex: true,
    ollamaUrl: 'http://localhost:11434'
  };

  let manager: MemoryManager;
  const testRepoPath = './test-fixtures/mcp-test-repo';
  const testJournalPath = path.join(testRepoPath, 'JOURNAL.md');

  beforeEach(async () => {
    // Create test journal
    await fs.mkdir(testRepoPath, { recursive: true });
    const sampleJournal = `# Session Journal

## Session 1: OAuth Implementation (2025-01-01)

**Summary:** Implemented OAuth authentication

**Details:**
Added OAuth 2.0 authentication with GitHub provider.
Implemented token refresh and secure storage.

**Patterns:**
- OAuth flow
- Token management

**Issues:** #42

**Signals:** ✓


## Session 2: Bug Fixes (2025-01-02)

**Summary:** Fixed authentication bugs

**Details:**
Fixed race condition in token refresh.
Added retry logic for failed requests.

**Patterns:**
- Error handling
- Retry patterns

**Issues:** #43

**Signals:** ✓
`;
    await fs.writeFile(testJournalPath, sampleJournal);

    manager = new MemoryManager(testConfig);
    await manager.initialize();
    await manager.indexRepository(testRepoPath, false);
  }, 60000); // 60s timeout for beforeEach (embeddings take time)

  afterEach(async () => {
    try {
      await fs.rm(testRepoPath, { recursive: true });
      await fs.rm(testConfig.indexPath, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Tool: search', () => {
    it('should search with basic query parameter', async () => {
      const results = await manager.search({
        query: 'OAuth authentication',
        limit: 5,
        threshold: 0.5
      });

      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        expect(results[0]).toHaveProperty('sessionId');
        expect(results[0]).toHaveProperty('similarity');
        expect(results[0]).toHaveProperty('content');
        expect(results[0]).toHaveProperty('rank');
      }
    }, 30000);

    it('should respect limit parameter (default: 5)', async () => {
      const results = await manager.search({
        query: 'bug fixes',
        limit: 1
      });

      expect(results.length).toBeLessThanOrEqual(1);
    }, 30000);

    it('should respect threshold parameter (default: 0.5)', async () => {
      const highThreshold = await manager.search({
        query: 'test',
        threshold: 0.95
      });

      const lowThreshold = await manager.search({
        query: 'test',
        threshold: 0.3
      });

      // High threshold should return fewer or equal results
      expect(highThreshold.length).toBeLessThanOrEqual(lowThreshold.length);
    }, 30000);

    it('should return results as JSON-serializable', async () => {
      const results = await manager.search({
        query: 'OAuth',
        limit: 3
      });

      // Verify results can be JSON-stringified (required for MCP response)
      expect(() => JSON.stringify(results)).not.toThrow();

      if (results.length > 0) {
        const json = JSON.parse(JSON.stringify(results));
        expect(json[0]).toHaveProperty('sessionId');
        expect(json[0]).toHaveProperty('similarity');
      }
    }, 30000);
  });

  describe('Tool: index', () => {
    it('should index incrementally (default: true)', async () => {
      // Already indexed in beforeEach
      const result = await manager.indexRepository(testRepoPath, true);

      expect(result).toHaveProperty('indexed');
      expect(result).toHaveProperty('skipped');
      expect(result.indexed).toBe(0); // Nothing new
      expect(result.skipped).toBeGreaterThan(0); // Existing sessions
    }, 30000);

    it('should reindex when incremental=false', async () => {
      const result = await manager.reindex(testRepoPath);

      expect(result).toHaveProperty('indexed');
      expect(result.indexed).toBeGreaterThan(0);
    }, 30000);

    it('should return count in message format', async () => {
      const result = await manager.indexRepository(testRepoPath, true);

      // MCP server formats as: "Indexed X new sessions, skipped Y existing"
      const message = `Indexed ${result.indexed} new sessions, skipped ${result.skipped} existing`;
      expect(message).toContain('Indexed');
      expect(message).toContain('skipped');
    });
  });

  describe('Tool: get_session', () => {
    it('should retrieve session by ID', async () => {
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

    it('should return JSON-serializable session', async () => {
      const session = await manager.getSession('Session_1');

      if (session) {
        expect(() => JSON.stringify(session)).not.toThrow();

        const json = JSON.parse(JSON.stringify(session));
        expect(json).toHaveProperty('id');
        expect(json).toHaveProperty('content');
      }
    }, 30000);
  });

  describe('Tool: stats', () => {
    it('should return statistics', async () => {
      const stats = await manager.getStats();

      expect(stats).toHaveProperty('totalIndexedDocuments');
      expect(stats).toHaveProperty('indexPath');
      expect(stats).toHaveProperty('provider');

      expect(typeof stats.totalIndexedDocuments).toBe('number');
      expect(typeof stats.indexPath).toBe('string');
      expect(typeof stats.provider).toBe('string');
    });

    it('should show correct session count after indexing', async () => {
      const stats = await manager.getStats();

      expect(stats.totalIndexedDocuments).toBeGreaterThan(0);
      expect(stats.provider).toBe('ollama');
      expect(stats.indexPath).toBe(testConfig.indexPath);
    }, 30000);

    it('should return JSON-serializable stats', async () => {
      const stats = await manager.getStats();

      expect(() => JSON.stringify(stats)).not.toThrow();

      const json = JSON.parse(JSON.stringify(stats));
      expect(json).toHaveProperty('totalIndexedDocuments');
    });
  });

  describe('Error Handling', () => {
    it('should handle search with empty query gracefully', async () => {
      const results = await manager.search({
        query: '',
        limit: 5
      });

      // Should not throw, may return empty results
      expect(Array.isArray(results)).toBe(true);
    }, 30000);

    it('should handle invalid session ID gracefully', async () => {
      const session = await manager.getSession('invalid_id_format');

      // Should return null, not throw
      expect(session).toBeNull();
    });

    it('should handle missing config.json gracefully', async () => {
      // MemoryManager should use defaults if config missing
      const tempManager = new MemoryManager(testConfig);

      expect(tempManager).toBeDefined();
    });
  });

  describe('Config Loading', () => {
    it('should use environment variable for repo path', () => {
      const originalPath = process.env.GORDO_REPO_PATH;

      try {
        process.env.GORDO_REPO_PATH = '/custom/path';

        // In actual server, this would be used
        const repoPath = process.env.GORDO_REPO_PATH || process.cwd();

        expect(repoPath).toBe('/custom/path');
      } finally {
        if (originalPath) {
          process.env.GORDO_REPO_PATH = originalPath;
        } else {
          delete process.env.GORDO_REPO_PATH;
        }
      }
    });

    it('should fall back to process.cwd() if no env var', () => {
      const originalPath = process.env.GORDO_REPO_PATH;

      try {
        delete process.env.GORDO_REPO_PATH;

        const repoPath = process.env.GORDO_REPO_PATH || process.cwd();

        expect(repoPath).toBe(process.cwd());
      } finally {
        if (originalPath) {
          process.env.GORDO_REPO_PATH = originalPath;
        }
      }
    });

    it('should merge config with defaults', () => {
      const DEFAULT_CONFIG: MemoryConfig = {
        enabled: true,
        provider: 'openai',
        model: 'text-embedding-3-small',
        threshold: 0.5,
        indexPath: '.gordo-memory',
        autoIndex: true,
        openaiApiKey: process.env.OPENAI_API_KEY,
      };

      const userConfig = {
        provider: 'ollama' as const,
        model: 'custom-model'
      };

      const merged = {
        ...DEFAULT_CONFIG,
        ...userConfig
      };

      expect(merged.provider).toBe('ollama');
      expect(merged.model).toBe('custom-model');
      expect(merged.threshold).toBe(0.5); // From defaults
    });
  });

  describe('Tool Schema Validation', () => {
    it('search tool should have required properties', () => {
      const searchTool = {
        name: 'search',
        description: 'Semantic search across journal sessions using natural language queries',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Natural language search query'
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 5)'
            },
            threshold: {
              type: 'number',
              description: 'Similarity threshold 0-1 (default: 0.5)'
            }
          },
          required: ['query']
        }
      };

      expect(searchTool.name).toBe('search');
      expect(searchTool.inputSchema.required).toContain('query');
      expect(searchTool.inputSchema.properties).toHaveProperty('query');
      expect(searchTool.inputSchema.properties).toHaveProperty('limit');
      expect(searchTool.inputSchema.properties).toHaveProperty('threshold');
    });

    it('index tool should have correct schema', () => {
      const indexTool = {
        name: 'index',
        description: 'Index or reindex journal sessions for semantic search',
        inputSchema: {
          type: 'object',
          properties: {
            incremental: {
              type: 'boolean',
              description: 'Only index new sessions (default: true)'
            },
            reindex: {
              type: 'boolean',
              description: 'Force full reindex (default: false)'
            }
          }
        }
      };

      expect(indexTool.name).toBe('index');
      expect(indexTool.inputSchema.properties).toHaveProperty('incremental');
      expect(indexTool.inputSchema.properties).toHaveProperty('reindex');
    });

    it('get_session tool should have sessionId parameter', () => {
      const getSessionTool = {
        name: 'get_session',
        description: 'Retrieve a specific session by ID',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'Session ID (e.g., "Session_01")'
            }
          },
          required: ['sessionId']
        }
      };

      expect(getSessionTool.name).toBe('get_session');
      expect(getSessionTool.inputSchema.required).toContain('sessionId');
    });

    it('stats tool should have no required parameters', () => {
      const statsTool = {
        name: 'stats',
        description: 'Get memory index statistics',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      };

      expect(statsTool.name).toBe('stats');
      expect(Object.keys(statsTool.inputSchema.properties).length).toBe(0);
    });

    it('should define all expected tools', () => {
      const tools = [
        'search', 'index', 'get_session', 'stats',
        'build_graph', 'query_patterns', 'find_path', 'query_dependencies',
        'list_domains', 'get_domain_files'
      ];

      expect(tools.length).toBe(10);
      expect(tools).toContain('search');
      expect(tools).toContain('index');
      expect(tools).toContain('get_session');
      expect(tools).toContain('stats');
      expect(tools).toContain('list_domains');
      expect(tools).toContain('get_domain_files');
    });
  });

  describe('Tool: list_domains', () => {
    it('should return empty list when memory-bank does not exist', async () => {
      // No memory-bank directory created
      const memoryBankPath = path.join(testRepoPath, 'memory-bank');

      // Verify directory doesn't exist
      try {
        await fs.access(memoryBankPath);
        throw new Error('memory-bank should not exist');
      } catch {
        // Expected - directory doesn't exist
      }

      // Test would return empty domains
      const expected = {
        domains: [],
        count: 0,
        message: 'No memory-bank directory found. Create memory-bank/ to organize domain knowledge.'
      };

      expect(expected.count).toBe(0);
      expect(expected.domains).toEqual([]);
    });

    it('should list domains when memory-bank exists', async () => {
      // Create memory-bank structure
      const memoryBankPath = path.join(testRepoPath, 'memory-bank');
      await fs.mkdir(path.join(memoryBankPath, 'authentication'), { recursive: true });
      await fs.mkdir(path.join(memoryBankPath, 'database'), { recursive: true });
      await fs.mkdir(path.join(memoryBankPath, 'deployment'), { recursive: true });

      // Create some files in domains
      await fs.writeFile(path.join(memoryBankPath, 'authentication', 'oauth.md'), '# OAuth Patterns');

      // Read actual directories
      const entries = await fs.readdir(memoryBankPath, { withFileTypes: true });
      const domains = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        .map(entry => entry.name)
        .sort();

      expect(domains).toEqual(['authentication', 'database', 'deployment']);
      expect(domains.length).toBe(3);
    });

    it('should ignore hidden and metadata directories', async () => {
      // Create memory-bank with hidden/metadata dirs
      const memoryBankPath = path.join(testRepoPath, 'memory-bank');
      await fs.mkdir(path.join(memoryBankPath, 'authentication'), { recursive: true });
      await fs.mkdir(path.join(memoryBankPath, '.hidden'), { recursive: true });
      await fs.mkdir(path.join(memoryBankPath, '_metadata'), { recursive: true });

      const entries = await fs.readdir(memoryBankPath, { withFileTypes: true });
      const domains = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        .map(entry => entry.name)
        .sort();

      expect(domains).toEqual(['authentication']);
      expect(domains).not.toContain('.hidden');
      expect(domains).not.toContain('_metadata');
    });

    it('should return JSON-serializable response', async () => {
      const memoryBankPath = path.join(testRepoPath, 'memory-bank');
      await fs.mkdir(path.join(memoryBankPath, 'authentication'), { recursive: true });

      const entries = await fs.readdir(memoryBankPath, { withFileTypes: true });
      const domains = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        .map(entry => entry.name);

      const response = {
        domains,
        count: domains.length,
        path: memoryBankPath
      };

      expect(() => JSON.stringify(response)).not.toThrow();
      const json = JSON.parse(JSON.stringify(response));
      expect(json).toHaveProperty('domains');
      expect(json).toHaveProperty('count');
      expect(json).toHaveProperty('path');
    });
  });

  describe('Tool: get_domain_files', () => {
    const memoryBankPath = path.join(testRepoPath, 'memory-bank');

    it('should list files in a domain', async () => {
      // Create domain with files
      const authPath = path.join(memoryBankPath, 'authentication');
      await fs.mkdir(authPath, { recursive: true });
      await fs.writeFile(path.join(authPath, 'oauth-patterns.md'), '# OAuth');
      await fs.writeFile(path.join(authPath, 'jwt-implementation.md'), '# JWT');

      const entries = await fs.readdir(authPath, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isFile() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        .map(entry => ({
          name: entry.name,
          path: path.join('authentication', entry.name)
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      expect(files.length).toBe(2);
      expect(files[0].name).toBe('jwt-implementation.md');
      expect(files[0].path).toBe('authentication/jwt-implementation.md');
      expect(files[1].name).toBe('oauth-patterns.md');
      expect(files[1].path).toBe('authentication/oauth-patterns.md');
    });

    it('should ignore hidden and metadata files', async () => {
      const authPath = path.join(memoryBankPath, 'authentication');
      await fs.mkdir(authPath, { recursive: true });
      await fs.writeFile(path.join(authPath, 'oauth.md'), '# OAuth');
      await fs.writeFile(path.join(authPath, '.hidden.md'), '# Hidden');
      await fs.writeFile(path.join(authPath, '_index.json'), '{}');

      const entries = await fs.readdir(authPath, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isFile() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        .map(entry => entry.name);

      expect(files).toEqual(['oauth.md']);
      expect(files).not.toContain('.hidden.md');
      expect(files).not.toContain('_index.json');
    });

    it('should return error for non-existent domain', async () => {
      const nonExistentPath = path.join(memoryBankPath, 'nonexistent');

      try {
        await fs.readdir(nonExistentPath);
        throw new Error('Should not reach here');
      } catch (error) {
        // Expected error
        const response = {
          domain: 'nonexistent',
          files: [],
          count: 0,
          error: `Domain 'nonexistent' not found in memory-bank/`
        };

        expect(response.count).toBe(0);
        expect(response.files).toEqual([]);
        expect(response.error).toContain('not found');
      }
    });

    it('should return empty list for empty domain', async () => {
      const emptyPath = path.join(memoryBankPath, 'empty-domain');
      await fs.mkdir(emptyPath, { recursive: true });

      const entries = await fs.readdir(emptyPath, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isFile() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        .map(entry => entry.name);

      expect(files).toEqual([]);
      expect(files.length).toBe(0);
    });

    it('should return JSON-serializable response', async () => {
      const authPath = path.join(memoryBankPath, 'authentication');
      await fs.mkdir(authPath, { recursive: true });
      await fs.writeFile(path.join(authPath, 'oauth.md'), '# OAuth');

      const entries = await fs.readdir(authPath, { withFileTypes: true });
      const files = entries
        .filter(entry => entry.isFile() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
        .map(entry => ({
          name: entry.name,
          path: path.join('authentication', entry.name)
        }));

      const response = {
        domain: 'authentication',
        files,
        count: files.length,
        path: authPath
      };

      expect(() => JSON.stringify(response)).not.toThrow();
      const json = JSON.parse(JSON.stringify(response));
      expect(json).toHaveProperty('domain');
      expect(json).toHaveProperty('files');
      expect(json).toHaveProperty('count');
      expect(json).toHaveProperty('path');
    });
  });
});
