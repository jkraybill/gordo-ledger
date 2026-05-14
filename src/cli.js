#!/usr/bin/env node

/**
 * ledger -- Ledger CLI
 *
 * Unified interface for Ledger operations.
 *
 * Usage:
 *   ledger search <query>      - Tiered search across all memory
 *   ledger federated <query>   - Cross-realm umbrella search
 *   ledger realms              - Show federation status
 *   ledger salience            - Show salience stats
 *   ledger contradictions      - Scan for potential contradictions
 *   ledger decisions           - List and verify DECISIONS
 *   ledger audit               - Verify audit log integrity
 *   ledger limits              - Show rate limiter status
 *   ledger consolidate         - Run session consolidation
 *
 * @author Gordo (AI participant)
 * @version 0.3.0
 * @session S236
 */

const path = require('path');

// Import controllers
const MemoryController = require('./controller/memory-controller');
const SalienceCache = require('./controller/salience-cache');
const ContradictionDetector = require('./controller/contradiction-detector');
const DecisionsManager = require('./controller/decisions-manager');
const RateLimiter = require('./controller/rate-limiter');
const ArchivalStore = require('./controller/archival-store');
const WorkingCache = require('./controller/working-cache');
const GraphStore = require('./controller/graph-store');
const TemporalStore = require('./controller/temporal-store');
const ProceduralStore = require('./controller/procedural-store');
const SessionConsolidator = require('./controller/consolidation');

const MEMORY_DIR = path.join(
  process.env.HOME,
  '.claude/projects/-home-jk-project-gordo-backchannel/memory'
);

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'search': {
      if (!args[1]) {
        console.log('Usage: ledger search <query>');
        process.exit(1);
      }
      const store = new ArchivalStore();
      const results = await store.tieredSearch(args.slice(1).join(' '));
      console.log('\nLedger Search Results\n');
      console.log(`Query: "${results.query}"\n`);

      for (const r of results.results) {
        const tierBadge = r.tier === 'DECISIONS' ? '[D]' :
                          r.tier === 'CORE' ? '[C]' :
                          r.tier === 'WORKING' ? '[W]' : '[A]';
        console.log(`${tierBadge} ${r.content}`);
        if (r.file) console.log(`    ${r.file}`);
        if (r.type) console.log(`    type: ${r.type}`);
      }
      console.log(`\nFound: ${results.results.length} results`);
      break;
    }

    case 'federated': {
      if (!args[1]) {
        console.log('Usage: ledger federated <query> [--private]');
        process.exit(1);
      }
      const store = new ArchivalStore();
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      const includePrivate = args.includes('--private');
      const results = await store.federatedSearch(query, { includePrivate });

      console.log('\nFederated Memory Search\n');
      console.log(`Query: "${results.query}"`);
      console.log(`Realms: ${results.realms.join(', ')}\n`);

      if (results.results.length === 0) {
        console.log('No results found.');
      } else {
        for (const r of results.results) {
          const badge = `[${r.realm}:${r.realmTier}]`.padEnd(20);
          console.log(`${badge} (${r.score.toFixed(2)}) ${r.content.substring(0, 60)}`);
        }
      }

      console.log(`\nTotal: ${results.results.length} results across ${results.realms.length} realms`);
      if (results.errors.length > 0) {
        console.log(`Errors: ${results.errors.length}`);
      }
      break;
    }

    case 'realms': {
      const store = new ArchivalStore();
      const status = store.federationStatus();

      console.log('\nFederation Realms\n');
      console.log('Realm              Tier  Status');
      console.log('─'.repeat(45));

      for (const [name, info] of Object.entries(status)) {
        const indicator = info.available ? '✓' : '✗';
        const tierBadge = info.tier.padEnd(5);
        console.log(`${indicator} ${name.padEnd(18)} ${tierBadge} ${info.description}`);
      }

      const available = Object.values(status).filter(s => s.available).length;
      console.log(`\nAvailable for search: ${available}/${Object.keys(status).length}`);
      break;
    }

    case 'working': {
      const cache = new WorkingCache();
      const subCmd = args[1];

      switch (subCmd) {
        case 'add': {
          if (!args[2]) {
            console.log('Usage: ledger working add <content> [--type=X]');
            break;
          }
          const type = args.find(a => a.startsWith('--type='))?.split('=')[1] || 'scratch';
          const content = args.slice(2).filter(a => !a.startsWith('--')).join(' ');
          const id = cache.add(content, { type });
          console.log(`Added to WORKING: ${id}`);
          break;
        }

        case 'list': {
          const items = cache.list();
          console.log('\nWORKING Cache\n');
          if (items.length === 0) {
            console.log('(empty)');
          } else {
            for (const item of items) {
              console.log(`[${item.type}] ${item.id}`);
              console.log(`  ${item.content.substring(0, 70)}`);
            }
          }
          break;
        }

        case 'promote': {
          const workingId = args[2];
          if (workingId) {
            // Promote specific item
            const controller = new MemoryController();
            const candidate = cache.cache.items[workingId];
            if (!candidate) {
              console.log(`Not found: ${workingId}`);
              break;
            }
            const result = controller.promote(workingId, {
              salience_score: candidate.promotion_score || 0.75,
            });
            console.log(`\nPromoted: ${workingId}`);
            console.log(`  → ${result.filename}`);
            console.log(`  CORE ID: ${result.new_id}`);
          } else {
            // List candidates
            const candidates = cache.promotionCandidates();
            console.log('\nPromotion Candidates\n');
            if (candidates.length === 0) {
              console.log('No items meet promotion threshold (0.70)');
            } else {
              console.log('Use: ledger working promote <ID> to promote\n');
              for (const c of candidates) {
                console.log(`[${c.type}] ${c.promotion_score.toFixed(2)} ${c.id}`);
                console.log(`  ${c.content.substring(0, 60)}...`);
              }
            }
          }
          break;
        }

        default: {
          const stats = cache.stats();
          console.log('\nWORKING Tier Stats\n');
          console.log(`Session: ${stats.session}`);
          console.log(`Total items: ${stats.total}`);
          console.log(`Promotable: ${stats.promotable}`);
          if (Object.keys(stats.by_type).length > 0) {
            console.log('\nBy type:');
            for (const [type, count] of Object.entries(stats.by_type)) {
              console.log(`  ${type}: ${count}`);
            }
          }
        }
      }
      break;
    }

    case 'graph': {
      const graph = new GraphStore();
      const subCmd = args[1];

      switch (subCmd) {
        case 'process': {
          if (!args[2]) {
            console.log('Usage: ledger graph process <text>');
            break;
          }
          const text = args.slice(2).join(' ');
          const result = graph.processText(text, { source: 'cli', session: 'cli' });
          console.log('\nExtracted:');
          console.log(`  Entities: ${result.entities.length}`);
          console.log(`  Relationships: ${result.relationships.length}`);
          if (result.entities.length > 0) {
            console.log('\nEntities:');
            result.entities.forEach(e => console.log(`  [${e.type}] ${e.value}`));
          }
          break;
        }

        case 'related': {
          if (!args[2]) {
            console.log('Usage: ledger graph related <entity> [depth]');
            break;
          }
          const related = graph.findRelated(args[2], { depth: parseInt(args[3]) || 1 });
          console.log(`\nRelated to "${args[2]}":\n`);
          if (related.length === 0) {
            console.log('No related entities found.');
          } else {
            related.forEach(r => {
              console.log(`[${r.type}] ${r.value}`);
              console.log(`  via: ${r.edge_type} (${(r.confidence * 100).toFixed(0)}%)`);
            });
          }
          break;
        }

        case 'path': {
          if (!args[2] || !args[3]) {
            console.log('Usage: ledger graph path <from> <to>');
            break;
          }
          const path = graph.findPath(args[2], args[3]);
          console.log('\nPath:', path ? path.join(' → ') : 'No path found');
          break;
        }

        default: {
          const stats = graph.stats();
          console.log('\nGraph Stats\n');
          console.log(`Entities: ${stats.entities}`);
          console.log(`Edges: ${stats.edges}`);
          if (Object.keys(stats.entities_by_type).length > 0) {
            console.log('\nBy type:');
            for (const [type, count] of Object.entries(stats.entities_by_type)) {
              console.log(`  ${type}: ${count}`);
            }
          }
        }
      }
      break;
    }

    case 'temporal': {
      const temporal = new TemporalStore();
      const subCmd = args[1];

      switch (subCmd) {
        case 'as-of': {
          if (!args[2]) {
            console.log('Usage: ledger temporal as-of <YYYY-MM-DD>');
            break;
          }
          const results = temporal.asOf(args[2]);
          console.log(`\nFacts valid as of ${args[2]}:\n`);
          results.forEach(r => {
            console.log(`[${r.type || '?'}] ${r.name}`);
          });
          console.log(`\nTotal: ${results.length}`);
          break;
        }

        case 'known-at': {
          if (!args[2]) {
            console.log('Usage: ledger temporal known-at <YYYY-MM-DD>');
            break;
          }
          const results = temporal.knownAt(args[2]);
          console.log(`\nFacts known at ${args[2]}:\n`);
          results.forEach(r => {
            console.log(`[${r.type || '?'}] ${r.name} (${r.created_at?.split('T')[0]})`);
          });
          console.log(`\nTotal: ${results.length}`);
          break;
        }

        case 'between': {
          if (!args[2] || !args[3]) {
            console.log('Usage: ledger temporal between <start> <end>');
            break;
          }
          const results = temporal.between(args[2], args[3]);
          console.log(`\nFacts valid ${args[2]} to ${args[3]}:\n`);
          results.forEach(r => {
            const validity = r.valid_to ? `→ ${r.valid_to}` : '→ present';
            console.log(`[${r.type || '?'}] ${r.name} (${r.valid_from} ${validity})`);
          });
          console.log(`\nTotal: ${results.length}`);
          break;
        }

        case 'history': {
          if (!args[2]) {
            console.log('Usage: ledger temporal history <pattern>');
            break;
          }
          const results = temporal.history(args.slice(2).join(' '));
          console.log(`\nHistory of "${args.slice(2).join(' ')}":\n`);
          results.forEach(r => {
            const status = r.current ? '●' : '○';
            console.log(`${status} ${r.created_at?.split('T')[0] || '?'} ${r.name}`);
          });
          break;
        }

        case 'timeline': {
          const granularity = args[2] || 'day';
          const timeline = temporal.timeline({ granularity });
          console.log(`\nMemory Timeline (${granularity}):\n`);
          timeline.slice(-15).forEach(t => {
            const bar = '█'.repeat(Math.min(20, t.count));
            console.log(`${t.date} ${bar} ${t.count}`);
          });
          break;
        }

        default:
          console.log(`
Temporal Queries

Commands:
  as-of <date>              Facts valid at that date
  known-at <date>           Facts known to system at that date
  between <start> <end>     Facts valid in range
  history <pattern>         Timeline of a concept
  timeline [day|month]      Memory creation over time
`);
      }
      break;
    }

    case 'procedural': {
      const procedural = new ProceduralStore();
      const subCmd = args[1];

      switch (subCmd) {
        case 'reindex': {
          const result = procedural.reindex();
          console.log(`\nReindexed procedural memory:`);
          console.log(`  Skills: ${result.skills}`);
          console.log(`  Patterns: ${result.patterns}`);
          break;
        }

        case 'list': {
          const type = args[2];
          const items = procedural.list({ type });
          console.log(`\nProcedural Memory${type ? ` (${type})` : ''}:\n`);
          for (const item of items) {
            console.log(`[${item.type}] ${item.name}`);
          }
          console.log(`\nTotal: ${items.length}`);
          break;
        }

        case 'search': {
          if (!args[2]) {
            console.log('Usage: ledger procedural search <query>');
            break;
          }
          const results = procedural.search(args.slice(2).join(' '));
          console.log(`\nSearch results:\n`);
          results.forEach(r => console.log(`[${r.type}] ${r.name}`));
          break;
        }

        case 'add-heuristic': {
          if (!args[2] || !args[3]) {
            console.log('Usage: ledger procedural add-heuristic <name> <rule>');
            break;
          }
          const h = procedural.addHeuristic(args[2], args.slice(3).join(' '));
          console.log(`Added heuristic: ${h.id}`);
          break;
        }

        default: {
          const stats = procedural.stats();
          console.log('\nProcedural Memory Stats\n');
          console.log(`Total: ${stats.total}`);
          if (Object.keys(stats.by_type).length > 0) {
            console.log('\nBy type:');
            for (const [type, count] of Object.entries(stats.by_type)) {
              console.log(`  ${type}: ${count}`);
            }
          }
          console.log(`\nCommands: reindex, list [type], search <q>, add-heuristic <n> <rule>`);
        }
      }
      break;
    }

    case 'salience': {
      const cache = new SalienceCache();
      const results = cache.recomputeAll(MEMORY_DIR);
      const stats = cache.stats();

      console.log('\nSalience Analysis\n');
      console.log(`Total memories: ${stats.total}`);
      console.log(`Average salience: ${stats.avg_salience}`);
      console.log(`Above threshold (>0.75): ${stats.above_threshold}`);
      console.log(`Below threshold (<0.35): ${stats.below_threshold}`);
      console.log('\nTop 5 by salience:');
      results.slice(0, 5).forEach(r => {
        console.log(`  ${r.score.toFixed(3)} ${r.file}`);
      });
      break;
    }

    case 'contradictions': {
      const detector = new ContradictionDetector();
      const conflicts = detector.fullScan();

      console.log('\nContradiction Scan\n');
      if (conflicts.length === 0) {
        console.log('No potential contradictions detected.');
      } else {
        console.log(`Found ${conflicts.length} potential conflicts:\n`);
        conflicts.forEach((c, i) => {
          console.log(`${i + 1}. ${c.file1}`);
          console.log(`   ↔ ${c.file2}`);
          console.log(`   Overlap: ${(c.overlap_score * 100).toFixed(1)}%`);
        });
      }
      break;
    }

    case 'decisions': {
      const manager = new DecisionsManager();
      const list = manager.list();
      const verify = manager.verify();

      console.log('\nDECISIONS Tier\n');
      console.log(`Active: ${list.active.length}`);
      console.log(`Superseded: ${list.superseded}\n`);

      list.active.forEach(d => {
        const integrity = verify.find(v => v.id === d.id);
        const status = integrity?.hash_valid === null ? '⏳' :
                       integrity?.hash_valid ? '✓' : '✗';
        console.log(`${status} ${d.id}: ${d.title}`);
        console.log(`  MCAP: ${d.mcap}`);
      });
      break;
    }

    case 'audit': {
      const controller = new MemoryController();
      const result = controller.verifyAudit();

      console.log('\nAudit Log Verification\n');
      console.log(`Entries: ${result.entries}`);
      console.log(`Valid: ${result.valid ? 'YES' : 'NO'}`);

      if (result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach(e => console.log(`  - ${e}`));
      }
      break;
    }

    case 'limits': {
      const limiter = new RateLimiter();
      const stats = limiter.stats();

      console.log('\nRate Limiter Status\n');
      console.log(`Session: ${stats.session}`);
      console.log(`Started: ${stats.started_at}\n`);

      console.log('Operation    Used  Limit  Remaining');
      console.log('─'.repeat(40));
      for (const [op, limit] of Object.entries(stats.limits)) {
        const used = stats.counts[op] || 0;
        const remaining = stats.remaining[op];
        const bar = '█'.repeat(Math.min(10, used)) + '░'.repeat(Math.max(0, 10 - used));
        console.log(`${op.padEnd(16)} ${String(used).padStart(3)}  ${String(limit).padStart(4)}  ${bar}`);
      }
      break;
    }

    case 'consolidate': {
      const sessionNum = args[1] || 'current';
      const consolidator = new SessionConsolidator();

      console.log(`\nSession Consolidation (S${consolidator.session})\n`);

      // Get session from log
      const fs = require('fs');
      const logPath = path.join(__dirname, '../SESSION_LOG.md');
      const logContent = fs.readFileSync(logPath, 'utf8');

      const sessionMatch = logContent.match(
        new RegExp(`## Session ${consolidator.session}[\\s\\S]*?(?=## Session|$)`)
      );

      if (sessionMatch) {
        const report = await consolidator.consolidate(sessionMatch[0]);
        console.log(consolidator.formatReport(report));
      } else {
        console.log('No session content to consolidate.');
      }
      break;
    }

    case 'help':
    default:
      console.log(`
Ledger CLI

Commands:
  search <query>            Tiered search: DECISIONS > CORE > WORKING > ARCHIVAL
  federated <query>         Cross-realm umbrella search
  realms                    Show federation status
  working                   WORKING tier stats
  working add <content>     Add to WORKING (--type=user|feedback|project|reference|scratch)
  working list              List WORKING items
  working promote [ID]      Show candidates or promote specific item
  graph                     Graph statistics
  graph process <text>      Extract entities and relationships
  graph related <entity>    Find related entities
  graph path <from> <to>    Find connection path
  temporal                  Temporal query help
  temporal as-of <date>     Facts valid at a point in time
  temporal between <s> <e>  Facts valid in range
  temporal history <name>   Timeline of a concept
  temporal timeline         Memory creation over time
  procedural                Procedural memory stats
  procedural reindex        Index skills and patterns
  procedural list [type]    List procedures by type
  procedural search <q>     Search procedures
  salience                  Compute and display salience scores
  contradictions            Scan for potential memory contradictions
  decisions                 List and verify DECISIONS tier
  audit                     Verify audit log hash chain
  limits                    Show rate limiter status
  consolidate               Run session-end consolidation analysis

Federation:
  ledger federated "Tool Sovereignty"      Search all public realms
  ledger federated "decision" --private    Include backchannel
  ledger realms                            List available realms

Examples:
  ledger search "Tool Sovereignty"
  ledger salience
  ledger decisions

Ledger v0.3.0 -- S236 2026-05-14
`);
  }
}

main().catch(console.error);
