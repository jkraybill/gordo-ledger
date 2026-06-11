#!/usr/bin/env node

/**
 * Gordo Ledger CLI
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
 * Check if gordo-ledger is initialized (index directory exists)
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

async function loadConfig(repoPath: string): Promise<MemoryConfig & { openrouterApiKey?: string }> {
  const DEFAULT_CONFIG: MemoryConfig & { openrouterApiKey?: string } = {
    enabled: true,
    provider: 'ollama',
    model: 'mxbai-embed-large',
    threshold: 0.5,
    indexPath: path.join(repoPath, '.gordo-memory'),
    autoIndex: true,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
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
  .name('gordo-ledger')
  .description('Semantic memory for Gordo umbrella projects')
  .version('1.0.0-rc1');

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
  .option('--extract', 'Extract conversations using EverMemOS (episodes + atomic facts)', false)
  .option('--index-code', 'Index code files (issue #9)', false)
  .option('--extract-code-facts', 'Use LLM to extract semantic facts from code (issue #9)', false)
  .option('--code-model <model>', 'Ollama model for code extraction', 'qwen2.5:3b')
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
      if (options.extract) {
        config.extractConversations = true;
      }
      // Issue #9: Code indexing flags
      if (options.indexCode) {
        config.indexCode = true;
      }
      if (options.extractCodeFacts) {
        config.indexCode = true;  // Also enable code indexing
        config.extractCodeFacts = true;
        config.codeExtractionModel = options.codeModel;
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
  .option('--since <date>', 'Filter results after this date (YYYY-MM-DD)')
  .option('--until <date>', 'Filter results before this date (YYYY-MM-DD)')
  .option('--type <types>', 'Filter by content type (comma-separated: session,issue,commit,docs,conversation)')
  .option('--federate <paths>', 'Also search additional repo paths (comma-separated)')
  .action(async (query, options) => {
    try {
      const config = await loadConfig(options.path);

      // Check if initialized
      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        console.error(`\nRun: gordo-ledger init`);
        console.error(`(from directory: ${options.path})`);
        process.exit(1);
      }

      const manager = new MemoryManager(config);

      const threshold = parseFloat(options.threshold);

      // Build search options
      const searchOpts: any = {
        query,
        limit: parseInt(options.limit),
        threshold,
      };

      // Date range filtering
      if (options.since || options.until) {
        searchOpts.dateRange = {
          start: options.since || '1970-01-01',
          end: options.until || '2099-12-31',
        };
      }

      // Content type filtering
      if (options.type) {
        searchOpts.contentTypes = options.type.split(',').map((t: string) => t.trim());
      }

      let results = await manager.search(searchOpts);

      // S338: Federated search across multiple repos
      if (options.federate) {
        const federatedPaths = options.federate.split(',').map((p: string) => p.trim());
        for (const fedPath of federatedPaths) {
          const resolvedPath = fedPath.startsWith('~')
            ? fedPath.replace('~', process.env.HOME || '')
            : fedPath;
          try {
            const fedConfig = await loadConfig(resolvedPath);
            const fedInitialized = await checkInitialized(fedConfig.indexPath);
            if (fedInitialized) {
              const fedManager = new MemoryManager(fedConfig);
              const fedResults = await fedManager.search(searchOpts);
              // Tag results with source repo
              fedResults.forEach(r => {
                (r as any).sourceRepo = fedPath;
              });
              results = [...results, ...fedResults];
            }
          } catch (e) {
            // Skip repos that fail to load
          }
        }
        // Re-sort combined results by similarity
        results.sort((a, b) => b.similarity - a.similarity);
        // Limit to requested count
        results = results.slice(0, parseInt(options.limit));
      }

      if (results.length === 0) {
        console.log('No results found. Try: -t 0.3');
        return;
      }

      // Layer distribution feedback (#1)
      const layerCounts: Record<string, number> = {};
      for (const r of results) {
        const layer = (r as any).contentType || 'unknown';
        layerCounts[layer] = (layerCounts[layer] || 0) + 1;
      }
      const layerSummary = Object.entries(layerCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');

      if (options.verbose) {
        // Verbose format (original)
        console.log(`Layers: ${layerSummary}\n`);
        results.forEach((result, index) => {
          const layer = (result as any).contentType || '';
          console.log(`${index + 1}. [${layer}] ${result.sessionId} (${result.date})`);
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
        // Show layer distribution at end
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
          // Prefer summary (abstract) over raw content for search results
          const snippet = (result.summary || result.content || '')
            .substring(0, 55)
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          console.log(`${pct}% ${result.sessionId}${pathHint} — ${snippet}...`);
        });
        // Layer distribution (#1)
        console.log(`\n(${layerSummary})`);
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
        console.error('Error: gordo-ledger not initialized');
        console.error(`\nRun: gordo-ledger init`);
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
  .command('similar')
  .description('Find documents similar to a given session/document')
  .argument('<sessionId>', 'ID of the document to find similar items for')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('-l, --limit <number>', 'Maximum results', '5')
  .action(async (sessionId, options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      const manager = new MemoryManager(config);

      const sourceDoc = await manager.getSession(sessionId);
      if (!sourceDoc) {
        console.error(`Document not found: ${sessionId}`);
        process.exit(1);
      }

      const limit = parseInt(options.limit);
      const results = await manager.search({
        query: sourceDoc.content.substring(0, 2000),
        limit: limit + 1,
        threshold: 0.3,
      });

      // Filter out self
      const filtered = results.filter(r => r.sessionId !== sessionId).slice(0, limit);

      if (filtered.length === 0) {
        console.log('No similar documents found.');
        return;
      }

      console.log(`Similar to ${sessionId}:\n`);
      filtered.forEach(r => {
        const pct = (r.similarity * 100).toFixed(0).padStart(2);
        const snippet = (r.summary || r.content || '').replace(/\s+/g, ' ').substring(0, 60);
        console.log(`${pct}% ${r.sessionId} — ${snippet}...`);
      });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show memory index statistics with freshness and layer breakdown')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);
      const indexPath = config.indexPath;

      // Check if initialized
      const initialized = await checkInitialized(indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        console.error(`\nRun: gordo-ledger init`);
        process.exit(1);
      }

      const manager = new MemoryManager(config);
      const stats = await manager.getStats();

      // Read metadata for layer breakdown
      const metadataPath = path.join(indexPath, 'metadata.json');
      let metadata: any = { documents: {} };
      try {
        const content = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(content);
      } catch {
        // No metadata yet
      }

      // Read extraction cache
      const cachePath = path.join(indexPath, 'extraction-cache.json');
      let cache: any = { entries: {} };
      try {
        const content = await fs.readFile(cachePath, 'utf-8');
        cache = JSON.parse(content);
      } catch {
        // No cache yet
      }

      // Count by content type
      const typeCounts: Record<string, number> = {};
      let newestDate = '';
      let oldestDate = '';
      for (const doc of Object.values(metadata.documents || {}) as any[]) {
        const type = doc.contentType || 'unknown';
        typeCounts[type] = (typeCounts[type] || 0) + 1;
        if (doc.indexedAt) {
          if (!newestDate || doc.indexedAt > newestDate) newestDate = doc.indexedAt;
          if (!oldestDate || doc.indexedAt < oldestDate) oldestDate = doc.indexedAt;
        }
      }

      const extractedCount = Object.keys(cache.entries || {}).length;

      console.log('=== Gordo Ledger Statistics ===\n');
      console.log(`Index path: ${indexPath}`);
      console.log(`Total indexed: ${stats.totalIndexedDocuments}`);
      console.log(`Provider: ${stats.provider}`);

      // Freshness indicator (#2)
      if (newestDate) {
        const age = Date.now() - new Date(newestDate).getTime();
        const ageStr = age < 60000 ? 'just now'
          : age < 3600000 ? `${Math.round(age / 60000)}m ago`
          : age < 86400000 ? `${Math.round(age / 3600000)}h ago`
          : `${Math.round(age / 86400000)}d ago`;
        console.log(`Last indexed: ${ageStr}`);
      }

      // Layer breakdown
      console.log('\nLayers:');
      for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type}: ${count}`);
      }

      // Extraction cache status
      const sessionCount = typeCounts['session'] || 0;
      const conversationCount = typeCounts['conversation'] || 0;
      if (extractedCount > 0 || sessionCount > 0) {
        console.log('\nExtraction:');
        console.log(`  Sessions: ${sessionCount}`);
        console.log(`  Extracted: ${conversationCount} conversations`);
        console.log(`  Cache: ${extractedCount} entries (v${cache.version || 'unknown'})`);
        if (sessionCount > 0) {
          const coverage = Math.round((conversationCount / sessionCount) * 100);
          console.log(`  Coverage: ${coverage}%`);
        }
      }

      // Index file size
      const indexFile = path.join(indexPath, 'index.hnsw');
      try {
        const fileStat = await fs.stat(indexFile);
        console.log(`Index size: ${(fileStat.size / 1024 / 1024).toFixed(2)} MB`);
      } catch {
        // Index file not found
      }
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
  .option('--extraction-provider <provider>', 'LLM provider for relationship extraction (openai, openrouter, ollama)')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      // Check if initialized
      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        throw new Error('gordo-ledger not initialized\n\nRun: gordo-ledger init\n(from directory: ' + options.path + ')');
      }

      const manager = new MemoryManager(config);
      await manager.initialize();

      // Get all sessions
      const sessions = await manager.getAllSessions();

      // Initialize graph manager
      // Extraction provider can differ from embedding provider (e.g., ollama embeddings + openrouter extraction)
      const extractionProvider = options.extractionProvider || config.provider;
      const extractionApiKey = extractionProvider === 'openrouter'
        ? config.openrouterApiKey
        : config.openaiApiKey;
      const extractionModel = extractionProvider === 'openrouter'
        ? 'openai/gpt-4o-mini'  // OpenRouter model path
        : extractionProvider === 'openai'
          ? 'gpt-4o-mini'
          : config.model;
      const graphManager = new GraphManager({
        indexPath: config.indexPath,
        provider: extractionProvider as 'openai' | 'openrouter' | 'ollama',
        model: extractionModel,
        apiKey: extractionApiKey,
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
        throw new Error('gordo-ledger not initialized\n\nRun: gordo-ledger init');
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
        throw new Error('gordo-ledger not initialized\n\nRun: gordo-ledger init');
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
        throw new Error('gordo-ledger not initialized\n\nRun: gordo-ledger init');
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
  .command('timeline')
  .description('Show activity distribution over time')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('--months <number>', 'Number of months to show', '6')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      const manager = new MemoryManager(config);
      const sessions = await manager.getAllSessions();

      // Group by month
      const monthCounts: Record<string, Record<string, number>> = {};
      for (const s of sessions) {
        if (!s.date) continue;
        const month = s.date.substring(0, 7); // YYYY-MM
        const type = s.contentType || 'unknown';
        if (!monthCounts[month]) monthCounts[month] = {};
        monthCounts[month][type] = (monthCounts[month][type] || 0) + 1;
      }

      // Get recent months
      const months = Object.keys(monthCounts)
        .sort()
        .slice(-parseInt(options.months));

      if (months.length === 0) {
        console.log('No timeline data available.');
        return;
      }

      console.log('Activity timeline:\n');
      const maxTotal = Math.max(...months.map(m =>
        Object.values(monthCounts[m]).reduce((a, b) => a + b, 0)
      ));

      for (const month of months) {
        const counts = monthCounts[month];
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const barLen = Math.round((total / maxTotal) * 30);
        const bar = '█'.repeat(barLen) + '░'.repeat(30 - barLen);
        const breakdown = Object.entries(counts)
          .map(([t, c]) => `${t[0]}:${c}`)
          .join(' ');
        console.log(`${month} [${bar}] ${total.toString().padStart(4)} (${breakdown})`);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('references')
  .description('Show issues and cross-references across sessions')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('-l, --limit <number>', 'Number of items to show', '20')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      const manager = new MemoryManager(config);
      const sessions = await manager.getAllSessions();

      // Count issue references
      const issueCounts: Record<string, number> = {};
      const sessionRefs: Record<string, number> = {};

      for (const s of sessions) {
        // Count issues
        for (const issue of s.issues || []) {
          const normalized = issue.replace(/^#/, '');
          issueCounts[normalized] = (issueCounts[normalized] || 0) + 1;
        }
        // Count session references from metadata
        const refs = s.metadata?.referencedSessions || [];
        for (const ref of refs) {
          sessionRefs[ref] = (sessionRefs[ref] || 0) + 1;
        }
      }

      const limit = parseInt(options.limit);

      // Show top issues
      const topIssues = Object.entries(issueCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

      if (topIssues.length > 0) {
        console.log('Most referenced issues:\n');
        for (const [issue, count] of topIssues) {
          console.log(`  ${count.toString().padStart(3)} × #${issue}`);
        }
      }

      // Show top session references
      const topSessions = Object.entries(sessionRefs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      if (topSessions.length > 0) {
        console.log('\nMost referenced sessions:\n');
        for (const [sess, count] of topSessions) {
          console.log(`  ${count.toString().padStart(3)} × S${sess}`);
        }
      }

      if (topIssues.length === 0 && topSessions.length === 0) {
        console.log('No references found. Run extraction to capture cross-references.');
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('topics')
  .description('Show common topics/patterns across the knowledge base')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('-l, --limit <number>', 'Number of topics to show', '20')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      const manager = new MemoryManager(config);
      const sessions = await manager.getAllSessions();

      // Count patterns across all sessions
      const patternCounts: Record<string, number> = {};
      for (const s of sessions) {
        for (const pattern of s.patterns || []) {
          const normalized = pattern.toLowerCase().trim();
          if (normalized.length > 2) {
            patternCounts[normalized] = (patternCounts[normalized] || 0) + 1;
          }
        }
      }

      // Sort by frequency
      const sorted = Object.entries(patternCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, parseInt(options.limit));

      if (sorted.length === 0) {
        console.log('No topics/patterns found. Run extraction to generate topics.');
        return;
      }

      console.log('Common topics:\n');
      for (const [topic, count] of sorted) {
        console.log(`  ${count.toString().padStart(3)} × ${topic}`);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('summarize')
  .description('Show a quick summary of the knowledge base')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);
      const indexPath = config.indexPath;

      const initialized = await checkInitialized(indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      // Read metadata
      const metadataPath = path.join(indexPath, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      const docs = Object.values(metadata.documents || {}) as any[];

      // Calculate stats
      const typeCounts: Record<string, number> = {};
      let earliest = '';
      let latest = '';
      let totalSize = 0;

      for (const doc of docs) {
        const type = doc.contentType || 'unknown';
        typeCounts[type] = (typeCounts[type] || 0) + 1;
        if (doc.date) {
          if (!earliest || doc.date < earliest) earliest = doc.date;
          if (!latest || doc.date > latest) latest = doc.date;
        }
        totalSize += doc.contentLength || 0;
      }

      // Read extraction cache
      let extractedCount = 0;
      try {
        const cachePath = path.join(indexPath, 'extraction-cache.json');
        const cache = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
        extractedCount = Object.keys(cache.entries || {}).length;
      } catch { /* no cache */ }

      console.log('=== Knowledge Base Summary ===\n');
      console.log(`Total documents: ${docs.length}`);
      console.log(`Date range: ${earliest || 'N/A'} to ${latest || 'N/A'}`);
      console.log(`Total content: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
      if (extractedCount > 0) {
        console.log(`Extracted: ${extractedCount} items`);
      }
      console.log('\nBy type:');
      for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
        const pct = ((count / docs.length) * 100).toFixed(0);
        console.log(`  ${type}: ${count} (${pct}%)`);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('export')
  .description('Export sessions to JSON or markdown')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('-o, --output <file>', 'Output file path')
  .option('-f, --format <format>', 'Output format: json or markdown', 'json')
  .option('--type <types>', 'Filter by content type (comma-separated)')
  .option('--since <date>', 'Export items after date (YYYY-MM-DD)')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      const manager = new MemoryManager(config);
      let sessions = await manager.getAllSessions();

      // Filter by type
      if (options.type) {
        const types = options.type.split(',').map((t: string) => t.trim());
        sessions = sessions.filter(s => types.includes(s.contentType || 'unknown'));
      }

      // Filter by date
      if (options.since) {
        sessions = sessions.filter(s => s.date >= options.since);
      }

      // Sort by date
      sessions.sort((a, b) => a.date.localeCompare(b.date));

      let output: string;
      if (options.format === 'markdown') {
        output = sessions.map(s => {
          return `# ${s.id}\n\n**Date:** ${s.date}\n\n${s.content}\n\n---\n`;
        }).join('\n');
      } else {
        output = JSON.stringify(sessions, null, 2);
      }

      if (options.output) {
        await fs.writeFile(options.output, output);
        console.log(`Exported ${sessions.length} items to ${options.output}`);
      } else {
        console.log(output);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('recent')
  .description('Show recently indexed documents')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('-l, --limit <number>', 'Number of items to show', '10')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);
      const indexPath = config.indexPath;

      const initialized = await checkInitialized(indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      // Read metadata
      const metadataPath = path.join(indexPath, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));

      // Sort by indexedAt descending
      const docs = Object.entries(metadata.documents || {})
        .map(([id, doc]: [string, any]) => ({
          id,
          indexedAt: doc.indexedAt || '',
          contentType: doc.contentType || 'unknown',
        }))
        .filter(d => d.indexedAt)
        .sort((a, b) => b.indexedAt.localeCompare(a.indexedAt))
        .slice(0, parseInt(options.limit));

      if (docs.length === 0) {
        console.log('No recently indexed documents found.');
        return;
      }

      console.log('Recently indexed:\n');
      for (const doc of docs) {
        const age = Date.now() - new Date(doc.indexedAt).getTime();
        const ageStr = age < 60000 ? 'just now'
          : age < 3600000 ? `${Math.round(age / 60000)}m ago`
          : age < 86400000 ? `${Math.round(age / 3600000)}h ago`
          : `${Math.round(age / 86400000)}d ago`;
        console.log(`  [${doc.contentType}] ${doc.id} — ${ageStr}`);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Check system health: embedding provider, index, extraction')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);
      const checks: { name: string; status: string; detail?: string }[] = [];

      // Check index exists
      const initialized = await checkInitialized(config.indexPath);
      checks.push({
        name: 'Index',
        status: initialized ? '✓' : '✗',
        detail: initialized ? config.indexPath : 'Not initialized',
      });

      if (initialized) {
        // Check embedding provider
        const manager = new MemoryManager(config);
        try {
          await manager.search({ query: 'test', limit: 1, threshold: 0.1 });
          checks.push({ name: 'Embeddings', status: '✓', detail: config.provider });
        } catch (e: any) {
          checks.push({ name: 'Embeddings', status: '✗', detail: e.message });
        }

        // Check document count
        const stats = await manager.getStats();
        checks.push({
          name: 'Documents',
          status: stats.totalIndexedDocuments > 0 ? '✓' : '⚠',
          detail: `${stats.totalIndexedDocuments} indexed`,
        });
      }

      // Check extraction availability
      const { isExtractionAvailable } = await import('./parser/conversation-extractor.js');
      const extractionOk = await isExtractionAvailable();
      checks.push({
        name: 'Extraction',
        status: extractionOk ? '✓' : '⚠',
        detail: extractionOk ? 'Python + httpx available' : 'Not available (optional)',
      });

      // Output
      console.log('Gordo Ledger Health Check:\n');
      for (const check of checks) {
        console.log(`  ${check.status} ${check.name}: ${check.detail || ''}`);
      }

      const hasErrors = checks.some(c => c.status === '✗');
      process.exit(hasErrors ? 1 : 0);
    } catch (error) {
      console.error('Health check failed:', error);
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
        throw new Error('gordo-ledger not initialized\n\nRun: gordo-ledger init');
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

program
  .command('digest')
  .description('Show daily digest of recent activity for catching up')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('-d, --days <number>', 'Number of days to show', '7')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      const manager = new MemoryManager(config);
      const sessions = await manager.getAllSessions();

      const days = parseInt(options.days);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().split('T')[0];

      // Filter and group by date
      const byDate: Record<string, typeof sessions> = {};
      for (const s of sessions) {
        if (s.date >= cutoffStr) {
          const date = s.date.split('T')[0];
          if (!byDate[date]) byDate[date] = [];
          byDate[date].push(s);
        }
      }

      const dates = Object.keys(byDate).sort().reverse();
      if (dates.length === 0) {
        console.log(`No activity in the last ${days} days.`);
        return;
      }

      console.log(`Activity digest (last ${days} days):\n`);
      for (const date of dates) {
        const items = byDate[date];
        const byType: Record<string, number> = {};
        for (const item of items) {
          const t = item.contentType || 'unknown';
          byType[t] = (byType[t] || 0) + 1;
        }
        const typeSummary = Object.entries(byType).map(([t, c]) => `${t}:${c}`).join(' ');
        console.log(`\n${date} (${items.length} items: ${typeSummary})`);

        // Show up to 5 items per day with brief preview
        for (const item of items.slice(0, 5)) {
          const type = (item.contentType || '?')[0];
          const preview = item.content.replace(/\s+/g, ' ').substring(0, 50);
          console.log(`  [${type}] ${item.id}: ${preview}...`);
        }
        if (items.length > 5) {
          console.log(`  ... and ${items.length - 5} more`);
        }
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program
  .command('handoffs')
  .description('Find handoff items and open threads from recent sessions')
  .option('-p, --path <path>', 'Repository path', process.cwd())
  .option('-n, --sessions <number>', 'Number of recent sessions to check', '10')
  .action(async (options) => {
    try {
      const config = await loadConfig(options.path);

      const initialized = await checkInitialized(config.indexPath);
      if (!initialized) {
        console.error('Error: gordo-ledger not initialized');
        process.exit(1);
      }

      const manager = new MemoryManager(config);

      const sessionCount = parseInt(options.sessions);
      const results = await manager.search({
        query: 'handoff next session todo open thread blocked pending follow-up',
        limit: sessionCount * 3,
        threshold: 0.25,
        contentTypes: ['session', 'conversation'],
      });

      const handoffKeywords = ['handoff', 'next session', 'todo', 'blocked', 'pending', 'follow-up', 'open thread', 'continues', 'wip'];
      const filtered = results.filter(r => {
        const lower = r.content.toLowerCase();
        return handoffKeywords.some(k => lower.includes(k));
      }).slice(0, sessionCount);

      if (filtered.length === 0) {
        console.log('No explicit handoff items found in recent sessions.');
        return;
      }

      console.log('Handoff items from recent sessions:\n');
      for (const r of filtered) {
        const preview = r.content.replace(/\s+/g, ' ').substring(0, 80);
        console.log(`  ${r.date} ${r.sessionId}: ${preview}...`);
      }
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

program.parse();
