/**
 * Gordo Ledger MCP Server
 * Provides semantic memory search for Gordo Ledger
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { MemoryManager } from './memory-manager-v2.js';
import { GraphManager, GraphConfig } from './graph-manager.js';
import type { MemoryConfig } from './types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const DEFAULT_CONFIG: MemoryConfig = {
  enabled: true,
  provider: 'openai',
  model: 'text-embedding-3-small',
  threshold: 0.5,
  indexPath: '.gordo-memory',
  autoIndex: true,
  openaiApiKey: process.env.OPENAI_API_KEY,
  indexDocs: true,  // Fix #142: Enable docs indexing by default
  indexCode: false, // Fix #142: Disable code indexing by default (noisy)
};

class GordoLedgerServer {
  private server: Server;
  private memoryManager: MemoryManager | null = null;
  private graphManager: GraphManager | null = null;
  private repoPath: string;

  constructor() {
    this.server = new Server(
      {
        name: 'gordo-ledger',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Get repo path from environment or current directory
    this.repoPath = process.env.GORDO_REPO_PATH || process.cwd();

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private async loadConfig(): Promise<MemoryConfig> {
    try {
      const configPath = path.join(this.repoPath, 'config.json');
      const configContent = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent);

      return {
        ...DEFAULT_CONFIG,
        ...config.memory?.semantic,
      };
    } catch {
      // Use defaults if config not found
      return DEFAULT_CONFIG;
    }
  }

  private async getMemoryManager(): Promise<MemoryManager> {
    if (!this.memoryManager) {
      const config = await this.loadConfig();
      this.memoryManager = new MemoryManager(config);
      await this.memoryManager.initialize();
    }
    return this.memoryManager;
  }

  private async getGraphManager(): Promise<GraphManager> {
    if (!this.graphManager) {
      const config = await this.loadConfig();
      const graphConfig: GraphConfig = {
        indexPath: config.indexPath,
        provider: config.provider as 'openai' | 'ollama',
        model: config.model,
        apiKey: config.openaiApiKey,
        ollamaUrl: config.ollamaUrl
      };
      this.graphManager = new GraphManager(graphConfig);
      await this.graphManager.initialize();
    }
    return this.graphManager;
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search',
            description: 'Semantic search across journal sessions using natural language queries',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Natural language search query (e.g., "OAuth authentication bugs")',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 5)',
                },
                threshold: {
                  type: 'number',
                  description: 'Similarity threshold 0-1 (default: 0.5)',
                },
                includeFullContent: {
                  type: 'boolean',
                  description: 'Return full content instead of truncated preview (default: false). Use get_session() for full content instead.',
                },
                maxContentLength: {
                  type: 'number',
                  description: 'Maximum characters per result content (default: 500)',
                },
                contentTypes: {
                  type: 'array',
                  items: { type: 'string', enum: ['session', 'issue', 'commit', 'code', 'docs', 'conversation'] },
                  description: 'Filter by content type (e.g., ["session", "conversation"])',
                },
                since: {
                  type: 'string',
                  description: 'Only include results from this date onwards (YYYY-MM-DD format)',
                },
                until: {
                  type: 'string',
                  description: 'Only include results up to this date (YYYY-MM-DD format)',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'index',
            description: 'Index or reindex journal sessions for semantic search',
            inputSchema: {
              type: 'object',
              properties: {
                incremental: {
                  type: 'boolean',
                  description: 'Only index new sessions (default: true)',
                },
                reindex: {
                  type: 'boolean',
                  description: 'Force full reindex (default: false)',
                },
              },
            },
          },
          {
            name: 'get_session',
            description: 'Retrieve a specific session by ID',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID (e.g., "Session_01")',
                },
              },
              required: ['sessionId'],
            },
          },
          {
            name: 'stats',
            description: 'Get memory index statistics',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'summarize',
            description: 'Get a quick summary of the knowledge base (document counts, date range, content types)',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
          {
            name: 'topics',
            description: 'Get common topics/patterns across the knowledge base',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Number of topics to return (default: 15)',
                },
              },
            },
          },
          {
            name: 'references',
            description: 'Get most referenced issues and sessions',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Number of items to return (default: 10)',
                },
              },
            },
          },
          {
            name: 'context',
            description: 'Find background/context documents for a topic. Returns older, foundational content.',
            inputSchema: {
              type: 'object',
              properties: {
                topic: {
                  type: 'string',
                  description: 'Topic to find context for (e.g., "oauth", "deployment")',
                },
                limit: {
                  type: 'number',
                  description: 'Number of results (default: 5)',
                },
              },
              required: ['topic'],
            },
          },
          {
            name: 'history',
            description: 'Show how a topic evolved over time (chronological order)',
            inputSchema: {
              type: 'object',
              properties: {
                topic: {
                  type: 'string',
                  description: 'Topic to trace history for',
                },
                limit: {
                  type: 'number',
                  description: 'Number of results (default: 10)',
                },
              },
              required: ['topic'],
            },
          },
          {
            name: 'decisions',
            description: 'Find sessions containing key decisions, optionally filtered by topic',
            inputSchema: {
              type: 'object',
              properties: {
                topic: {
                  type: 'string',
                  description: 'Optional topic to filter decisions (e.g., "auth", "architecture")',
                },
                limit: {
                  type: 'number',
                  description: 'Number of results (default: 10)',
                },
              },
            },
          },
          {
            name: 'recent_activity',
            description: 'Show recent activity across all content types',
            inputSchema: {
              type: 'object',
              properties: {
                days: {
                  type: 'number',
                  description: 'Number of days to look back (default: 7)',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum items to return (default: 20)',
                },
              },
            },
          },
          {
            name: 'digest',
            description: 'Show daily digest of recent activity for catching up',
            inputSchema: {
              type: 'object',
              properties: {
                days: {
                  type: 'number',
                  description: 'Number of days to show (default: 7)',
                },
              },
            },
          },
          {
            name: 'handoffs',
            description: 'Find handoff items and open threads from recent sessions',
            inputSchema: {
              type: 'object',
              properties: {
                sessions: {
                  type: 'number',
                  description: 'Number of recent sessions to check (default: 10)',
                },
              },
            },
          },
          {
            name: 'build_graph',
            description: 'Build knowledge graph from journal sessions (extracts relationships between sessions)',
            inputSchema: {
              type: 'object',
              properties: {
                reindex: {
                  type: 'boolean',
                  description: 'Force rebuild of entire graph (default: false)',
                },
              },
            },
          },
          {
            name: 'find_similar',
            description: 'Find documents similar to a given session/document by ID',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'ID of the document to find similar items for',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum similar documents to return (default: 5)',
                },
                excludeSelf: {
                  type: 'boolean',
                  description: 'Exclude the source document from results (default: true)',
                },
              },
              required: ['sessionId'],
            },
          },
          {
            name: 'query_patterns',
            description: 'Find sessions with a specific pattern (e.g., "oauth", "database", "deployment")',
            inputSchema: {
              type: 'object',
              properties: {
                pattern: {
                  type: 'string',
                  description: 'Pattern name to search for',
                },
              },
              required: ['pattern'],
            },
          },
          {
            name: 'find_path',
            description: 'Find relationship path between two sessions',
            inputSchema: {
              type: 'object',
              properties: {
                fromSessionId: {
                  type: 'string',
                  description: 'Start session ID',
                },
                toSessionId: {
                  type: 'string',
                  description: 'End session ID',
                },
              },
              required: ['fromSessionId', 'toSessionId'],
            },
          },
          {
            name: 'query_dependencies',
            description: 'Get sessions that a given session depends on for context',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to analyze',
                },
              },
              required: ['sessionId'],
            },
          },
        ] as Tool[],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const manager = await this.getMemoryManager();

        switch (name) {
          case 'search': {
            const {
              query,
              limit = 5,
              threshold = 0.5,
              includeFullContent = false,
              maxContentLength = 500,
              contentTypes,
              since,
              until
            } = args as any;

            const searchOpts: any = {
              query,
              limit,
              threshold,
              includeFullContent,
              maxContentLength,
              contentTypes
            };

            if (since || until) {
              searchOpts.dateRange = {
                start: since || '1900-01-01',
                end: until || '2100-12-31'
              };
            }

            const results = await manager.search(searchOpts);

            // Compact format: one line per result, optimized for LLM consumption
            // Format: "77% issue-4 — content preview..."
            const lines = results.map(r => {
              const pct = Math.round(r.similarity * 100);
              // Collapse whitespace in content preview
              const preview = r.content.replace(/\s+/g, ' ').substring(0, 120);
              return `${pct}% ${r.sessionId} — ${preview}`;
            });

            return {
              content: [
                {
                  type: 'text',
                  text: lines.join('\n'),
                },
              ],
            };
          }

          case 'index': {
            const { incremental = true, reindex = false } = args as any;

            if (reindex) {
              const result = await manager.reindex(this.repoPath);
              return {
                content: [
                  {
                    type: 'text',
                    text: `Reindexed ${result.indexed} sessions`,
                  },
                ],
              };
            } else {
              const result = await manager.indexRepository(this.repoPath, incremental);
              return {
                content: [
                  {
                    type: 'text',
                    text: `Indexed ${result.indexed} new sessions, skipped ${result.skipped} existing`,
                  },
                ],
              };
            }
          }

          case 'get_session': {
            const { sessionId } = args as any;
            const session = await manager.getSession(sessionId);

            if (!session) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Session ${sessionId} not found`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(session, null, 2),
                },
              ],
            };
          }

          case 'stats': {
            const stats = await manager.getStats();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(stats, null, 2),
                },
              ],
            };
          }

          case 'summarize': {
            const stats = await manager.getStats();
            const sessions = await manager.getAllSessions();

            // Calculate summary
            const typeCounts: Record<string, number> = {};
            let earliest = '';
            let latest = '';

            for (const s of sessions) {
              const type = s.contentType || 'unknown';
              typeCounts[type] = (typeCounts[type] || 0) + 1;
              if (s.date) {
                if (!earliest || s.date < earliest) earliest = s.date;
                if (!latest || s.date > latest) latest = s.date;
              }
            }

            const typeList = Object.entries(typeCounts)
              .sort((a, b) => b[1] - a[1])
              .map(([t, c]) => `${t}: ${c}`)
              .join(', ');

            const summary = [
              `Documents: ${stats.totalIndexedDocuments}`,
              `Date range: ${earliest || 'N/A'} to ${latest || 'N/A'}`,
              `Types: ${typeList}`,
            ].join('\n');

            return {
              content: [{ type: 'text', text: summary }],
            };
          }

          case 'topics': {
            const { limit = 15 } = args as any;
            const sessions = await manager.getAllSessions();

            const patternCounts: Record<string, number> = {};
            for (const s of sessions) {
              for (const pattern of s.patterns || []) {
                const normalized = pattern.toLowerCase().trim();
                if (normalized.length > 2) {
                  patternCounts[normalized] = (patternCounts[normalized] || 0) + 1;
                }
              }
            }

            const sorted = Object.entries(patternCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, limit);

            if (sorted.length === 0) {
              return { content: [{ type: 'text', text: 'No topics found. Run extraction to generate topics.' }] };
            }

            const lines = sorted.map(([topic, count]) => `${count} × ${topic}`);
            return { content: [{ type: 'text', text: `Common topics:\n${lines.join('\n')}` }] };
          }

          case 'references': {
            const { limit = 10 } = args as any;
            const sessions = await manager.getAllSessions();

            const issueCounts: Record<string, number> = {};
            for (const s of sessions) {
              for (const issue of s.issues || []) {
                const normalized = issue.replace(/^#/, '');
                issueCounts[normalized] = (issueCounts[normalized] || 0) + 1;
              }
            }

            const sorted = Object.entries(issueCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, limit);

            if (sorted.length === 0) {
              return { content: [{ type: 'text', text: 'No references found.' }] };
            }

            const lines = sorted.map(([issue, count]) => `${count} × #${issue}`);
            return { content: [{ type: 'text', text: `Most referenced issues:\n${lines.join('\n')}` }] };
          }

          case 'context': {
            const { topic, limit = 5 } = args as any;

            // Search for the topic but prioritize older documents (context/background)
            const results = await manager.search({
              query: topic,
              limit: limit * 3, // Get more, then filter
              threshold: 0.3,
            });

            // Sort by date ascending (oldest first) to get foundational context
            const sorted = results
              .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
              .slice(0, limit);

            if (sorted.length === 0) {
              return { content: [{ type: 'text', text: `No context found for "${topic}"` }] };
            }

            const lines = sorted.map(r => {
              const pct = Math.round(r.similarity * 100);
              const preview = r.content.replace(/\s+/g, ' ').substring(0, 80);
              return `[${r.date}] ${pct}% ${r.sessionId} — ${preview}`;
            });

            return {
              content: [{ type: 'text', text: `Context for "${topic}" (oldest first):\n${lines.join('\n')}` }],
            };
          }

          case 'history': {
            const { topic, limit = 10 } = args as any;

            // Get all matching documents and sort chronologically
            const results = await manager.search({
              query: topic,
              limit: limit * 2,
              threshold: 0.35,
            });

            // Sort by date chronologically
            const sorted = results
              .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
              .slice(0, limit);

            if (sorted.length === 0) {
              return { content: [{ type: 'text', text: `No history found for "${topic}"` }] };
            }

            const lines = sorted.map(r => {
              const type = (r as any).contentType?.[0] || '?';
              const preview = r.content.replace(/\s+/g, ' ').substring(0, 60);
              return `${r.date} [${type}] ${r.sessionId}: ${preview}...`;
            });

            return {
              content: [{ type: 'text', text: `History of "${topic}":\n${lines.join('\n')}` }],
            };
          }

          case 'decisions': {
            const { topic, limit = 10 } = args as any;

            // Search for decision-related content
            const query = topic
              ? `${topic} decision ratified approved agreed`
              : 'decision ratified approved agreed bilateral consensus';

            const results = await manager.search({
              query,
              limit: limit * 2,
              threshold: 0.3,
            });

            // Filter to those with decision indicators
            const decisionKeywords = ['decision', 'ratif', 'approv', 'agreed', 'consensus', 'bilateral', 'wwgd'];
            const filtered = results.filter(r => {
              const lower = r.content.toLowerCase();
              return decisionKeywords.some(k => lower.includes(k));
            }).slice(0, limit);

            if (filtered.length === 0) {
              return { content: [{ type: 'text', text: topic ? `No decisions found for "${topic}"` : 'No decisions found' }] };
            }

            const lines = filtered.map(r => {
              const preview = r.content.replace(/\s+/g, ' ').substring(0, 70);
              return `${r.date} ${r.sessionId}: ${preview}...`;
            });

            const header = topic ? `Decisions about "${topic}"` : 'Recent decisions';
            return {
              content: [{ type: 'text', text: `${header}:\n${lines.join('\n')}` }],
            };
          }

          case 'recent_activity': {
            const { days = 7, limit = 20 } = args as any;
            const sessions = await manager.getAllSessions();

            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            const cutoffStr = cutoff.toISOString().split('T')[0];

            // Filter to recent and sort by date desc
            const recent = sessions
              .filter(s => s.date >= cutoffStr)
              .sort((a, b) => b.date.localeCompare(a.date))
              .slice(0, limit);

            if (recent.length === 0) {
              return { content: [{ type: 'text', text: `No activity in the last ${days} days` }] };
            }

            // Group by type
            const byType: Record<string, number> = {};
            for (const s of recent) {
              const t = s.contentType || 'unknown';
              byType[t] = (byType[t] || 0) + 1;
            }

            const typeSummary = Object.entries(byType)
              .map(([t, c]) => `${t}: ${c}`)
              .join(', ');

            const lines = recent.slice(0, 10).map(s => {
              const type = s.contentType?.[0] || '?';
              const preview = s.content.replace(/\s+/g, ' ').substring(0, 50);
              return `${s.date} [${type}] ${s.id}: ${preview}...`;
            });

            return {
              content: [{
                type: 'text',
                text: `Last ${days} days: ${recent.length} items (${typeSummary})\n\n${lines.join('\n')}`
              }],
            };
          }

          case 'digest': {
            const { days = 7 } = args as any;
            const sessions = await manager.getAllSessions();

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
              return { content: [{ type: 'text', text: `No activity in the last ${days} days` }] };
            }

            const lines: string[] = [];
            for (const date of dates) {
              const items = byDate[date];
              const byType: Record<string, number> = {};
              for (const item of items) {
                const t = item.contentType || 'unknown';
                byType[t] = (byType[t] || 0) + 1;
              }
              const typeSummary = Object.entries(byType).map(([t, c]) => `${t}:${c}`).join(' ');
              lines.push(`\n${date} (${items.length} items: ${typeSummary})`);

              for (const item of items.slice(0, 3)) {
                const type = (item.contentType || '?')[0];
                const preview = item.content.replace(/\s+/g, ' ').substring(0, 50);
                lines.push(`  [${type}] ${item.id}: ${preview}...`);
              }
              if (items.length > 3) {
                lines.push(`  ... and ${items.length - 3} more`);
              }
            }

            return {
              content: [{ type: 'text', text: `Daily digest (last ${days} days):${lines.join('\n')}` }],
            };
          }

          case 'handoffs': {
            const { sessions: sessionCount = 10 } = args as any;

            // Search for handoff-related content in recent sessions
            const results = await manager.search({
              query: 'handoff next session todo open thread blocked pending follow-up',
              limit: sessionCount * 3,
              threshold: 0.25,
              contentTypes: ['session', 'conversation'],
            });

            // Filter to those with handoff indicators
            const handoffKeywords = ['handoff', 'next session', 'todo', 'blocked', 'pending', 'follow-up', 'open thread', 'continues', 'wip'];
            const filtered = results.filter(r => {
              const lower = r.content.toLowerCase();
              return handoffKeywords.some(k => lower.includes(k));
            }).slice(0, sessionCount);

            if (filtered.length === 0) {
              return { content: [{ type: 'text', text: 'No explicit handoff items found in recent sessions' }] };
            }

            const lines = filtered.map(r => {
              const preview = r.content.replace(/\s+/g, ' ').substring(0, 100);
              return `${r.date} ${r.sessionId}: ${preview}...`;
            });

            return {
              content: [{ type: 'text', text: `Handoff items from recent sessions:\n${lines.join('\n')}` }],
            };
          }

          case 'build_graph': {
            const graphManager = await this.getGraphManager();
            const { reindex = false } = args as any;

            if (reindex) {
              await graphManager.clear();
            }

            // Get sessions from memory manager
            const sessions = await manager.getAllSessions();
            const result = await graphManager.buildGraph(sessions);

            return {
              content: [
                {
                  type: 'text',
                  text: `Built knowledge graph: ${result.nodesCreated} nodes, ${result.edgesCreated} edges`,
                },
              ],
            };
          }

          case 'find_similar': {
            const { sessionId, limit = 5, excludeSelf = true } = args as any;

            // Get the source document
            const sourceDoc = await manager.getSession(sessionId);
            if (!sourceDoc) {
              return {
                content: [{ type: 'text', text: `Document not found: ${sessionId}` }],
              };
            }

            // Search using the document's content as query
            const results = await manager.search({
              query: sourceDoc.content.substring(0, 2000), // Use first 2000 chars
              limit: excludeSelf ? limit + 1 : limit,
              threshold: 0.3,
            });

            // Filter out self if requested
            const filtered = excludeSelf
              ? results.filter(r => r.sessionId !== sessionId).slice(0, limit)
              : results.slice(0, limit);

            const lines = filtered.map(r => {
              const pct = Math.round(r.similarity * 100);
              const preview = r.content.replace(/\s+/g, ' ').substring(0, 80);
              return `${pct}% ${r.sessionId} — ${preview}`;
            });

            return {
              content: [
                { type: 'text', text: `Similar to ${sessionId}:\n${lines.join('\n')}` },
              ],
            };
          }

          case 'query_patterns': {
            const graphManager = await this.getGraphManager();
            const { pattern } = args as any;

            const result = await graphManager.queryPatterns(pattern);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          case 'find_path': {
            const graphManager = await this.getGraphManager();
            const { fromSessionId, toSessionId } = args as any;

            const path = await graphManager.findPath(fromSessionId, toSessionId);

            if (!path) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `No path found between ${fromSessionId} and ${toSessionId}`,
                  },
                ],
              };
            }

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(path, null, 2),
                },
              ],
            };
          }

          case 'query_dependencies': {
            const graphManager = await this.getGraphManager();
            const { sessionId } = args as any;

            const result = await graphManager.queryDependencies(sessionId);

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Gordo Memory MCP server running on stdio');
  }
}

const server = new GordoLedgerServer();
server.run().catch(console.error);
