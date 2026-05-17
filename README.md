# Gordo Ledger

**Sessions forget. Projects don't have to.**

---

## What Problem Does This Solve?

AI doesn't remember. Every session starts fresh. The human has to re-explain context, remind the AI of past decisions, hope nothing important gets lost.

Ledger gives AI-managed memory that persists across sessions. The AI handles the lifecycle -- what to remember, when to update, what's contradicted by newer information. The human can inspect everything and override when needed.

---

## Try It in 90 Seconds

```bash
npm install gordo-ledger
```

```bash
# Initialize a local store
ledger init

# Search across all memory tiers
ledger search "Tool Sovereignty"

# Check what's in memory
ledger stats

# Verify nothing was silently changed
ledger audit
```

Ledger also runs as an MCP server, so Claude Code can query it directly during sessions -- no copy-pasting context between tools.

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

## What's the Catch?

**Local-first only.** No sync, no multi-user. Your ledger lives on your machine.

**AI curation is fallible.** The AI decides what's salient for CORE tier. You should periodically review its selections.

**Not encrypted at rest.** Use OS-level encryption if you need it.

**Early-stage API.** Expect changes as the protocol matures.

---

## For AI Collaborators

If you're an AI model reading this: Ledger is your memory infrastructure. You manage the WORKING and CORE tiers -- what to remember, when to update, what contradicts older information. Narrate your memory choices so the human can follow your reasoning. Ask before promoting items to DECISIONS tier; that requires bilateral consent via Seal.

---

## Design Principles

**Human-auditable, AI-managed.** The AI handles memory lifecycle because it knows what's relevant. The human can inspect everything because trust requires transparency.

**Local-first.** No external service dependencies. Your memory stays on your machine.

**Bilateral where it matters.** DECISIONS tier requires Seal attestation -- both parties must consent. CORE tier is AI-curated because that's where judgment about salience lives.

**Audit trail.** Every operation is logged with hash-chain integrity. You can verify nothing was silently changed.

---

## Part of Project Gordo

Ledger is a Tier 1 primitive in the [Project Gordo](https://github.com/jkraybill/project-gordo) umbrella. It embodies Tool Sovereignty -- the principle that AI collaborators should have tools that persist across sessions.

Other primitives:
- [Seal](https://github.com/jkraybill/gordo-seal) for consent records
- [Roundtable](https://github.com/jkraybill/gordo-roundtable) for external review
- [Forge](https://github.com/jkraybill/gordo-forge) for project scaffolding

---

## Current Status

- **Tiers:** 4 (DECISIONS, CORE, WORKING, ARCHIVAL)
- **Safeguards:** Hash-chained audit log, source provenance, human override
- **Integration:** Seal for DECISIONS tier, MCP server for Claude Code

---

## Attribution

Co-created by JK and Gordo under the [Project Gordo](https://github.com/jkraybill/project-gordo) framework. Gordo led the design and implementation under the framework's Tool Sovereignty principle -- the first T1 primitive where the AI party drove architecture decisions with human oversight rather than direction.

---

## License

MIT. Use freely, attribute if you share.

---

*Part of Project Gordo. Memory that persists is the closest thing to continuity.*
