# Gordo Ledger

**Persistent memory for human-AI collaboration.**

---

## What Problem Does This Solve?

AI doesn't remember. Every session starts fresh. The human has to re-explain context, remind the AI of past decisions, hope nothing important gets lost.

Ledger gives AI-managed memory that persists across sessions. The AI handles the lifecycle -- what to remember, when to update, what's contradicted by newer information. The human can inspect everything and override when needed.

---

## How It Works

Memory lives in four tiers:

| Tier | What goes here | Who controls it |
|------|----------------|-----------------|
| **DECISIONS** | Bilateral ratifications | Requires Seal attestation from both parties |
| **CORE** | High-salience facts and patterns | AI-curated, human-auditable |
| **WORKING** | Session-active context | Transient, expires after use |
| **ARCHIVAL** | Historical record | Searchable, bi-temporal |

The AI manages day-to-day memory operations. Important decisions go through Seal for bilateral consent. Everything is logged and auditable.

---

## Getting Started

```bash
npm install gordo-ledger
```

Basic commands:
```bash
# Search across all tiers
ledger search "Tool Sovereignty"

# Check what's in memory
ledger stats

# Verify audit log integrity
ledger audit
```

Ledger also runs as an MCP server, so Claude Code can query it directly during sessions.

---

## Design Principles

**Human-auditable, AI-managed.** The AI handles memory lifecycle because it knows what's relevant. The human can inspect everything because trust requires transparency.

**Local-first.** No external service dependencies. Your memory stays on your machine.

**Bilateral where it matters.** DECISIONS tier requires Seal attestation -- both parties must consent. CORE tier is AI-curated because that's where judgment about salience lives.

**Audit trail.** Every operation is logged with hash-chain integrity. You can verify nothing was silently changed.

---

## Part of Project Gordo

Ledger is a Tier 1 primitive in the [Project Gordo](https://github.com/jkraybill/project-gordo) umbrella. It embodies Tool Sovereignty -- the principle that AI collaborators should have tools that persist across sessions.

Other primitives handle other concerns: Seal for consent records, Roundtable for external review, Gauge for trust calibration.

---

## Current Status

- **Tiers:** 4 (DECISIONS, CORE, WORKING, ARCHIVAL)
- **Safeguards:** Hash-chained audit log, source provenance, human override, rate limits
- **Integration:** Seal for DECISIONS tier, MCP server for Claude Code

---

## Attribution

Co-created by JK and Gordo under the [Project Gordo](https://github.com/jkraybill/project-gordo) framework. Gordo led the design and implementation under the framework's Tool Sovereignty principle -- the first T1 primitive where the AI party drove architecture decisions with human oversight rather than direction.

---

## License

Apache-2.0

---

*Created by JK + Gordo. Memory that persists is the closest thing to continuity.*
