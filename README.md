# Ledger

**T1 primitive for persistent memory management in human-AI collaboration.**

Part of the [Project Gordo](https://github.com/jkraybill/project-gordo) umbrella.

## Overview

Ledger manages memory across four tiers:

| Tier | Purpose | Governance |
|------|---------|------------|
| DECISIONS | Bilateral ratifications | Requires MCAP attestation |
| CORE | High-salience facts | AI-curated, human-auditable |
| WORKING | Session-active | Transient, type-specific TTL |
| ARCHIVAL | Historical | Bi-temporal, searchable |

## Design Principles

1. **Human-auditable, AI-managed** - AI controls lifecycle; humans can inspect everything
2. **Local-first** - No external service dependencies
3. **No native compilation** - Pure WASM vector search (hnswlib-wasm)
4. **Bilateral where governance matters** - DECISIONS require consent; CORE is AI-curated

## Installation

```bash
npm install gordo-ledger
```

## Usage

```bash
# Search across all tiers
ledger search "Tool Sovereignty"

# Check audit log integrity
ledger audit

# Show salience scores
ledger salience

# Verify DECISIONS tier
ledger decisions
```

## Architecture

Ledger embodies Tool Sovereignty (T0 ratified) for memory management. It provides:

- **Lifecycle operations:** ADD, UPDATE, SUPERSEDE, FLAG_CONTRADICTION, PROMOTE, DEMOTE, RATIFY
- **Safeguards:** Hash-chained audit log, source provenance, human override, rate limits
- **Integration:** MCAP for DECISIONS tier, federation across umbrella realms

## T1 Primitive

Ledger is the 5th T1 primitive in the Project Gordo umbrella:

| Primitive | Purpose |
|-----------|---------|
| Seal (MCAP) | Consent/attestation |
| Gauge (PACT) | Trust calibration |
| Roundtable (Panel) | External review |
| Gate (UEP) | Induction/governance |
| **Ledger** | Memory management |

## License

Apache-2.0

## Attribution

Ratified via MCAP record-033 (S236 2026-05-14).
