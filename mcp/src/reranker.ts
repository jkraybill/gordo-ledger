/**
 * Cross-encoder reranker using DeepInfra's Qwen3-Reranker-4B
 *
 * S338: Implemented based on benchmark findings showing 43.8% → 90.1% accuracy
 * gap between Ledger and EverMemOS, primarily due to missing cross-encoder reranking.
 *
 * The reranker sees query + document together (cross-encoder) rather than
 * comparing embeddings (bi-encoder), enabling deeper semantic understanding.
 */

import * as fs from 'fs';
import * as path from 'path';

const DEEPINFRA_ENDPOINT = 'https://api.deepinfra.com/v1/inference/Qwen/Qwen3-Reranker-4B';
const DEFAULT_TOP_K = 20; // Rerank top 20 candidates
const MAX_DOC_LENGTH = 2000; // Truncate long docs to avoid token limits

interface RerankerConfig {
  enabled: boolean;
  topK: number;
  apiKey?: string;
}

interface RerankResult {
  id: string;
  content: string;
  score: number;
  originalScore: number;
  metadata: any;
}

/**
 * Load API key from settings.local.json or environment
 */
function getApiKey(): string | null {
  // Check environment first
  if (process.env.DEEPINFRA_API_KEY) {
    return process.env.DEEPINFRA_API_KEY;
  }

  // Fall back to Claude Code settings
  const settingsPath = path.join(process.env.HOME || '', '.claude', 'settings.local.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    return settings.env?.DEEPINFRA_API_KEY || null;
  } catch {
    return null;
  }
}

/**
 * Check if reranking is available (API key present)
 */
export function isRerankerAvailable(): boolean {
  return getApiKey() !== null;
}

/**
 * Rerank search results using cross-encoder
 *
 * @param query - The search query
 * @param results - Initial search results from hybrid search
 * @param config - Reranker configuration
 * @returns Reranked results with updated scores
 */
export async function rerank(
  query: string,
  results: Array<{ id: string; content: string; score: number; metadata: any }>,
  config: Partial<RerankerConfig> = {}
): Promise<RerankResult[]> {
  const { enabled = true, topK = DEFAULT_TOP_K } = config;

  if (!enabled) {
    return results.map(r => ({ ...r, originalScore: r.score }));
  }

  const apiKey = config.apiKey || getApiKey();
  if (!apiKey) {
    // No API key - return original results unchanged
    console.warn('Reranker: No DEEPINFRA_API_KEY found, skipping reranking');
    return results.map(r => ({ ...r, originalScore: r.score }));
  }

  // Only rerank top K candidates
  const toRerank = results.slice(0, topK);
  const rest = results.slice(topK);

  if (toRerank.length === 0) {
    return [];
  }

  // Prepare documents (truncate if needed)
  const documents = toRerank.map(r => {
    const content = r.content || '';
    return content.length > MAX_DOC_LENGTH
      ? content.slice(0, MAX_DOC_LENGTH) + '...'
      : content;
  });

  // Create query array (same query for all docs)
  const queries = toRerank.map(() => query);

  try {
    const response = await fetch(DEEPINFRA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ queries, documents }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.warn(`Reranker API error: ${response.status} - ${error}`);
      return results.map(r => ({ ...r, originalScore: r.score }));
    }

    const data = await response.json() as { scores?: number[] };
    const scores: number[] = data.scores || [];

    // Combine reranker scores with original results
    // S435: Blend reranker score with original (0.6 reranker + 0.4 original)
    // Pure reranker was ignoring strong BM25 matches (e.g., "Seal" appearing 13x)
    const RERANKER_WEIGHT = 0.6;
    const ORIGINAL_WEIGHT = 0.4;

    const reranked: RerankResult[] = toRerank.map((result, i) => {
      const rerankerScore = scores[i] ?? result.score;
      const blendedScore = RERANKER_WEIGHT * rerankerScore + ORIGINAL_WEIGHT * result.score;
      return {
        ...result,
        originalScore: result.score,
        score: blendedScore,
      };
    });

    // Sort by reranker score
    reranked.sort((a, b) => b.score - a.score);

    // Append non-reranked results with adjusted scores
    const restWithScores: RerankResult[] = rest.map(r => ({
      ...r,
      originalScore: r.score,
      // Give rest results a score below the lowest reranked score
      score: Math.min(...reranked.map(rr => rr.score)) * 0.5 * (r.score / Math.max(...rest.map(rr => rr.score), 1)),
    }));

    return [...reranked, ...restWithScores];

  } catch (error) {
    console.warn('Reranker error:', error);
    return results.map(r => ({ ...r, originalScore: r.score }));
  }
}

/**
 * Get default reranker config
 */
export function getDefaultConfig(): RerankerConfig {
  return {
    enabled: isRerankerAvailable(),
    topK: DEFAULT_TOP_K,
  };
}
