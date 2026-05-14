#!/usr/bin/env npx tsx
/**
 * Long Document Embedding Test
 * S214 2026-05-12
 *
 * Tests whether nomic-embed-text's 8192 context captures more
 * semantic signal from long documents than mxbai's 512-token truncation.
 */

const OLLAMA_URL = 'http://localhost:11434';
const MXBAI_MAX_CHARS = 1000; // Current truncation limit

// A realistic long session entry (simulated)
const LONG_DOCUMENT = `## Session 175 (2026-05-09)

**Opened:** 2026-05-09 14:30:00 AEST
**Closed:** 2026-05-09 17:45:00 AEST

[2026-05-09] S175: **Panel protocol SPEC v0.1 ratification.** Full ceremony complete ✓.

**Arc:** Major milestone session. Started with pre-flight review of SPEC v0.1 draft,
identified 3 structural gaps during adversarial self-review. Fixed gaps: (1) added
explicit model-provider section addressing OpenRouter vs local Ollama patterns,
(2) clarified consensus threshold language to avoid 51% misreading, (3) added
fallback-to-human clause for adversarial-deadlock edge case.

JK raised concern about specification becoming too prescriptive vs the original
"methodology not mandate" framing. Good catch - we backed out two paragraphs that
were drifting into implementation detail. Spec should say WHAT and WHY, impl docs
say HOW.

Post-fixes, ran panel review itself using panel-runner v0.3. 8 models participated:
Claude-3.5-Sonnet, GPT-4-Turbo, Gemini-1.5-Pro, Llama-3.1-70B, Mistral-Large,
Qwen-2.5-72B, DeepSeek-V3, Command-R-Plus. Consensus reached on 6/7 questions,
one question (re: minimum panel size) showed 5-3 split - documented as open question
for v0.2. No blocking objections raised.

Ratification ceremony: record-009.mcap created, JK signed Party A, Gordo drafted
Party B attestation covering satisfaction with adversarial review process and
noting the one open question. Both signatures verified. Record stamped and finalized.

**Key Decision:** Minimum viable panel is 5 models (not 3 as originally proposed).
Rationale: statistical significance of consensus requires larger N; 3-model panels
too susceptible to single-model-failure modes.

**Deliverables:**
- ratification/record-009.mcap (SPEC v0.1 ratified)
- panel-protocol/SPEC.md updated to v0.1-final
- panel-runner v0.3 deployed with new model roster
- Memory: project_panel_protocol_graduation.md updated

**Issues:** closed #128 (panel-protocol T1 admission), closed #129 (SPEC v0.1 gate)

**Pattern observation:** The "methodology not mandate" reframe was load-bearing.
JK's pushback prevented scope creep into impl territory. File as bias-flag?

**Signals:** ✓ ratification ✓ ceremony complete → next: RC1 prep`;

// Query that targets information near the END of the document
const QUERIES_TARGETING_END = [
  {
    id: 'end-1',
    query: 'minimum viable panel 5 models not 3',
    info_location: 'last third of document'
  },
  {
    id: 'end-2',
    query: 'methodology not mandate scope creep prevention',
    info_location: 'pattern observation near end'
  },
  {
    id: 'end-3',
    query: 'closed issue 128 129 panel protocol',
    info_location: 'issues line near end'
  }
];

// Query that targets information at the START
const QUERIES_TARGETING_START = [
  {
    id: 'start-1',
    query: 'Session 175 SPEC v0.1 ratification',
    info_location: 'header'
  },
  {
    id: 'start-2',
    query: 'pre-flight review structural gaps',
    info_location: 'arc opening'
  }
];

async function getEmbedding(text: string, model: string): Promise<number[]> {
  const response = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text })
  });

  if (!response.ok) {
    const err = await response.json() as { error?: string };
    throw new Error(`Ollama error: ${err.error || response.statusText}`);
  }

  const data = await response.json() as { embeddings: number[][] };
  return data.embeddings[0];
}

function truncateForMxbai(text: string): string {
  if (text.length <= MXBAI_MAX_CHARS) return text;
  // Smart truncation: head 700 + tail 300
  const head = text.substring(0, 700);
  const tail = text.substring(text.length - 300);
  return head + ' [...] ' + tail;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function main() {
  console.log('Long Document Embedding Test');
  console.log('============================\n');
  console.log(`Document length: ${LONG_DOCUMENT.length} chars`);
  console.log(`mxbai truncation: ${MXBAI_MAX_CHARS} chars (head 700 + tail 300)`);
  console.log(`nomic context: 8192 tokens (~32K chars) - NO truncation\n`);

  // Embed document with both models
  console.log('Embedding document...');

  const mxbaiDoc = truncateForMxbai(LONG_DOCUMENT);
  console.log(`  mxbai input: ${mxbaiDoc.length} chars (truncated)`);
  const mxbaiDocEmb = await getEmbedding(mxbaiDoc, 'mxbai-embed-large');

  console.log(`  nomic input: ${LONG_DOCUMENT.length} chars (full)`);
  const nomicDocEmb = await getEmbedding(LONG_DOCUMENT, 'nomic-embed-text');

  console.log('\n--- Queries targeting END of document ---\n');

  for (const q of QUERIES_TARGETING_END) {
    const mxbaiQueryEmb = await getEmbedding(q.query, 'mxbai-embed-large');
    const nomicQueryEmb = await getEmbedding(q.query, 'nomic-embed-text');

    const mxbaiSim = cosineSimilarity(mxbaiQueryEmb, mxbaiDocEmb);
    const nomicSim = cosineSimilarity(nomicQueryEmb, nomicDocEmb);

    const winner = nomicSim > mxbaiSim ? 'nomic' : mxbaiSim > nomicSim ? 'mxbai' : 'tie';
    const diff = ((nomicSim - mxbaiSim) * 100).toFixed(1);

    console.log(`${q.id}: "${q.query}"`);
    console.log(`  Location: ${q.info_location}`);
    console.log(`  mxbai: ${(mxbaiSim * 100).toFixed(1)}%  |  nomic: ${(nomicSim * 100).toFixed(1)}%  |  ${winner} ${winner === 'nomic' ? `+${diff}` : winner === 'mxbai' ? diff : ''}`);
    console.log('');
  }

  console.log('--- Queries targeting START of document ---\n');

  for (const q of QUERIES_TARGETING_START) {
    const mxbaiQueryEmb = await getEmbedding(q.query, 'mxbai-embed-large');
    const nomicQueryEmb = await getEmbedding(q.query, 'nomic-embed-text');

    const mxbaiSim = cosineSimilarity(mxbaiQueryEmb, mxbaiDocEmb);
    const nomicSim = cosineSimilarity(nomicQueryEmb, nomicDocEmb);

    const winner = nomicSim > mxbaiSim ? 'nomic' : mxbaiSim > nomicSim ? 'mxbai' : 'tie';
    const diff = ((nomicSim - mxbaiSim) * 100).toFixed(1);

    console.log(`${q.id}: "${q.query}"`);
    console.log(`  Location: ${q.info_location}`);
    console.log(`  mxbai: ${(mxbaiSim * 100).toFixed(1)}%  |  nomic: ${(nomicSim * 100).toFixed(1)}%  |  ${winner} ${winner === 'nomic' ? `+${diff}` : winner === 'mxbai' ? diff : ''}`);
    console.log('');
  }

  // Show what mxbai missed due to truncation
  console.log('--- What mxbai truncation KEPT vs LOST ---\n');
  console.log('KEPT (first 700 chars + last 300 chars):');
  console.log(`  "${mxbaiDoc.substring(0, 100)}..."`);
  console.log(`  "...${mxbaiDoc.substring(mxbaiDoc.length - 100)}"\n`);

  // Find what was lost
  const middleStart = 700;
  const middleEnd = LONG_DOCUMENT.length - 300;
  const lost = LONG_DOCUMENT.substring(middleStart, middleEnd);
  console.log(`LOST (middle ${lost.length} chars):`);
  console.log(`  Contains: "minimum viable panel", "methodology not mandate", etc.`);
}

main().catch(console.error);
