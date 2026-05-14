#!/usr/bin/env npx tsx
/**
 * Embedding Strategy Experiment Runner
 * S214 2026-05-12
 *
 * Compares different embedding models/strategies on test queries.
 * Measures: pattern match rate, retrieval quality, latency.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface Query {
  id: string;
  query: string;
  type: string;
  expected_patterns: string[];
}

interface TestQueries {
  queries: Query[];
}

interface Result {
  query_id: string;
  query: string;
  matches: number;
  total_patterns: number;
  match_rate: number;
  top_results: string[];
  latency_ms: number;
}

interface StrategyResult {
  strategy: string;
  model: string;
  avg_match_rate: number;
  avg_latency_ms: number;
  results: Result[];
}

const STRATEGIES = {
  'mxbai-truncate': {
    model: 'mxbai-embed-large',
    description: 'Current baseline with head/tail truncation'
  },
  'nomic-full': {
    model: 'nomic-embed-text',
    description: 'Long-context model, no truncation'
  }
};

async function runQuery(query: string, model: string): Promise<{ results: string[], latency: number }> {
  const start = Date.now();

  // For now, we use the CLI which uses whatever model is configured
  // TODO: Add model switching to gordo-memory CLI
  const cmd = `node ~/gordo-framework/mcp-servers/gordo-memory/dist/cli.js search "${query.replace(/"/g, '\\"')}" --limit 5 -p ~/project-gordo-backchannel 2>/dev/null`;

  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    const latency = Date.now() - start;

    // Parse results (format: "XX% id → path — preview...")
    const lines = output.trim().split('\n').filter(l => l.match(/^\d+%/));
    return { results: lines, latency };
  } catch (e) {
    return { results: [], latency: Date.now() - start };
  }
}

function scoreResult(result: string[], expected_patterns: string[]): { matches: number, total: number } {
  const resultText = result.join(' ').toLowerCase();
  let matches = 0;

  for (const pattern of expected_patterns) {
    if (resultText.includes(pattern.toLowerCase())) {
      matches++;
    }
  }

  return { matches, total: expected_patterns.length };
}

async function runExperiment(strategyName: string): Promise<StrategyResult> {
  const strategy = STRATEGIES[strategyName as keyof typeof STRATEGIES];
  console.log(`\n=== Running strategy: ${strategyName} (${strategy.model}) ===\n`);

  const queriesPath = path.join(__dirname, 'test-queries.json');
  const testQueries: TestQueries = JSON.parse(fs.readFileSync(queriesPath, 'utf-8'));

  const results: Result[] = [];
  let totalMatchRate = 0;
  let totalLatency = 0;

  for (const q of testQueries.queries) {
    process.stdout.write(`  ${q.id}: "${q.query.substring(0, 40)}..." `);

    const { results: searchResults, latency } = await runQuery(q.query, strategy.model);
    const { matches, total } = scoreResult(searchResults, q.expected_patterns);
    const matchRate = total > 0 ? matches / total : 0;

    results.push({
      query_id: q.id,
      query: q.query,
      matches,
      total_patterns: total,
      match_rate: matchRate,
      top_results: searchResults.slice(0, 3),
      latency_ms: latency
    });

    totalMatchRate += matchRate;
    totalLatency += latency;

    const status = matchRate >= 0.5 ? '✓' : matchRate > 0 ? '◐' : '✗';
    console.log(`${status} ${(matchRate * 100).toFixed(0)}% (${latency}ms)`);
  }

  const avgMatchRate = totalMatchRate / testQueries.queries.length;
  const avgLatency = totalLatency / testQueries.queries.length;

  console.log(`\n  Average match rate: ${(avgMatchRate * 100).toFixed(1)}%`);
  console.log(`  Average latency: ${avgLatency.toFixed(0)}ms`);

  return {
    strategy: strategyName,
    model: strategy.model,
    avg_match_rate: avgMatchRate,
    avg_latency_ms: avgLatency,
    results
  };
}

async function main() {
  console.log('Embedding Strategy Experiment');
  console.log('=============================');
  console.log(`Test corpus: ~/project-gordo-backchannel`);
  console.log(`Queries: 20`);
  console.log('');

  // For Phase 1, we only test the baseline since both use same index
  // Full A/B requires re-indexing with different models

  const baselineResult = await runExperiment('mxbai-truncate');

  // Save results
  const resultsPath = path.join(__dirname, 'results', `baseline-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
  fs.writeFileSync(resultsPath, JSON.stringify(baselineResult, null, 2));

  console.log(`\nResults saved to: ${resultsPath}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Strategy: ${baselineResult.strategy}`);
  console.log(`Model: ${baselineResult.model}`);
  console.log(`Average Match Rate: ${(baselineResult.avg_match_rate * 100).toFixed(1)}%`);
  console.log(`Average Latency: ${baselineResult.avg_latency_ms.toFixed(0)}ms`);

  // Identify weak queries
  const weakQueries = baselineResult.results.filter(r => r.match_rate < 0.5);
  if (weakQueries.length > 0) {
    console.log(`\nWeak queries (< 50% match):`);
    for (const wq of weakQueries) {
      console.log(`  - ${wq.query_id}: "${wq.query}" (${(wq.match_rate * 100).toFixed(0)}%)`);
    }
  }
}

main().catch(console.error);
