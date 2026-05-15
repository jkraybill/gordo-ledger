# DECISIONS Tier — Schema Definition

**Version:** 0.1
**Status:** Draft (pending ratification)

---

## Overview

The DECISIONS tier stores bilateral ratifications that govern collaboration behavior. Unlike CORE memories (AI-curated), DECISIONS require explicit consent from both parties and never decay.

## File Format

DECISIONS are stored in `DECISIONS.md` (human-readable markdown) with YAML frontmatter for machine parsing.

## Entry Schema

```yaml
---
id: D-001
type: decision
title: "Short descriptive title"
what: "What was decided"
why: "Rationale for the decision"
decided_on: 2026-05-14
ratifiers:
  - party: JK
    role: human
  - party: Gordo
    role: ai
effective_from: 2026-05-14
effective_to: null  # null = still active, or ISO date if superseded
supersedes: null  # or D-xxx if this replaces a prior decision
governed_areas:
  - area-tag-1
  - area-tag-2
mcap_attestation_id: record-xxx  # Link to Seal ratification record
content_hash: sha256:abc123...  # Computed at ratification, verified on read
---

## D-001: Short Title

**What:** What was decided in prose form.

**Why:** Rationale explaining the decision.

**Effective:** From YYYY-MM-DD, replacing D-xxx if applicable.

**Ratified:** record-xxx.mcap
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier, format `D-NNN` |
| `type` | enum | Yes | Always `decision` |
| `title` | string | Yes | Short descriptive title (<80 chars) |
| `what` | string | Yes | What was decided |
| `why` | string | Yes | Rationale |
| `decided_on` | date | Yes | ISO 8601 date |
| `ratifiers` | array | Yes | List of parties with role |
| `effective_from` | date | Yes | When decision takes effect |
| `effective_to` | date | No | When decision expires (null = active) |
| `supersedes` | string | No | ID of decision this replaces |
| `governed_areas` | array | Yes | Tags for what this governs |
| `mcap_attestation_id` | string | Yes | Link to Seal record |
| `content_hash` | string | Yes | SHA-256 of decision content |

## Integrity Verification

**Hash computation:**
```
content = what + why + decided_on + ratifiers.join() + effective_from
hash = SHA-256(content)
```

**Verification:** On every read, recompute hash and compare. Mismatch triggers integrity alert.

## Operations

| Operation | Requirements |
|-----------|--------------|
| CREATE | Seal bilateral attestation |
| UPDATE | New Seal attestation, original preserved |
| SUPERSEDE | New decision with `supersedes` field |
| DELETE | Not allowed — only supersession |

## Integration

- **Seal:** Every entry requires `mcap_attestation_id`
- **CORE:** Decisions can govern CORE entries via `governed_by` field in CORE schema
- **Audit log:** All operations logged

---

*Schema v0.1 — S232 2026-05-14*
