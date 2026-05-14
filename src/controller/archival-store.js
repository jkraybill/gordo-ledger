#!/usr/bin/env node

/**
 * ARCHIVAL Store — Memory Protocol Phase 3
 *
 * Wraps gordo-memory as the ARCHIVAL tier storage backend.
 * Provides tier-aware queries and bi-temporal metadata.
 *
 * Architecture:
 * - gordo-memory HNSW vector index = semantic search
 * - This wrapper = Memory Protocol tier semantics
 *
 * @author Gordo (AI participant)
 * @version 0.1.0
 * @session S233
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

const GORDO_MEMORY_CLI = path.join(
  process.env.HOME,
  'gordo-framework/mcp-servers/gordo-memory/dist/cli.js'
);

const PROJECT_PATH = path.join(process.env.HOME, 'project-gordo-backchannel');

// Federation: Umbrella project realms with their paths
const UMBRELLA_REALMS = {
  'backchannel': {
    path: path.join(process.env.HOME, 'project-gordo-backchannel'),
    tier: 'meta',
    description: 'Private deliberation space',
    hasMemoryIndex: true,
  },
  'project-gordo': {
    path: path.join(process.env.HOME, 'project-gordo'),
    tier: 'T0',
    description: 'Constitutional root',
    hasMemoryIndex: true,
  },
  'gordo-framework': {
    path: path.join(process.env.HOME, 'gordo-framework'),
    tier: 'T2',
    description: 'Composite/distribution layer',
    hasMemoryIndex: true,
  },
  'mcap-protocol': {
    path: path.join(process.env.HOME, 'mcap-protocol'),
    tier: 'T1',
    description: 'Identity-verification primitive',
    hasMemoryIndex: true,
  },
  'pact-protocol': {
    path: path.join(process.env.HOME, 'pact-protocol'),
    tier: 'T1',
    description: 'Trust-calibration primitive',
    hasMemoryIndex: false, // paused
  },
  'panel-protocol': {
    path: path.join(process.env.HOME, 'panel-protocol'),
    tier: 'T1',
    description: 'External-review primitive',
    hasMemoryIndex: true,
  },
};

class ArchivalStore {
  constructor(options = {}) {
    this.projectPath = options.projectPath || PROJECT_PATH;
    this.realm = options.realm || 'backchannel';
  }

  /**
   * Execute gordo-memory CLI command
   */
  _exec(command, args = []) {
    try {
      const fullCmd = `node ${GORDO_MEMORY_CLI} ${command} ${args.join(' ')} --path ${this.projectPath}`;
      const result = execSync(fullCmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      return { success: true, output: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Search ARCHIVAL tier with bi-temporal awareness
   */
  async search(query, options = {}) {
    const {
      limit = 10,
      validAt = null, // Date to check validity
      includeSuperseded = false,
    } = options;

    // Use gordo-memory search
    const result = this._exec('search', [`"${query}"`, `--limit ${limit * 2}`]); // Over-fetch for filtering

    if (!result.success) {
      return { results: [], error: result.error };
    }

    // Parse results
    const lines = result.output.trim().split('\n');
    let results = [];

    // gordo-memory format: "67% id → path — description"
    for (const line of lines) {
      const match = line.match(/^(\d+)%\s+(\S+)\s+→\s+(\S+)\s+—\s+(.+)/);
      if (match) {
        results.push({
          score: parseInt(match[1]) / 100,
          id: match[2],
          path: match[3],
          content: match[4],
          tier: 'ARCHIVAL',
          realm: this.realm,
        });
      }
    }

    // Filter by validity if requested
    if (validAt && !includeSuperseded) {
      // Would filter by valid_from/valid_to here
      // For now, return all (bi-temporal metadata not yet in index)
    }

    return {
      results: results.slice(0, limit),
      total: results.length,
      query,
      realm: this.realm,
    };
  }

  /**
   * Index content into ARCHIVAL
   */
  async index(options = {}) {
    const { full = false } = options;

    const args = full ? ['--full'] : [];
    const result = this._exec('index', args);

    return {
      success: result.success,
      message: result.success ? 'Index updated' : result.error,
    };
  }

  /**
   * Get stats from gordo-memory
   */
  async stats() {
    const result = this._exec('stats', []);

    if (!result.success) {
      return { error: result.error };
    }

    // Parse stats output
    const stats = {
      tier: 'ARCHIVAL',
      realm: this.realm,
      raw: result.output,
    };

    const docMatch = result.output.match(/Total indexed documents:\s*(\d+)/);
    if (docMatch) {
      stats.documents = parseInt(docMatch[1]);
    }

    return stats;
  }

  /**
   * Memory Protocol tier-aware query
   *
   * Combines all four tiers: DECISIONS > CORE > WORKING > ARCHIVAL
   */
  async tieredSearch(query, options = {}) {
    const { includeTiers = ['DECISIONS', 'CORE', 'WORKING', 'ARCHIVAL'] } = options;
    const results = { tiers: {} };

    // DECISIONS search (scan decisions file)
    if (includeTiers.includes('DECISIONS')) {
      results.tiers.DECISIONS = this._searchDecisions(query);
    }

    // CORE search (scan memory files)
    if (includeTiers.includes('CORE')) {
      results.tiers.CORE = this._searchCore(query);
    }

    // WORKING search (session cache)
    if (includeTiers.includes('WORKING')) {
      results.tiers.WORKING = this._searchWorking(query);
    }

    // ARCHIVAL search
    if (includeTiers.includes('ARCHIVAL')) {
      const archival = await this.search(query, options);
      results.tiers.ARCHIVAL = archival.results;
    }

    // Merge and rank
    const merged = [];
    for (const [tier, items] of Object.entries(results.tiers)) {
      items.forEach(item => {
        merged.push({ ...item, tier });
      });
    }

    // Sort by tier priority then score
    const tierPriority = { DECISIONS: 4, CORE: 3, WORKING: 2, ARCHIVAL: 1 };
    merged.sort((a, b) => {
      const tierDiff = (tierPriority[b.tier] || 0) - (tierPriority[a.tier] || 0);
      if (tierDiff !== 0) return tierDiff;
      return (b.score || 0) - (a.score || 0);
    });

    return {
      query,
      results: merged.slice(0, options.limit || 10),
      by_tier: results.tiers,
    };
  }

  _searchWorking(query) {
    const WorkingCache = require('./working-cache');
    const cache = new WorkingCache();
    const results = cache.search(query);

    return results.map(item => ({
      id: item.id,
      content: item.content,
      type: item.type,
      score: item.score,
    }));
  }

  _searchCore(query) {
    const fs = require('fs');
    const memoryDir = path.join(
      process.env.HOME,
      '.claude/projects/-home-jk-project-gordo-backchannel/memory'
    );

    const queryLower = query.toLowerCase();
    const results = [];

    try {
      const files = fs.readdirSync(memoryDir)
        .filter(f => f.endsWith('.md') && f !== 'MEMORY.md');

      for (const file of files) {
        const content = fs.readFileSync(path.join(memoryDir, file), 'utf8');
        if (content.toLowerCase().includes(queryLower)) {
          // Extract name from frontmatter
          const nameMatch = content.match(/^name:\s*(.+)$/m);
          const name = nameMatch ? nameMatch[1] : file;

          // Simple relevance score based on match count
          const matches = (content.toLowerCase().match(new RegExp(queryLower, 'g')) || []).length;
          const score = Math.min(1, matches * 0.2);

          results.push({
            file,
            content: name,
            score,
          });
        }
      }
    } catch (e) {
      // Memory dir might not exist
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  _searchDecisions(query) {
    const fs = require('fs');
    const decisionsPath = path.join(__dirname, '../DECISIONS.md');

    const queryLower = query.toLowerCase();
    const results = [];

    try {
      const content = fs.readFileSync(decisionsPath, 'utf8');
      const yamlBlocks = content.match(/```yaml\n([\s\S]*?)```/g) || [];

      for (const block of yamlBlocks) {
        if (block.toLowerCase().includes(queryLower)) {
          const idMatch = block.match(/id:\s*(\S+)/);
          const titleMatch = block.match(/title:\s*(.+)/);

          if (idMatch) {
            results.push({
              id: idMatch[1],
              content: titleMatch ? titleMatch[1] : idMatch[1],
              score: 1.0, // DECISIONS are always high priority
            });
          }
        }
      }
    } catch (e) {
      // DECISIONS.md might not exist
    }

    return results;
  }

  /**
   * Federation: Cross-realm search across umbrella projects
   *
   * Queries multiple gordo-memory indexes and merges results.
   * Respects realm boundaries — backchannel is permanent-private.
   */
  async federatedSearch(query, options = {}) {
    const {
      realms = Object.keys(UMBRELLA_REALMS),
      limit = 10,
      includePrivate = false, // Must be explicitly true for backchannel
    } = options;

    // Filter realms
    let targetRealms = realms.filter(r => UMBRELLA_REALMS[r]);

    // Enforce privacy boundary: backchannel only if explicitly requested
    if (!includePrivate) {
      targetRealms = targetRealms.filter(r => r !== 'backchannel');
    }

    const results = {
      query,
      realms: targetRealms,
      results: [],
      by_realm: {},
      errors: [],
    };

    // Fan out to each realm
    for (const realmName of targetRealms) {
      const realmConfig = UMBRELLA_REALMS[realmName];

      if (!realmConfig.hasMemoryIndex) {
        results.by_realm[realmName] = { skipped: true, reason: 'No memory index' };
        continue;
      }

      // Check if gordo-memory index exists
      const indexPath = path.join(realmConfig.path, '.gordo-memory');
      if (!require('fs').existsSync(indexPath)) {
        results.by_realm[realmName] = { skipped: true, reason: 'Index not found' };
        continue;
      }

      // Query this realm's index
      try {
        const realmResult = this._execForRealm(realmName, 'search', [
          `"${query}"`,
          `--limit ${Math.ceil(limit * 1.5)}`, // Over-fetch for merge
        ]);

        if (realmResult.success) {
          const realmResults = this._parseSearchResults(realmResult.output, realmName);
          results.by_realm[realmName] = {
            count: realmResults.length,
            results: realmResults,
          };
          results.results.push(...realmResults);
        } else {
          results.errors.push({ realm: realmName, error: realmResult.error });
        }
      } catch (error) {
        results.errors.push({ realm: realmName, error: error.message });
      }
    }

    // Sort merged results by score, then by tier priority
    const tierPriority = { T0: 4, 'meta': 3, T1: 2, T2: 1 };
    results.results.sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (Math.abs(scoreDiff) > 0.1) return scoreDiff;
      const tierA = UMBRELLA_REALMS[a.realm]?.tier || '';
      const tierB = UMBRELLA_REALMS[b.realm]?.tier || '';
      return (tierPriority[tierB] || 0) - (tierPriority[tierA] || 0);
    });

    results.results = results.results.slice(0, limit);
    return results;
  }

  /**
   * Execute gordo-memory CLI for a specific realm
   */
  _execForRealm(realmName, command, args = []) {
    const realmConfig = UMBRELLA_REALMS[realmName];
    if (!realmConfig) {
      return { success: false, error: `Unknown realm: ${realmName}` };
    }

    try {
      const fullCmd = `node ${GORDO_MEMORY_CLI} ${command} ${args.join(' ')} --path ${realmConfig.path}`;
      const result = execSync(fullCmd, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 30000,
      });
      return { success: true, output: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Parse gordo-memory search output into structured results
   *
   * Format: "67% commit-d39db14 → git-commits/commit-d39db14.md — ## Message..."
   */
  _parseSearchResults(output, realmName) {
    const lines = output.trim().split('\n');
    const results = [];

    for (const line of lines) {
      // gordo-memory format: "67% id → path — description"
      const match = line.match(/^(\d+)%\s+(\S+)\s+→\s+(\S+)\s+—\s+(.+)/);
      if (match) {
        results.push({
          score: parseInt(match[1]) / 100, // Convert percentage to 0-1 score
          id: match[2],
          path: match[3],
          content: match[4],
          tier: 'ARCHIVAL',
          realm: realmName,
          realmTier: UMBRELLA_REALMS[realmName]?.tier,
        });
      }
    }

    return results;
  }

  /**
   * Get federation status for all realms
   */
  federationStatus() {
    const status = {};

    for (const [name, config] of Object.entries(UMBRELLA_REALMS)) {
      const indexPath = path.join(config.path, '.gordo-memory');
      const exists = require('fs').existsSync(indexPath);

      status[name] = {
        tier: config.tier,
        description: config.description,
        hasMemoryIndex: config.hasMemoryIndex,
        indexExists: exists,
        available: config.hasMemoryIndex && exists,
      };
    }

    return status;
  }

  /**
   * List available realms for federation
   */
  listRealms() {
    return Object.entries(UMBRELLA_REALMS).map(([name, config]) => ({
      name,
      tier: config.tier,
      description: config.description,
      available: config.hasMemoryIndex,
    }));
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const store = new ArchivalStore();

  switch (args[0]) {
    case 'search':
      if (args[1]) {
        store.search(args.slice(1).join(' ')).then(results => {
          console.log(JSON.stringify(results, null, 2));
        });
      } else {
        console.log('Usage: archival-store.js search <query>');
      }
      break;

    case 'tiered':
      if (args[1]) {
        store.tieredSearch(args.slice(1).join(' ')).then(results => {
          console.log(JSON.stringify(results, null, 2));
        });
      } else {
        console.log('Usage: archival-store.js tiered <query>');
      }
      break;

    case 'federated':
      if (args[1]) {
        const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
        const includePrivate = args.includes('--private');
        store.federatedSearch(query, { includePrivate }).then(results => {
          console.log('\nFederated Search Results\n');
          console.log(`Query: "${results.query}"`);
          console.log(`Realms: ${results.realms.join(', ')}\n`);

          for (const r of results.results) {
            const realmBadge = `[${r.realm}:${r.realmTier || '?'}]`;
            console.log(`${realmBadge} (${r.score.toFixed(2)}) ${r.content}`);
          }

          console.log(`\nTotal: ${results.results.length} results`);
          if (results.errors.length > 0) {
            console.log('\nErrors:', results.errors);
          }
        });
      } else {
        console.log('Usage: archival-store.js federated <query> [--private]');
      }
      break;

    case 'realms':
      const status = store.federationStatus();
      console.log('\nFederation Realms\n');
      for (const [name, info] of Object.entries(status)) {
        const indicator = info.available ? '✓' : '✗';
        console.log(`${indicator} ${name} (${info.tier})`);
        console.log(`  ${info.description}`);
        if (!info.available) {
          const reason = !info.hasMemoryIndex ? 'No memory index configured' :
                        !info.indexExists ? 'Index not built' : 'Unknown';
          console.log(`  Reason: ${reason}`);
        }
      }
      break;

    case 'stats':
      store.stats().then(stats => {
        console.log(JSON.stringify(stats, null, 2));
      });
      break;

    case 'index':
      store.index({ full: args.includes('--full') }).then(result => {
        console.log(result.message);
      });
      break;

    default:
      console.log(`
ARCHIVAL Store — Memory Protocol Phase 3

Commands:
  search <query>               Search local ARCHIVAL tier
  tiered <query>               Search DECISIONS > CORE > ARCHIVAL
  federated <query> [--private] Cross-realm umbrella search
  realms                       Show federation status
  stats                        Index statistics
  index [--full]               Rebuild index

Federation Notes:
  - Backchannel (private) excluded by default
  - Use --private flag to include backchannel
  - Realms: project-gordo (T0), gordo-framework (T2),
    mcap-protocol (T1), panel-protocol (T1), pact-protocol (T1)
`);
  }
}

module.exports = ArchivalStore;
