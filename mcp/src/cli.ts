#!/usr/bin/env node

/**
 * Gordo Memory CLI
 * Command-line interface for semantic memory operations
 */

import { Command } from 'commander';
import { MemoryManager } from './memory-manager-v2.js';
import { GraphManager } from './graph-manager.js';
import type { MemoryConfig } from './types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

const program = new Command();

/**
 * Check if gordo-memory is initialized (index directory exists)
 */
async function checkInitialized(indexPath: string): Promise<boolean> {
  return existsSync(indexPath);
}

/**
 * Validate that a path exists
 */
async function validatePath(targetPath: string): Promise<void> {
  try {
    await fs.stat(targetPath);
  } catch (error) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }
}

async function loadConfig(repoPath: string): Promise<MemoryConfig> {
  const DEFAULT_CONFIG: MemoryConfig = {
    enabled: true,
    provider: 'ollama',
    model: 'mxbai-embed-large',
    threshold: 0.5,
    indexPath: path.join(repoPath, '.gordo-memory'),
    autoIndex: true,
    openaiApiKey: process.env.OPENAI_API_KEY,
  };

  try {
    const configPath = path.join(repoPath, 'config.json');
    const configContent = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    return {
      ...DEFAULT_CONFIG,
      ...config.memory?.semantic,
      indexPath: path.join(repoPath, config.memory?.semantic?.indexPath || '.gordo-memory'),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

async function saveConfig(repoPath: string, config: Partial<MemoryConfig>): Promise<void> {
  const configPath = path.join(repoPath, 'config.json');

  let existingConfig: any = {};
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    existingConfig = JSON.parse(content);
  } catch {
    // No existing config, start fresh
  }

  // Merge with existing config
  const updatedConfig = {
    ...existingConfig,
    memory: {
      ...existingConfig.memory,
      semantic: {
        ...existingConfig.memory?.semantic,
        enabled: config.enabled !== undefined ? config.enabled : true,
        provider: config.provider,
        model: config.model,
        threshold: config.threshold,
        indexPath: '.gordo-memory',
        autoIndex: config.autoIndex !== undefined ? config.autoIndex : true,
      },
    },
  };

  await fs.writeFile(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8');
}

program
  .name('gordo-memory')
  .description('Semantic memory search for Gordo Framework journals')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize memory index for current repository')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('--provider <provider>', 'Embedding provider (ollama, openai, hybrid)')
  .option('--model <model>', 'Embedding model name')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      // CLI flags override config.json
      if (options.provider) {
        config.provider = options.provider;
      }
      if (options.model) {
        config.model = options.model;
      }

      // Save config before initializing
      await saveConfig(options.path, config);

      const manager = new MemoryManager(config);

      console.log('Initializing memory index...');
      console.log(`  Provider: ${config.provider}`);
      console.log(`  Model: ${config.model}`);
      await manager.initialize();
      console.log(`✓ Index initialized at ${config.indexPath}`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('index')
  .description('Index journal sessions')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('--incremental', 'Only index new sessions', true)
  .option('--full', 'Force full reindex', false)
  .option('--provider <provider>', 'Embedding provider (ollama, openai, hybrid)')
  .option('--model <model>', 'Embedding model name')
  .action(async (options) => {
    try {
      // Validate path exists
      await validatePath(options.path);

      const config = await loadConfig(options.path);

      // CLI flags override config.json
      if (options.provider) {
        config.provider = options.provider;
      }
      if (options.model) {
        config.model = options.model;
      }

      const manager = new MemoryManager(config);

      console.log('Indexing sessions...');

      // Progress callback for visual feedback
      const onProgress = (current: number, total: number, stage: string) => {
        if (total === 0) {
          // Initial stages without known total
          process.stderr.write(`\r${stage}`);
        } else {
          const percent = Math.round((current / total) * 100);
          const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
          process.stderr.write(`\r${stage} [${bar}] ${current}/${total} (${percent}%)`);
        }
      };

      if (options.full) {
        const result = await manager.reindex(options.path, onProgress);
        process.stderr.write('\r' + ' '.repeat(80) + '\r'); // Clear progress line
        console.log(`✓ Reindexed ${result.indexed} sessions`);

        // Warn if no sessions indexed
        if (result.indexed === 0) {
          console.log('\n⚠️  Warning: Indexed 0 sessions');
          console.log('\nExpected journal format:');
          console.log('  - JOURNAL.md with sessions: ## Session N: Title (YYYY-MM-DD)');
          console.log('  - OR sessions/ directory with Session_XX_YYYY-MM-DD/ subdirectories');
          console.log('\nSee documentation for format examples.');
        }
      } else {
        const result = await manager.indexRepository(options.path, options.incremental, onProgress);
        process.stderr.write('\r' + ' '.repeat(80) + '\r'); // Clear progress line
        console.log(`✓ Indexed ${result.indexed} new sessions, skipped ${result.skipped} existing`);

        // Warn if no sessions indexed
        if (result.indexed === 0 && result.skipped === 0) {
          console.log('\n⚠️  Warning: Indexed 0 sessions');
          console.log('\nExpected journal format:');
          console.log('  - JOURNAL.md with sessions: ## Session N: Title (YYYY-MM-DD)');
          console.log('  - OR sessions/ directory with Session_XX_YYYY-MM-DD/ subdirectories');
          console.log('\nSee documentation for format examples.');
        }
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('search')
  .description('Search journal sessions semantically')
  .argument('<query>', 'Search query')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('-l, --limit <number>', 'Maximum results', '5')
  .option('-t, --threshold <number>', 'Similarity threshold (0-1)', '0.5')
  .option('-v, --verbose', 'Show verbose output with full summaries')
  .action(async (query, options) => {
    try {
      const config = await loadConfig(options.path);

      // Check if initialized
      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-memory not initialized');
        console.error(`\nRun: gordo-memory init`);
        console.error(`(from directory: ${options.path})`);
        process.exit(1);
      }

      const manager = new MemoryManager(config);

      const threshold = parseFloat(options.threshold);
      const results = await manager.search({
        query,
        limit: parseInt(options.limit),
        threshold,
      });

      if (results.length === 0) {
        console.log('No results found. Try: -t 0.3');
        return;
      }

      if (options.verbose) {
        // Verbose format (original)
        results.forEach((result, index) => {
          console.log(`${index + 1}. ${result.sessionId} (${result.date})`);
          console.log(`   Similarity: ${(result.similarity * 100).toFixed(1)}%`);
          if (result.summary) {
            console.log(`   Summary: ${result.summary}`);
          }
          if (result.content) {
            const snippet = result.content.substring(0, 200).replace(/\n/g, ' ').trim();
            console.log(`   Preview: ${snippet}...`);
          }
          console.log();
        });
      } else {
        // Compact format (default): one line per result with content snippet
        // Derive source path from ID for direct file access (only show if different from ID)
        const derivePath = (id: string): string | null => {
          if (id.includes('/')) return null; // ID is already the path
          if (id.startsWith('Session_')) return 'SESSION_LOG.md';
          if (id.startsWith('commit-')) return `git-commits/${id}.md`;
          if (id.startsWith('issue-')) return `github-issues/${id}.md`;
          return null;
        };

        results.forEach(result => {
          const pct = (result.similarity * 100).toFixed(0).padStart(2);
          const path = derivePath(result.sessionId);
          const pathHint = path ? ` → ${path}` : '';
          const snippet = (result.content || result.summary || '')
            .substring(0, 55)
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          console.log(`${pct}% ${result.sessionId}${pathHint} — ${snippet}...`);
        });
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('get')
  .description('Get a specific session by ID')
  .argument('<sessionId>', 'Session ID (e.g., Session_01)')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (sessionId, options) => {
    try {
      const config = await loadConfig(options.path);

      // Check if initialized
      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-memory not initialized');
        console.error(`\nRun: gordo-memory init`);
        process.exit(1);
      }

      const manager = new MemoryManager(config);

      const session = await manager.getSession(sessionId);

      if (!session) {
        console.log(`Session ${sessionId} not found`);
        process.exit(1);
      }

      console.log(`Session: ${session.id}`);
      console.log(`Date: ${session.date}`);
      if (session.summary) {
        console.log(`Summary: ${session.summary}`);
      }
      if (session.patterns && session.patterns.length > 0) {
        console.log(`Patterns: ${session.patterns.join(', ')}`);
      }
      if (session.issues && session.issues.length > 0) {
        console.log(`Issues: #${session.issues.join(', #')}`);
      }
      console.log(`\nContent:\n${session.content}`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show memory index statistics')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      // Check if initialized
      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-memory not initialized');
        console.error(`\nRun: gordo-memory init`);
        process.exit(1);
      }

      const manager = new MemoryManager(config);

      const stats = await manager.getStats();

      console.log('Memory Index Statistics:');
      console.log(`  Total indexed documents: ${stats.totalIndexedDocuments}`);
      console.log(`  Provider: ${stats.provider}`);
      console.log(`  Threshold: ${config.threshold.toFixed(2)} (default)`);
      console.log(`  Index path: ${stats.indexPath}`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

// Knowledge Graph Commands

program
  .command('build-graph')
  .description('Build knowledge graph from journal sessions')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('--reindex', 'Force rebuild of entire graph', false)
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      // Check if initialized
      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        throw new Error('gordo-memory not initialized\n\nRun: gordo-memory init\n(from directory: ' + options.path + ')');
      }

      const manager = new MemoryManager(config);
      await manager.initialize();

      // Get all sessions
      const sessions = await manager.getAllSessions();

      // Initialize graph manager
      const graphManager = new GraphManager({
        indexPath: config.indexPath,
        provider: config.provider as 'openai' | 'ollama',
        model: config.model,
        apiKey: config.openaiApiKey,
        ollamaUrl: 'http://localhost:11434'
      });

      await graphManager.initialize();

      console.log('Building knowledge graph...');

      // Progress callback for visual feedback
      const onProgress = (current: number, total: number, stage: string) => {
        if (total === 0) {
          process.stderr.write(`\r${stage}`);
        } else {
          const percent = Math.round((current / total) * 100);
          const bar = '█'.repeat(Math.floor(percent / 5)) + '░'.repeat(20 - Math.floor(percent / 5));
          process.stderr.write(`\r${stage} [${bar}] ${current}/${total} (${percent}%)`);
        }
      };

      const result = await graphManager.buildGraph(sessions, options.reindex, onProgress);
      process.stderr.write('\r' + ' '.repeat(80) + '\r'); // Clear progress line

      if (options.reindex) {
        console.log(`✓ Rebuilt knowledge graph: ${result.nodesCreated} nodes, ${result.edgesCreated} edges`);
      } else {
        console.log(`✓ Built knowledge graph: ${result.nodesCreated} new nodes, ${result.edgesCreated} new edges, skipped ${result.skipped} existing`);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('query-dependencies')
  .description('Get sessions that a given session depends on')
  .argument('<sessionId>', 'Session ID (e.g., Session_01)')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (sessionId, options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        throw new Error('gordo-memory not initialized\n\nRun: gordo-memory init');
      }

      const graphManager = new GraphManager({
        indexPath: config.indexPath,
        provider: config.provider as 'openai' | 'ollama',
        model: config.model,
        apiKey: config.openaiApiKey,
        ollamaUrl: 'http://localhost:11434'
      });

      await graphManager.initialize();

      const result = await graphManager.queryDependencies(sessionId);

      if (result.directDependencies.length === 0 && result.transitiveDependencies.length === 0) {
        console.log(`No dependencies found for ${sessionId}`);
      } else {
        console.log(`\nDependencies for ${sessionId}:`);

        if (result.directDependencies.length > 0) {
          console.log('\nDirect dependencies:');
          for (const dep of result.directDependencies) {
            console.log(`  ${dep.id} - ${dep.title}`);
          }
        }

        if (result.transitiveDependencies.length > 0) {
          console.log('\nTransitive dependencies:');
          for (const dep of result.transitiveDependencies) {
            console.log(`  ${dep.id} - ${dep.title}`);
          }
        }

        console.log(`\nMax dependency depth: ${result.depth}`);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('find-path')
  .description('Find relationship path between two sessions')
  .argument('<from>', 'Start session ID')
  .argument('<to>', 'End session ID')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (from, to, options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        throw new Error('gordo-memory not initialized\n\nRun: gordo-memory init');
      }

      const graphManager = new GraphManager({
        indexPath: config.indexPath,
        provider: config.provider as 'openai' | 'ollama',
        model: config.model,
        apiKey: config.openaiApiKey,
        ollamaUrl: 'http://localhost:11434'
      });

      await graphManager.initialize();

      const path = await graphManager.findPath(from, to);

      if (!path) {
        console.log(`No path found between ${from} and ${to}`);
      } else {
        console.log(`\nPath from ${from} to ${to}:`);
        console.log(`  Length: ${path.length} steps`);
        console.log(`  Nodes: ${path.nodes.join(' → ')}`);
        console.log('\nEdges:');
        for (const edge of path.edges) {
          console.log(`  ${edge.source} → ${edge.target} (${edge.type})`);
        }
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('query-patterns')
  .description('Find sessions with a specific pattern')
  .argument('<pattern>', 'Pattern name (e.g., oauth, database, deployment)')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (pattern, options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        throw new Error('gordo-memory not initialized\n\nRun: gordo-memory init');
      }

      const graphManager = new GraphManager({
        indexPath: config.indexPath,
        provider: config.provider as 'openai' | 'ollama',
        model: config.model,
        apiKey: config.openaiApiKey,
        ollamaUrl: 'http://localhost:11434'
      });

      await graphManager.initialize();

      const result = await graphManager.queryPatterns(pattern);

      if (!result.pattern) {
        console.log(`No pattern found matching: ${pattern}`);
      } else {
        console.log(`\nPattern: ${result.pattern.name}`);
        console.log(`Description: ${result.pattern.description}`);
        console.log(`First seen: ${result.pattern.firstSeen}`);
        console.log(`Occurrences: ${result.pattern.occurrences}`);
        console.log(`Trend: ${result.trend}`);

        if (result.sessions.length > 0) {
          console.log(`\nSessions with this pattern (${result.sessions.length}):`);
          for (const session of result.sessions) {
            console.log(`  ${session.id} (${session.date}) - ${session.title}`);
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('delete')
  .description('Delete files from the index (for handling deleted files)')
  .argument('<files...>', 'File paths to remove from index')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (files, options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        throw new Error('gordo-memory not initialized\n\nRun: gordo-memory init');
      }

      const manager = new MemoryManager(config);
      await manager.initialize();

      const indexer = (manager as any).indexer; // Access private indexer

      let deleted = 0;
      for (const file of files) {
        try {
          await indexer.deleteDocument(file);
          deleted++;
        } catch (err) {
          // File might not be in index, continue
        }
      }

      console.log(`Deleted ${deleted} file(s) from index`);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program.parse();
