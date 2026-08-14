/**
 * Pooled federated search — S162 workshop.
 *
 * The original design gave every realm its own reranking contest: each realm
 * reranked its own top 20 and returned `limit` survivors, and those survivors
 * were then merged and sorted against each other by scores the reranker had
 * never compared. Nineteen contests, one leaderboard, no shared scale.
 *
 * It was also the entire cost of a federated query. Reranking is one DeepInfra
 * round trip, so per-realm reranking meant one round trip per realm, serialized.
 * Measured on jk-gordo-workshop with 19 federated spokes, 12 queries: 41s mean,
 * 317s worst. Pooled: ~2.5s steady state.
 *
 * Both entry points (the MCP server and the CLI) had their own copy of the
 * federation loop, so this lives here rather than in either of them.
 */

import { MemoryManager } from './memory-manager-v2.js';
import { rerank } from './reranker.js';
import type { SearchOptions, SearchResult } from './types.js';

/** Candidates the single rerank call scores. Documents are truncated to 2000
 *  chars by the reranker, so this bounds the request at roughly 120KB. */
export const RERANK_POOL_SIZE = 60;

/** Seats each realm is guaranteed in that pool before the rest is filled by
 *  score. Without this, pooling is a recall regression: hybrid scores are only
 *  comparable within a realm (BM25 IDF depends on corpus size), so a small
 *  spoke's best document can lose a global sort to a large spoke's mediocre one
 *  and never reach the reranker. Per-realm reranking, for all its cost, did
 *  guarantee every realm a hearing. Measured on the same 12 queries: without
 *  the floor, results spanned 4 distinct realms; with it, 7. */
export const RERANK_PER_REALM_FLOOR = 2;

export interface FederatedRealm {
  manager: MemoryManager;
  realm: string;
}

/**
 * Search the local manager and every federated realm, pool the candidates, and
 * rerank the pool ONCE.
 *
 * Returns results ordered by the reranker's single scale, sliced to
 * `searchOpts.limit`, with `sourceRealm` set on anything not from the local
 * manager. Content truncation the caller asked for is re-applied at the end:
 * the pooled searches request full content because the reranker reads the
 * document, and manager.search() would otherwise truncate on the way out.
 */
export async function pooledFederatedSearch(
  localManager: MemoryManager,
  federated: FederatedRealm[],
  searchOpts: SearchOptions
): Promise<SearchResult[]> {
  const limit = searchOpts.limit ?? 5;
  const includeFullContent = searchOpts.includeFullContent ?? false;
  const maxContentLength = searchOpts.maxContentLength ?? 500;

  const poolOpts: SearchOptions = {
    ...searchOpts,
    limit: Math.max(limit * 3, 20),
    rerankerEnabled: false,
    includeFullContent: true,
  };

  const pools = await Promise.all([
    localManager.search(poolOpts).catch(() => [] as SearchResult[]),
    ...federated.map(({ manager, realm }) =>
      manager
        .search(poolOpts)
        .then(rs => rs.map(r => Object.assign(r, { sourceRealm: realm })))
        .catch(() => [] as SearchResult[])
    ),
  ]);

  // Per-realm floor first, then the best of what is left, wherever it came from.
  const byRealm = new Map<string, SearchResult[]>();
  for (const r of pools.flat()) {
    const realm = (r as any).sourceRealm ?? 'local';
    if (!byRealm.has(realm)) byRealm.set(realm, []);
    byRealm.get(realm)!.push(r);
  }
  const seated: SearchResult[] = [];
  const overflow: SearchResult[] = [];
  for (const rs of byRealm.values()) {
    rs.sort((a, b) => b.similarity - a.similarity);
    seated.push(...rs.slice(0, RERANK_PER_REALM_FLOOR));
    overflow.push(...rs.slice(RERANK_PER_REALM_FLOOR));
  }
  overflow.sort((a, b) => b.similarity - a.similarity);
  const candidates = [...seated, ...overflow]
    .slice(0, RERANK_POOL_SIZE)
    .sort((a, b) => b.similarity - a.similarity);

  let results: SearchResult[] = candidates;
  if (candidates.length > 1) {
    try {
      const reranked = await rerank(
        searchOpts.query,
        candidates.map(r => ({
          id: r.sessionId,
          content: r.content,
          score: r.similarity,
          metadata: r,
        })),
        { enabled: true, topK: RERANK_POOL_SIZE }
      );
      results = reranked.map(r =>
        Object.assign({}, r.metadata as SearchResult, { similarity: r.score })
      );
    } catch {
      // Reranker failed — keep hybrid ordering rather than nothing.
    }
  }

  results = results.slice(0, limit);

  if (!includeFullContent) {
    results = results.map(r =>
      r.content && r.content.length > maxContentLength
        ? { ...r, content: r.content.substring(0, maxContentLength) + '...', contentTruncated: true }
        : r
    );
  }

  return results;
}
