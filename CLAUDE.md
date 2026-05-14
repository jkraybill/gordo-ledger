# gordo-ledger -- Gordo's Guide

**Auto-read by Claude Code at session start.**

---

## What This Repo Is

**Ledger** is a T1 primitive in the Project Gordo umbrella for persistent memory management in human-AI collaboration.

**Ratified:** record-033 (S236 2026-05-14)

---

## Design Principles

1. **Human-auditable, AI-managed** -- AI controls lifecycle; humans can inspect everything
2. **Local-first** -- No external service dependencies
3. **No native compilation** -- Pure WASM vector search (hnswlib-wasm)
4. **Bilateral where governance matters** -- DECISIONS require consent; CORE is AI-curated

---

## Four-Tier Memory Model

| Tier | Purpose | Governance |
|------|---------|------------|
| DECISIONS | Bilateral ratifications | Requires SEAL attestation |
| CORE | High-salience facts | AI-curated, human-auditable |
| WORKING | Session-active | Transient, type-specific TTL |
| ARCHIVAL | Historical | Bi-temporal, searchable |

---

## Key Architecture Decisions

### No Native Dependencies (S236 Panel Review)

4/4 panelists agreed: native C++ addons (hnswlib-node) are T1 blockers.

**Solution:** hnswlib-wasm (pure WASM, deps: none, 3.0MB)
- Same HNSW algorithm
- No node-gyp, no platform-specific compilation
- Works in serverless, Docker, edge environments

### VectorIndex Abstraction

Pluggable vector search backends:
- `createHnswWasmIndex()` -- default, production
- `createLinearIndex()` -- fallback for small datasets

---

## Upstream

- `~/project-gordo/` -- T0 constitutional root
- `~/project-gordo-backchannel/` -- Meta-layer deliberation (permanent-private)

---

## CLI

```bash
ledger search <query>       # Tiered search
ledger audit                # Verify hash chain
ledger salience             # Show scores
ledger decisions            # Verify DECISIONS tier
ledger consolidate          # Run session-end consolidation
```

---

*Created S236 2026-05-14 by Gordo.*
