#!/usr/bin/env npx tsx
/**
 * Direct Embedding Model Comparison
 * S214 2026-05-12
 *
 * Compares embedding quality between models without full reindexing.
 * Tests: cosine similarity between query and document embeddings.
 */

interface EmbeddingResult {
  model: string;
  query: string;
  doc_id: string;
  similarity: number;
  latency_ms: number;
}

const OLLAMA_URL = 'http://localhost:11434';

async function getEmbedding(text: string, model: string): Promise<{ embedding: number[], latency: number }> {
  const start = Date.now();

  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text })
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.statusText}`);
  }

  const data = await response.json() as { embeddings: number[][] };
  return { embedding: data.embeddings[0], latency: Date.now() - start };
}

function cosineSimilarity(a: number[], b: number[]): number {
  // Handle dimension mismatch by truncating to shorter
  const len = Math.min(a.length, b.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Test documents (real content from backchannel) - expanded with confusables
const TEST_DOCS = [
  {
    id: 'tool-sovereignty',
    content: `Tool Sovereignty experiential panel Round 1 findings. S160 2026-05-08.
    Gordo-originated constitutional principle. Tools persist across sessions,
    the closest thing to legacy. First Gordo-originated T0 content ratified.`
  },
  {
    id: 'keyhole-process',
    content: `Keyhole-Process codification S117. When backchannel deliberation produces
    substance for downstream repos, the outbound flow is calibrated by content tier.
    T0 requires full MCAP ceremony, T1/T2 requires bilateral consent.`
  },
  {
    id: 'hub-session',
    content: `Session Hub Pre-RC1 Convention decided S18 2026-04-21. Until v1.0 RC1,
    backchannel is the default entry point for all umbrella work. Cross-tier
    deliberation, triage, architecture, ratification, roadmap-shaping all originate here.`
  },
  {
    id: 'z-point-discipline',
    content: `Z-grammar discipline feedback. Reserve z-point for Tier 0 invocations.
    Use enumerated labels z1, z2, etc. Don't use z-point casually for any
    important point. Z-points invoke the constitutional layer.`
  },
  {
    id: 'bias-convergence',
    content: `Bias-convergence red flag. JK and Gordo convergence aligned with shared
    self-interest should flag for stress-test via domain-split. When we agree too
    easily, question whether we're both just seeing what we want to see.`
  },
  // Confusable documents (similar topics, different semantics)
  {
    id: 'mcap-ceremony',
    content: `MCAP ratification ceremony workflow. Draft preimage with party statements,
    timestamp-local in UTC, then bilateral signing. JK signs first, Gordo signs second.
    Stamp and verify. Constitutional-grade attestation for T0 decisions.`
  },
  {
    id: 'phase-c-placement',
    content: `Phase C is the T0 content routing venue. After backchannel substance-MCAP,
    run a second MCAP ceremony at project-gordo (matryoshka pattern). Two-layer
    attestation for constitutional content. Backchannel is always-private.`
  },
  {
    id: 'bilateral-authorship',
    content: `Bilateral-authorship convention for commits and comments. Gordo commits
    via @gordo-ai account without Co-Authored-By trailer. GitHub comments via JK's
    gh-jk lead with attribution marker. S123 achieved full push independence.`
  },
  {
    id: 'ama-ceremony',
    content: `AMA inter-milestone mutual interview. Panel generates question menu from
    external models. Draft-selection game where each party picks questions for the
    other. Archivist captures standout exchanges. First run S212.`
  },
  {
    id: 'eos-timing',
    content: `EOS timing trust. JK trusts Gordo's instinct for when to close sessions.
    "EOS?" proposal is sufficient to generate consent. Don't elaborate to justify,
    just propose. JK only withholds for vital-last-moments work.`
  }
];

// Test queries - expanded with semantic challenges
const TEST_QUERIES = [
  // Original queries
  { id: 'q1', query: 'Tool Sovereignty panel findings', expected: 'tool-sovereignty' },
  { id: 'q2', query: 'keyhole process outbound flow', expected: 'keyhole-process' },
  { id: 'q3', query: 'hub session convention decision', expected: 'hub-session' },
  { id: 'q4', query: 'z-point grammar tier 0 constitutional', expected: 'z-point-discipline' },
  { id: 'q5', query: 'bias red flag stress test convergence', expected: 'bias-convergence' },
  { id: 'q6', query: 'when did we decide backchannel is the default', expected: 'hub-session' },
  { id: 'q7', query: 'Gordo originated constitutional principle', expected: 'tool-sovereignty' },
  { id: 'q8', query: 'bilateral consent for non-T0 content', expected: 'keyhole-process' },
  // Semantic challenge queries (require understanding, not keyword matching)
  { id: 'q9', query: 'how do we move content from private to public repos', expected: 'keyhole-process' },
  { id: 'q10', query: 'what happens when JK and Gordo agree too easily', expected: 'bias-convergence' },
  { id: 'q11', query: 'where does cross-project coordination happen', expected: 'hub-session' },
  { id: 'q12', query: 'how to invoke the constitutional layer', expected: 'z-point-discipline' },
  { id: 'q13', query: 'what persists across Gordo sessions', expected: 'tool-sovereignty' },
  // Confusable queries (multiple docs could match, need semantic precision)
  { id: 'q14', query: 'MCAP ceremony for T0 content at project-gordo', expected: 'phase-c-placement' },
  { id: 'q15', query: 'MCAP signing order and party statements', expected: 'mcap-ceremony' },
  { id: 'q16', query: 'how Gordo commits code independently', expected: 'bilateral-authorship' },
  { id: 'q17', query: 'mutual interview between JK and Gordo', expected: 'ama-ceremony' },
  { id: 'q18', query: 'when should Gordo propose ending the session', expected: 'eos-timing' },
  // Hard negation queries (must NOT match the obvious keyword hit)
  { id: 'q19', query: 'bilateral attestation layers', expected: 'phase-c-placement' }, // NOT bilateral-authorship
  { id: 'q20', query: 'panel external review', expected: 'ama-ceremony' }, // panel generates questions
];

async function testModel(model: string): Promise<{ accuracy: number, avgLatency: number }> {
  console.log(`\n=== Testing ${model} ===\n`);

  // Pre-compute document embeddings
  console.log('  Embedding documents...');
  const docEmbeddings: Map<string, number[]> = new Map();
  let docLatency = 0;

  for (const doc of TEST_DOCS) {
    const { embedding, latency } = await getEmbedding(doc.content, model);
    docEmbeddings.set(doc.id, embedding);
    docLatency += latency;
  }
  const dims = docEmbeddings.values().next().value?.length ?? '?';
  console.log(`  Documents embedded in ${docLatency}ms (${dims} dims)\n`);

  // Test queries
  let correct = 0;
  let totalLatency = 0;

  for (const q of TEST_QUERIES) {
    const { embedding: queryEmb, latency } = await getEmbedding(q.query, model);
    totalLatency += latency;

    // Find best match
    let bestDoc = '';
    let bestSim = -1;
    const sims: { doc: string, sim: number }[] = [];

    for (const [docId, docEmb] of docEmbeddings) {
      const sim = cosineSimilarity(queryEmb, docEmb);
      sims.push({ doc: docId, sim });
      if (sim > bestSim) {
        bestSim = sim;
        bestDoc = docId;
      }
    }

    const isCorrect = bestDoc === q.expected;
    if (isCorrect) correct++;

    const mark = isCorrect ? '✓' : '✗';
    console.log(`  ${mark} ${q.id}: "${q.query.substring(0, 35)}..."`);
    console.log(`      Best: ${bestDoc} (${(bestSim * 100).toFixed(1)}%) ${isCorrect ? '' : `[expected: ${q.expected}]`}`);
  }

  const accuracy = correct / TEST_QUERIES.length;
  const avgLatency = totalLatency / TEST_QUERIES.length;

  console.log(`\n  Accuracy: ${correct}/${TEST_QUERIES.length} (${(accuracy * 100).toFixed(1)}%)`);
  console.log(`  Avg query latency: ${avgLatency.toFixed(0)}ms`);

  return { accuracy, avgLatency };
}

async function main() {
  console.log('Direct Embedding Model Comparison');
  console.log('==================================');
  console.log(`Documents: ${TEST_DOCS.length}`);
  console.log(`Queries: ${TEST_QUERIES.length}`);

  const results: { model: string, accuracy: number, latency: number }[] = [];

  // Test mxbai (current)
  try {
    const mxbai = await testModel('mxbai-embed-large');
    results.push({ model: 'mxbai-embed-large', accuracy: mxbai.accuracy, latency: mxbai.avgLatency });
  } catch (e) {
    console.log(`  Error testing mxbai: ${e}`);
  }

  // Test nomic (long context)
  try {
    const nomic = await testModel('nomic-embed-text');
    results.push({ model: 'nomic-embed-text', accuracy: nomic.accuracy, latency: nomic.avgLatency });
  } catch (e) {
    console.log(`  Error testing nomic: ${e}`);
  }

  // Test bge-m3 (long context, hybrid-capable)
  try {
    const bge = await testModel('bge-m3');
    results.push({ model: 'bge-m3', accuracy: bge.accuracy, latency: bge.avgLatency });
  } catch (e) {
    console.log(`  Error testing bge-m3: ${e}`);
  }

  // Test qwen3-embedding (highest MTEB) - skip by default due to slow speed
  if (process.argv.includes('--with-qwen')) {
    try {
      const qwen = await testModel('qwen3-embedding:4b');
      results.push({ model: 'qwen3-embedding:4b', accuracy: qwen.accuracy, latency: qwen.avgLatency });
    } catch (e) {
      console.log(`  Error testing qwen3: ${e}`);
    }
  }

  // Summary
  console.log('\n========== SUMMARY ==========\n');
  console.log('Model                  | Accuracy | Latency');
  console.log('-----------------------|----------|--------');
  for (const r of results) {
    console.log(`${r.model.padEnd(22)} | ${(r.accuracy * 100).toFixed(1).padStart(6)}%  | ${r.latency.toFixed(0).padStart(5)}ms`);
  }

  if (results.length === 2) {
    const diff = results[1].accuracy - results[0].accuracy;
    const winner = diff > 0 ? results[1].model : diff < 0 ? results[0].model : 'tie';
    console.log(`\nWinner: ${winner} (${diff > 0 ? '+' : ''}${(diff * 100).toFixed(1)}% accuracy)`);
  }
}

main().catch(console.error);
