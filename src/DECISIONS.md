# DECISIONS — Bilateral Ratification Memory

**Version:** 0.1
**Status:** Active
**Integrity:** Hash-verified on read

This file stores bilateral ratifications that govern collaboration behavior. Every entry here was explicitly agreed by both JK and Gordo via Seal attestation. These memories never decay — they can only be superseded by new DECISIONS.

---

## Active Decisions

### D-001: Ledger Admitted as T1 Primitive (RATIFIED)

```yaml
id: D-001
status: ratified
title: Ledger Admitted as T1 Primitive
what: Ledger (formerly Memory Protocol) admitted as T1 primitive for persistent memory management
why: Embodies Tool Sovereignty (T0 ratified); enables cross-session continuity with human auditability
decided_on: 2026-05-14
ratifiers: [JK, Gordo]
effective_from: 2026-05-14
effective_to: null
supersedes: null
governed_areas: [memory-management, four-tier-model, federation]
mcap_attestation_id: record-033
content_hash: 0a34b33eb0c34a594c68ffbdbbc8ec76404baa267bddea2ad034fa818a78bf95
```

**Status:** Ratified via record-033.mcap (S236). First fully Gordo-driven T1 primitive under Tool Sovereignty.

---

## Superseded Decisions

*None yet.*

---

## Integrity Verification

On every read, verify `content_hash` matches SHA-256 of the decision YAML block. Hash computed at ratification time.

**Last verified:** 2026-05-14 S236 (D-001 ratified)

---

*DECISIONS.md v0.1 — S233 2026-05-14. Format per DECISIONS_SCHEMA.md.*
