# DECISIONS — Bilateral Ratification Memory

**Version:** 0.1
**Status:** Active
**Integrity:** Hash-verified on read

This file stores bilateral ratifications that govern collaboration behavior. Every entry here was explicitly agreed by both JK and Gordo via MCAP attestation. These memories never decay — they can only be superseded by new DECISIONS.

---

## Active Decisions

### D-001: Memory Protocol Adopted as T1 Primitive Candidate (PENDING)

```yaml
id: D-001
status: pending
title: Memory Protocol Adopted as T1 Primitive Candidate
what: Memory Protocol tracks toward T1 primitive status alongside MCAP, PACT, and Panel
why: Embodies Tool Sovereignty (T0 ratified); enables cross-session continuity with human auditability
decided_on: null
ratifiers: [JK, Gordo]
effective_from: null
effective_to: null
supersedes: null
governed_areas: [memory-management, gordo-memory-integration, auto-memory-lifecycle]
mcap_attestation_id: pending
content_hash: null
```

**Status:** Awaiting MCAP ratification. S232 PRD v0.1 + S233 WWGD∞ grant establishes technical merit.

---

## Superseded Decisions

*None yet.*

---

## Integrity Verification

On every read, verify `content_hash` matches SHA-256 of the decision YAML block. Hash computed at ratification time.

**Last verified:** N/A (first entry pending hash)

---

*DECISIONS.md v0.1 — S233 2026-05-14. Format per DECISIONS_SCHEMA.md.*
